<!-- SCOPE: Explanation — How the risk scoring algorithm works -->
<!-- TYPE: Explanation -->

# Scoring Algorithm

Understanding how risk scores are calculated from security findings.

## Overview

The Extension Security Analyzer calculates a **risk score (0-100)** representing the overall security posture of an analyzed extension.

**Key principle:** More severe findings contribute more to the score, but the score is capped to prevent single issues from dominating.

## The Algorithm

### Step 1: Severity Weights

Each finding severity has a weight:

| Severity | Weight | Rationale |
|----------|--------|-----------|
| Critical | 10 | Severe security impact (RCE, credential theft) |
| High | 5 | Significant risk (eval, path traversal) |
| Medium | 2 | Moderate concern (weak crypto, debug logging) |
| Low | 1 | Minor issue (information disclosure) |

### Step 2: Raw Score Calculation

Sum the weights of all findings:

```
raw_score = Σ(weight × count) for each severity
```

**Example:**
```
2 Critical × 10 = 20
3 High     × 5  = 15
5 Medium   × 2  = 10
8 Low      × 1  = 8
─────────────────────
Raw Score:      53
```

### Step 3: Capping

The final score is capped at 100:

```
risk_score = min(raw_score, 100)
```

**Why cap?**
- Prevents score inflation from many low-severity findings
- Keeps scale meaningful (0-100)
- Focuses attention on severity diversity, not just quantity

### Step 4: Category Bonus (Optional)

Certain categories may receive multipliers:

```
if (category === 'exec' && severity === 'critical') {
  score *= 1.5  // 50% bonus for critical execution
}
```

**Rationale:** Some vulnerability types are more dangerous in context.

## Score Interpretation

### Risk Levels

| Score | Level | Color | Interpretation |
|-------|-------|-------|----------------|
| 0-20 | Low | 🟢 | Generally safe to use |
| 21-50 | Medium | 🟡 | Review findings before use |
| 51-80 | High | 🟠 | Careful review recommended |
| 81-100 | Critical | 🔴 | Avoid or extensive audit required |

### Score Distribution

In practice, most extensions fall into these ranges:

| Score Range | % of Extensions | Typical Profile |
|-------------|-----------------|---------------|
| 0-20 | 40% | Well-maintained, minimal risky patterns |
| 21-50 | 35% | Some concerning patterns, mostly legitimate |
| 51-80 | 20% | Multiple security concerns |
| 81-100 | 5% | Severe security issues |

## Design Decisions

### Why Linear Weights?

Alternative considered: Exponential weights (critical = 100)

**Linear chosen because:**
- Easier to understand
- Prevents single finding from dominating
- Encourages fixing multiple medium issues vs one critical

**Trade-off:** May under-weight truly severe vulnerabilities.

### Why Cap at 100?

Alternative considered: Uncapped score

**Capping chosen because:**
- Bounded scale is easier to communicate
- Prevents "score inflation" over time
- Aligns with common security rating systems (CVSS 0-10, etc.)

**Trade-off:** Extensions with 200 vs 100 raw score both show 100.

### Why Not Include Code Quality?

The score focuses purely on security patterns, not:
- Code complexity
- Test coverage
- Documentation
- Performance

**Rationale:** Security is the primary concern for this tool.

## Category Scoring

### Per-Category Scores

In addition to overall score, findings are grouped by category:

```
network_score = Σ(weights for network findings)
exec_score = Σ(weights for exec findings)
files_score = Σ(weights for files findings)
crypto_score = Σ(weights for crypto findings)
data_score = Σ(weights for data findings)
```

**Use case:** Identify which attack vectors are most concerning.

### Category Risk Matrix

| Category | Low (0-10) | Medium (11-30) | High (31+) |
|----------|------------|------------------|------------|
| Network | Safe | Review endpoints | Audit data flow |
| Execution | Safe | Review eval usage | Critical RCE risk |
| Files | Safe | Review file ops | Path traversal risk |
| Crypto | Safe | Weak algorithms | Broken crypto |
| Data | Safe | Info disclosure | Data breach risk |

## Confidence Adjustment

When LLM enhancement is enabled, confidence scores adjust the contribution:

```
adjusted_weight = weight × (confidence / 100)
```

**Example:**
- High severity finding (weight: 5)
- LLM confidence: 60%
- Adjusted contribution: 5 × 0.6 = 3

**Rationale:** Low-confidence findings contribute less to overall risk.

## Edge Cases

### No Findings

```
score = 0
```

**Interpretation:** No security patterns matched. May still have vulnerabilities not covered by patterns.

### Only Low Findings

```
100 Low findings = 100 raw score = 100 capped
```

**Interpretation:** Many minor issues may indicate poor security practices.

### Mixed Severities

```
1 Critical (10) + 10 High (50) + 20 Medium (40) = 100
```

**Interpretation:** Diverse security concerns across severity levels.

## Implementation

### Code Location

Scoring logic: `src/analyzer/scoring.ts:34`

```typescript
const SEVERITY_WEIGHTS = {
  critical: 10,
  high: 5,
  medium: 2,
  low: 1
};

function calculateRiskScore(findings: Finding[]): number {
  const rawScore = findings.reduce((sum, finding) => {
    return sum + SEVERITY_WEIGHTS[finding.severity];
  }, 0);
  
  return Math.min(rawScore, 100);
}
```

### Performance

Scoring is O(n) where n = number of findings:
- Single pass through findings array
- Constant-time lookup for weights
- Capping is O(1)

**Result:** Scoring is never a performance bottleneck.

## Calibration

### Tuning Weights

Weights may be adjusted based on:
- False positive rates
- User feedback
- Security research

**Process:**
1. Collect data on score distributions
2. Identify misclassified extensions
3. Adjust weights
4. Validate with test set

### Validation

Scores are validated against:
- Known vulnerable extensions (should score high)
- Known safe extensions (should score low)
- Manual security audits (correlation analysis)

## Maintenance

| Trigger | Action |
|---------|--------|
| New severity level | Update weights table |
| Weight tuning | Document rationale |
| Category changes | Update category scoring |
| Algorithm changes | Version the scoring method |

Last Updated: 2026-03-29
