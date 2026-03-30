<!-- SCOPE: Explanation — System architecture, design decisions, and data flow -->
<!-- TYPE: Explanation -->

# Architecture Overview

Understanding the design and data flow of the Extension Security Analyzer.

## System Overview

The Extension Security Analyzer is a web-based security scanning tool with three main layers:

1. **Web Layer** — Fastify server handling HTTP requests and SSE streams
2. **Analysis Layer** — Static analysis engine with pattern matching and LLM enhancement
3. **Service Layer** — External integrations (VS Code Marketplace, LLM APIs)

```
┌─────────────────────────────────────────────────────────────┐
│                        Web Layer                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Upload     │  │    Search    │  │    Scan      │      │
│  │   Handler    │  │   Handler    │  │   Handler    │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
│         └──────────────────┼──────────────────┘              │
│                            ▼                               │
│                    ┌──────────────┐                         │
│                    │ Scan Registry│                         │
│                    │   (Memory)   │                         │
│                    └──────────────┘                         │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                     Analysis Layer                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Static     │  │   Pattern    │  │    LLM       │      │
│  │   Analyzer   │──▶│   Matcher    │──▶│  Enhancer    │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│         │                   │                   │          │
│         └───────────────────┼───────────────────┘          │
│                             ▼                              │
│                    ┌──────────────┐                         │
│                    │   Scoring    │                         │
│                    └──────────────┘                         │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                     Service Layer                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  Download    │  │ Marketplace  │  │   LLM API    │      │
│  │   Service    │  │    Search    │  │   Provider   │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

## Data Flow

### Scan Lifecycle

When a user initiates a scan, the system follows this flow:

1. **Request Received** (`src/index.ts:120`)
   - Fastify route handler validates input
   - Creates scan task in registry
   - Returns scan ID immediately

2. **Download** (`src/services/download.ts:45`)
   - Fetches VSIX from VS Code Marketplace
   - Streams to temporary file
   - Extracts to temp directory

3. **Static Analysis** (`src/analyzer/static.ts:78`)
   - Walks directory tree
   - Identifies JS/TS files via magic bytes
   - Reads file contents

4. **Pattern Matching** (`src/analyzer/patterns.ts:92`)
   - Loads patterns from `docs/patterns.yaml`
   - Compiles regexes once
   - Matches against each file

5. **Scoring** (`src/analyzer/scoring.ts:34`)
   - Calculates weighted score
   - Critical=10, High=5, Medium=2, Low=1
   - Caps at 100

6. **LLM Enhancement** (Optional) (`src/analyzer/llm.ts:156`)
   - Sends findings to LLM API
   - Requests false positive analysis
   - Updates confidence scores

7. **Report Generation** (`src/analyzer/report.ts:67`)
   - Groups findings by category
   - Generates Markdown output
   - Saves to reports directory

8. **SSE Updates** (`src/index.ts:203`)
   - Streams progress to client
   - Emits events: progress, finding, complete

### Why This Architecture?

**Separation of Concerns**

Each layer has a single responsibility:
- Web layer: HTTP protocol handling
- Analysis layer: Security logic
- Service layer: External communication

This separation enables:
- Independent testing of each layer
- Swappable implementations (e.g., different LLM providers)
- Clear boundaries for security review

**Async-First Design**

Scans are long-running operations (10-30 seconds). The system uses:
- In-memory registry for scan state
- SSE for real-time updates
- Immediate response with scan ID

This prevents HTTP timeouts and allows clients to track progress.

**Pattern Externalization**

Security patterns live in `docs/patterns.yaml` rather than code:
- Security researchers can add patterns without code changes
- Hot-reloadable without server restart
- Version-controlled alongside code

**Pure Functions Where Possible**

Scoring, pattern matching, and report generation are pure:
- Same input → same output
- Easy to unit test
- No side effects to mock

Side effects (network, disk) are isolated in service layer.

## Component Interactions

### Scan Registry

The in-memory registry (`Map<string, ScanTaskEmitter>`) tracks active scans:

```typescript
// Simplified structure
interface ScanTask {
  id: string;
  status: 'pending' | 'downloading' | 'analyzing' | 'complete' | 'error';
  progress: {
    filesScanned: number;
    totalFiles: number;
    patternsMatched: number;
  };
  result?: ScanResult;
  emitter: EventEmitter; // For SSE
}
```

**Trade-off:** In-memory storage means scans are lost on server restart. This is acceptable because:
- Reports are persisted to disk
- Scans are idempotent (can be re-run)
- Simplifies deployment (no database needed)

### Pattern Matching Pipeline

Patterns are compiled once at scan start:

```
patterns.yaml → PatternLoader → CompiledPattern[] → Matcher
```

Each compiled pattern includes:
- Original regex string
- Compiled RegExp object
- Severity level
- Category (network, crypto, files, exec)

This compilation step improves performance when scanning hundreds of files.

### LLM Consensus

When enabled, the system can query multiple LLM models:

```
Finding → LLM Provider A → Confidence Score
        → LLM Provider B → Confidence Score
        → LLM Provider C → Confidence Score
                ↓
          Aggregate (average or majority)
                ↓
          Updated Finding
```

This reduces false positives from any single model's biases.

## Security Considerations

### Input Sanitization

All user inputs are sanitized:
- Extension IDs validated against marketplace format
- File uploads checked for ZIP bomb attacks
- Path traversal prevented in extraction

### Sandboxed Analysis

VSIX extraction uses temporary directories:
- Isolated from project files
- Cleaned up after scan
- No execution of extension code

### LLM Prompt Injection

Prompts are loaded from trusted files (`prompts.yaml`):
- User input never directly interpolated
- Structured data passed via JSON
- DOMPurify sanitizes any rendered HTML

## Scalability Limits

Current architecture has these constraints:

| Resource | Limit | Mitigation |
|----------|-------|------------|
| Memory | All scans in memory | Reports persisted, scans re-runnable |
| Concurrency | Node.js single-threaded | LLM calls are async, CPU work is sync |
| Disk | Temp files per scan | Cleanup in `finally` blocks |
| LLM Rate | Provider-dependent | Configurable concurrency |

For higher throughput, consider:
- Externalizing scan registry to Redis
- Worker queue (Bull/BullMQ) for scan jobs
- Horizontal scaling with load balancer

## Maintenance

| Trigger | Action |
|---------|--------|
| New component added | Update architecture diagram |
| Data flow changes | Update Scan Lifecycle section |
| New security consideration | Add to Security Considerations |
| Scalability limits change | Update Scalability Limits table |

Last Updated: 2026-03-29
