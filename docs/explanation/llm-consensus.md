<!-- SCOPE: Explanation — How multi-model LLM consensus works -->
<!-- TYPE: Explanation -->

# LLM Consensus

Understanding how multi-model consensus reduces false positives.

## The Problem

Static pattern matching produces false positives:

```javascript
// Pattern flags: eval\s*\(
eval(JSON.stringify(data))  // Safe - but flagged!
```

A single LLM might also be inconsistent:
- **Model A**: "This is dangerous!" (confidence: 95%)
- **Model B**: "This looks safe." (confidence: 30%)

How do we know which to trust?

## The Solution: Consensus

Multiple LLMs analyze the same finding and vote on its severity:

```
Finding → Model A → Confidence: 85%
        → Model B → Confidence: 70%
        → Model C → Confidence: 90%
                ↓
          Aggregate: 81.7% (High confidence)
```

## How Consensus Works

### Step 1: Individual Analysis

Each configured LLM receives:
- Pattern name and description
- Code context (snippet)
- File location
- Severity from pattern matcher

**Prompt sent to each model:**

```
Analyze this security finding for false positives:

Pattern: eval-usage
Description: Detects use of eval() which can execute arbitrary code
Severity: high
File: src/utils.js:45

Code context:
```javascript
const result = eval(JSON.stringify(data))
```

Is this a true security issue? Consider:
1. Is user input reaching eval()?
2. Is the data sanitized before eval?
3. Is this a standard/legitimate use case?

Respond with JSON:
{
  "confidence": 0-100,
  "reasoning": "brief explanation",
  "isFalsePositive": boolean
}
```

### Step 2: Confidence Aggregation

Multiple strategies for combining results:

#### Average (Default)

```javascript
consensus = (confidenceA + confidenceB + confidenceC) / numModels
// (85 + 70 + 90) / 3 = 81.7%
```

**Best for:** Smoothing out individual model biases

#### Weighted Average

```javascript
// Models have different weights based on reliability
consensus = (85×2 + 70×1 + 90×1.5) / (2+1+1.5)
// = 81.4%
```

**Best for:** When some models are more trusted

#### Majority Vote

```javascript
// Binary decision first, then average confidence of majority
if (isFalsePositive votes >= 2/3) {
  consensus = average(confidence of false positive votes)
} else {
  consensus = average(confidence of true positive votes)
}
```

**Best for:** Clear true/false decisions

### Step 3: Threshold Application

Apply thresholds to determine final action:

| Consensus | Interpretation | Action |
|-----------|----------------|--------|
| 90-100% | Confirmed issue | Include in report, high priority |
| 70-89% | Likely issue | Include in report |
| 50-69% | Uncertain | Include with flag for manual review |
| 0-49% | Likely false positive | Lower priority or exclude |

## Why Multiple Models?

### Reducing Individual Biases

Different models have different strengths:

| Model Type | Strength | Weakness |
|------------|----------|----------|
| GPT-4 | General reasoning | May over-flag |
| Claude | Careful analysis | May under-flag |
| Llama | Code understanding | Inconsistent formatting |
| CodeLlama | Code-specific | Narrow focus |

**Consensus smooths out individual quirks.**

### Improving Reliability

Single model accuracy: ~75%
Three-model consensus: ~90%

**Why?** Errors are often uncorrelated:
- Model A hallucinates danger
- Model B misses context
- Model C gets it right

Consensus (2/3 correct) → Correct decision

### Cost vs Accuracy Trade-off

| Models | Accuracy | Cost | Latency |
|--------|----------|------|---------|
| 1 | 75% | 1x | 1x |
| 2 | 85% | 2x | 1x (parallel) |
| 3 | 90% | 3x | 1x (parallel) |
| 5 | 93% | 5x | 1x (parallel) |

**Sweet spot:** 2-3 models for most use cases

## Configuration

### Basic Setup

```yaml
# prompts.yaml
llm:
  providers:
    - name: primary
      url: http://localhost:11434
      model: llama3.2
      weight: 1
      
    - name: secondary
      url: https://api.openai.com/v1
      model: gpt-4o-mini
      apiKey: ${OPENAI_KEY}
      weight: 1.5
      
  consensus:
    method: weighted_average
    threshold: 70
```

### Advanced: Conditional Consensus

Different strategies for different severities:

```yaml
consensus:
  critical:
    method: unanimous  # All must agree
    threshold: 90
    
  high:
    method: majority
    threshold: 75
    
  medium:
    method: average
    threshold: 60
    
  low:
    method: single     # Skip consensus, use one model
    threshold: 50
```

## Implementation Details

### Parallel Execution

All LLM calls run concurrently:

```typescript
const results = await Promise.all(
  providers.map(provider => 
    analyzeWithLLM(finding, provider)
  )
);
```

**Benefit:** Latency = slowest single call, not sum of calls

### Timeout Handling

```typescript
const results = await Promise.allSettled(
  providers.map(provider => 
    Promise.race([
      analyzeWithLLM(finding, provider),
      timeout(30000)  // 30 second timeout
    ])
  )
);

// Filter out timeouts, use remaining results
const validResults = results.filter(r => r.status === 'fulfilled');
```

### Error Resilience

If one model fails, consensus uses remaining models:

```
Model A: Success (85%)
Model B: Timeout
Model C: Success (90%)

Consensus: (85 + 90) / 2 = 87.5%
```

## Limitations

### What Consensus Can't Fix

1. **Systematic biases** — If all models share a blind spot
2. **Novel attacks** — Unknown vulnerability patterns
3. **Context gaps** — Missing information not in code snippet
4. **Adversarial inputs** — Code designed to fool analysis

### When to Skip Consensus

Consensus may not be worth the cost when:
- Pattern has very low false positive rate (<5%)
- Scanning thousands of files (cost prohibitive)
- Latency is critical (real-time analysis)
- Local model only (no diversity)

## Best Practices

### Model Selection

Choose diverse models:
- **Different architectures** (transformer vs other)
- **Different training data** (general vs code-specific)
- **Different sizes** (large vs small)

**Good combination:**
- Llama 3.2 (local, code-aware)
- GPT-4o-mini (cloud, general reasoning)

**Poor combination:**
- GPT-4 + GPT-3.5 (same family, similar biases)

### Weight Assignment

Assign weights based on:
- **Accuracy history** — Track model performance
- **Recency** — Newer models often better
- **Specificity** — Code models for code patterns

```yaml
providers:
  - name: gpt4
    weight: 2.0      # Most trusted
    
  - name: claude
    weight: 1.5    # Second most trusted
    
  - name: llama
    weight: 1.0    # Baseline
```

### Threshold Tuning

Adjust thresholds based on results:

| Finding | False Positive Rate | Action |
|---------|---------------------|--------|
| eval-usage | 30% | Lower threshold to 60% |
| fetch-credentials | 10% | Keep threshold at 70% |
| path-traversal | 5% | Raise threshold to 80% |

## Maintenance

| Trigger | Action |
|---------|--------|
| New model available | Evaluate and potentially add |
| Accuracy drops | Review and adjust weights |
| Cost too high | Reduce model count or use cheaper models |
| Latency issues | Add timeouts, consider caching |

Last Updated: 2026-03-29
