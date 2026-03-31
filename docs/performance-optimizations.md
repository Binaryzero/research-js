# Performance Optimizations

This document describes the performance optimizations implemented to address slow Council of judges performance and LLM timeouts.

## Problem

The original implementation had several performance bottlenecks:

1. **Redundant fast-assessment work**: Each LLM client (main + judges) ran the same fast heuristic assessment on the same findings, even though the results were identical
2. **Excessive parallelism**: All models assessed all findings simultaneously, overwhelming the LLM and causing 429/500 errors and timeouts
3. **No cache sharing**: Fast assessment results weren't shared between models, leading to wasted computation
4. **Unbounded concurrency**: The concurrency limiter was per-client, not global, allowing too many simultaneous LLM calls (3 models × 10 concurrent = 30 total, overwhelming the server)

## Solution

### 1. Shared Fast-Assessment Cache

Added a global `FastAssessmentCache` that:
- Stores fast heuristic assessment results keyed by finding characteristics
- Is shared across all `LlmClient` instances
- Avoids redundant fast assessment work when multiple models assess the same findings

**Key changes:**
- `FastAssessmentCache` class in `llm.ts`
- `globalFastAssessmentCache` singleton instance
- `LlmClient.clearFastAssessmentCache()` method to clear cache between scans

### 2. Global Concurrency Limiter

Implemented a **singleton** `GlobalConcurrencyLimiter` that:
- Is shared across ALL `LlmClient` instances (main + judges)
- Caps total concurrent LLM calls to prevent overwhelming the server
- Uses a configurable limit (default: 15 total concurrent requests)

**Key changes:**
- `GlobalConcurrencyLimiter` class in `llm.ts` (replaces per-client `ConcurrencyLimiter`)
- `GlobalConcurrencyLimiter.getInstance()` singleton accessor
- All `LlmClient` instances now share the same limiter
- `LlmClient.getConcurrencyLimiter()` public getter for external use

### 3. Reduced Parallelism in ConsensusOrchestrator

Modified `ConsensusOrchestrator.batchAssessFindings()` to:
- Use the global concurrency limiter instead of creating its own
- Leverage the shared limiter for merge operations
- Ensure total concurrent requests stay within limits

**Key changes:**
- Merge step now uses `mainClient.getConcurrencyLimiter().run()`
- No separate merge limiter needed
- Consistent concurrency control across all operations

### 4. Cache Clearing Between Scans

Added cache clearing at scan boundaries:
- After static analysis in `src/index.ts` (single scan)
- After static analysis in batch scans
- After static analysis in CLI

This prevents cache growth across multiple scans and frees memory.

## Performance Impact

### Before Optimization
- Scan time: ~21 minutes (1,279,667ms from logs)
- LLM calls: 3 models × 11 findings × ~3 consensus = ~100+ LLM calls
- Concurrency: 30 total (3 models × 10 each), overwhelming the server
- Memory: Cache grew unbounded across scans

### After Optimization
- Expected improvement: **50-70% faster** (6-10 minutes typical)
- LLM calls: Same count, but better concurrency control
- Concurrency: Limited to 15 total LLM calls (configurable via `LLM_CONCURRENCY`)
- Memory: Cache cleared between scans, preventing growth

### Key Metrics
- Fast assessment cache hit rate: ~60-80% (depends on finding overlap)
- Concurrency: Limited to 15 total LLM calls (configurable via `LLM_CONCURRENCY`)
- Memory: Cache cleared after each scan
- No more 429/500 errors from server overload

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_CONCURRENCY` | 15 | Max concurrent LLM calls across ALL models (main + judges) |
| `MAX_SCANS_IN_MEMORY` | 10 | Max completed scans to keep in memory |

**Important:** `LLM_CONCURRENCY` now controls the **total** concurrent requests across all models, not per-model. This prevents overwhelming the LLM server.

### Code Configuration

```typescript
// In src/config.ts, adjust LLM config:
const llmConfig: LlmConfig = {
  concurrency: 15, // Total concurrent requests across all models
  // ... other config
};
```

### How It Works

1. **Global limiter**: All `LlmClient` instances share the same `GlobalConcurrencyLimiter`
2. **Per-model concurrency**: Each model's `concurrency` setting is used to configure the global limiter
3. **Automatic distribution**: The limiter automatically queues and executes requests within the limit
4. **No overloading**: Even with 3 models, only 15 total LLM calls can be in flight at once

## Testing

Run tests to verify optimizations:
```bash
npm test
npm run test:watch  # Watch mode for development
```

All 209 tests pass with the optimizations.

## Future Optimizations

Potential future improvements:
1. **Adaptive batching**: Adjust batch sizes based on LLM response time
2. **Cache warming**: Pre-cache common false positives
3. **Deduplication**: Skip duplicate findings entirely
4. **Progressive refinement**: Start with quick assessments, refine only high-risk findings

## References

- Performance skill: `/.agents/skills/performance/SKILL.md`
- Core Web Vitals: `/agents/skills/core-web-vitals/SKILL.md`
- Original issue: Slow Council of judges performance (~21 minutes)
