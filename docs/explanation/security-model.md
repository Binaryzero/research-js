<!-- SCOPE: Explanation — How the security analysis works internally -->
<!-- TYPE: Explanation -->

# Security Model

Understanding how the Extension Security Analyzer detects and evaluates security risks.

## Analysis Philosophy

The analyzer uses a **defense-in-depth** approach combining multiple detection layers:

1. **Static Pattern Matching** — Fast, deterministic detection
2. **Risk Scoring** — Quantified severity assessment
3. **LLM Enhancement** — Contextual false positive reduction
4. **Categorization** — Organized by attack vector

This layered approach balances speed (static analysis) with accuracy (LLM review).

## Detection Layers

### Layer 1: Pattern Matching

The foundation of detection is regex-based pattern matching:

```
Source Code → Pattern Matcher → Findings
```

**Why Regex?**
- **Fast**: Can scan thousands of files in seconds
- **Deterministic**: Same input always produces same output
- **Maintainable**: Patterns live in YAML, editable without code changes
- **Transparent**: Easy to understand what triggers a match

**Limitations**
- Cannot understand code context
- May flag legitimate uses (false positives)
- Cannot detect novel attack patterns

### Layer 2: Risk Scoring

Each finding receives a severity score:

| Severity | Weight | Examples |
|----------|--------|----------|
| Critical | 10 | Remote code execution, credential exfiltration |
| High | 5 | eval usage, dynamic imports from network |
| Medium | 2 | Insecure randomness, debug logging |
| Low | 1 | Commented code, TODO security notes |

**Overall Risk Score Calculation**

```
score = Σ(severity_weight × count) for all findings
risk_score = min(score, 100)
```

**Example:**
- 2 Critical findings: 2 × 10 = 20
- 3 High findings: 3 × 5 = 15
- 5 Medium findings: 5 × 2 = 10
- 8 Low findings: 8 × 1 = 8
- **Total: 53** (Medium-High risk)

### Layer 3: LLM Enhancement

Optional AI-powered analysis reduces false positives:

```
Finding → LLM Analysis → Confidence Score → Refined Finding
```

The LLM evaluates:
- Is this pattern actually dangerous in this context?
- Is this a standard library usage?
- Is the data flow actually vulnerable?

**Confidence Score Interpretation**

| Confidence | Meaning | Action |
|------------|---------|--------|
| 90-100 | Confirmed issue | Prioritize for review |
| 70-89 | Likely issue | Include in report |
| 50-69 | Uncertain | Flag for manual review |
| 0-49 | Likely false positive | Lower priority |

### Layer 4: Categorization

Findings are grouped by attack vector:

| Category | Description | Example Patterns |
|----------|-------------|------------------|
| **Network** | Suspicious network activity | Unauthorized fetch, credential leakage |
| **Crypto** | Weak cryptography | Insecure random, weak algorithms |
| **Files** | File system operations | Path traversal, arbitrary file write |
| **Exec** | Code execution | eval, Function constructor, child_process |
| **Data** | Data handling | Prototype pollution, insecure deserialization |

This helps security reviewers focus on relevant attack vectors.

## Pattern Design

### Pattern Categories

Patterns are designed to catch specific vulnerability classes:

**Execution Patterns**
- `eval()` usage
- `new Function()` constructor
- `child_process` module usage
- Dynamic `require()` with user input

**Network Patterns**
- Fetch with `credentials: 'include'`
- XMLHttpRequest with `withCredentials`
- WebSocket connections to external domains

**File Patterns**
- `fs` module with dynamic paths
- Path traversal sequences (`../`)
- Arbitrary file writes

**Crypto Patterns**
- `Math.random()` for security purposes
- Weak hash algorithms (MD5, SHA1)
- Hardcoded keys or IVs

### Pattern Quality

Good patterns balance:
- **Precision**: Minimize false positives
- **Recall**: Catch actual vulnerabilities
- **Clarity**: Easy to understand and maintain

**Example: Good vs Bad Patterns**

```yaml
# BAD: Too broad, many false positives
- name: network-request
  regex: 'fetch|axios|request'
  
# GOOD: Specific to suspicious behavior
- name: fetch-with-credentials
  regex: 'fetch\s*\([^)]*credentials\s*:\s*["\']include'
  description: "Fetch requests sending credentials to potentially untrusted domains"
```

## Risk Assessment

### Risk Score Interpretation

The final risk score (0-100) indicates overall extension trustworthiness:

| Score | Risk Level | Recommendation |
|-------|------------|----------------|
| 0-20 | Low | Generally safe to use |
| 21-50 | Medium | Review findings before use |
| 51-80 | High | Careful review recommended |
| 81-100 | Critical | Avoid or extensive audit required |

### Factors Affecting Risk

**Increases Risk:**
- eval/Function constructor usage
- Network requests with sensitive data
- File system access outside workspace
- Obfuscated or minified code
- Native module loading

**Decreases Risk:**
- Well-known publisher
- Open source with many contributors
- Recent security audit
- Minimal permission requirements

## False Positive Management

### Common False Positive Sources

| Pattern | False Positive | Mitigation |
|---------|----------------|------------|
| `eval` detection | JSON parsing with `eval` | Context analysis via LLM |
| `fetch` detection | Same-origin requests | Domain whitelist check |
| `fs` detection | Read-only operations | Permission scope analysis |
| `child_process` | Build tool usage | Call graph analysis |

### Reducing False Positives

1. **LLM Review**: Contextual analysis of each finding
2. **Multi-Model Consensus**: Multiple LLMs vote on severity
3. **Pattern Refinement**: Continuous improvement of regex patterns
4. **Manual Review**: Human validation of edge cases

## Security Boundaries

### What the Analyzer Can Detect

✅ **Static code patterns**
✅ **Known vulnerability signatures**
✅ **Suspicious API usage**
✅ **Permission/scope analysis**

### What the Analyzer Cannot Detect

❌ **Runtime behavior** (dynamic analysis)
❌ **Novel attack patterns**
❌ **Logic flaws**
❌ **Social engineering in UI**

The analyzer is a **static analysis tool**, not a replacement for:
- Dynamic application security testing (DAST)
- Manual code review
- Runtime monitoring
- User behavior analysis

## Maintenance

| Trigger | Action |
|---------|--------|
| New vulnerability class | Add pattern category |
| False positive pattern identified | Refine regex or add LLM context |
| New attack vector discovered | Document in appropriate category |
| Risk scoring feedback | Adjust weights or thresholds |

Last Updated: 2026-03-29
