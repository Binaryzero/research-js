<!-- SCOPE: How-to guide — Understanding scan reports and findings -->
<!-- TYPE: How-to -->

# Interpret Scan Reports

Understand the findings in your Extension Security Analyzer reports.

## Goal

Learn to read and act on scan results, including risk scores, findings, and recommendations.

## Report Structure

Each scan generates three artifacts side by side in the reports directory: a Markdown report (`.md`, portable), the structured analysis result (`.json`), and a standalone interactive HTML report (`.html`, self-contained — filter findings by severity, hide false positives, search, and jump between sections; shareable as a single file). The web UI renders the interactive view by default and falls back to markdown for older scans.

Reports contain these sections:

1. **Executive Summary** — High-level risk assessment
2. **Findings** — Detailed security issues
3. **Risk Breakdown** — By severity and category
4. **Recommendations** — Actionable next steps

## Executive Summary

The summary provides an at-a-glance risk assessment:

```markdown
## Executive Summary

- **Extension**: publisher.extension-name v1.2.3
- **Risk Score**: 35/100 (Medium)
- **Findings**: 2 High, 5 Medium, 8 Low
- **Scan Date**: 2026-03-29T10:30:00Z
```

### Risk Score Interpretation

| Score | Level | Meaning | Action |
|-------|-------|---------|--------|
| 0-20 | Low | Minimal security concerns | Generally safe |
| 21-50 | Medium | Some issues warrant review | Review before use |
| 51-80 | High | Significant security concerns | Careful review required |
| 81-100 | Critical | Severe security risks | Avoid or extensive audit |

## Understanding Findings

Each finding includes:

```markdown
### eval-usage (High)

**File**: src/extension.js:45
**Pattern**: eval\s*\(
**Category**: Execution
**LLM Confidence**: 85%

**Context**:
```javascript
const result = eval(userInput);  // Line 45
```

**Description**: Detects use of eval() which can execute arbitrary code
```

### Finding Components

| Field | Description | How to Use |
|-------|-------------|------------|
| **Pattern Name** | Identifier for the detection rule | Look up in patterns reference |
| **Severity** | Critical/High/Medium/Low | Prioritize higher severities |
| **File:Line** | Location in extension code | Navigate to source |
| **Category** | Attack vector type | Focus on relevant categories |
| **LLM Confidence** | AI-assessed likelihood (if enabled) | 90%+ = likely real issue |
| **Context** | Code snippet showing match | Understand the usage |

## Severity Levels

### Critical (Weight: 10)

**Examples:**
- Remote code execution vulnerabilities
- Credential exfiltration
- Unauthorized network access to sensitive APIs

**Action:** Must fix before use. These are severe security risks.

### High (Weight: 5)

**Examples:**
- `eval()` or `new Function()` with user input
- Dynamic imports from network URLs
- Unvalidated file path construction

**Action:** Review carefully. Likely security issues requiring mitigation.

### Medium (Weight: 2)

**Examples:**
- Insecure random number generation
- Debug logging of sensitive data
- Weak cryptographic algorithms

**Action:** Evaluate context. May be acceptable in some cases.

### Low (Weight: 1)

**Examples:**
- Commented-out security code
- TODO comments about security
- Minor information disclosure

**Action:** Low priority. Review if time permits.

## Category Breakdown

Findings are grouped by attack vector:

### Network

Suspicious network activity:
- Unauthorized data transmission
- Credential leakage in requests
- Connections to unexpected domains

**Review Focus:** Where is data going? Is it expected?

### Execution

Code execution risks:
- `eval()`, `setTimeout(string)`, `new Function()`
- `child_process` module usage
- Dynamic `require()` with user input

**Review Focus:** Can user input execute code?

### Files

File system operations:
- Path traversal (`../` sequences)
- Arbitrary file writes
- Reading sensitive files

**Review Focus:** Can user input access unintended files?

### Crypto

Cryptographic weaknesses:
- `Math.random()` for security
- Weak hash algorithms (MD5, SHA1)
- Hardcoded keys or IVs

**Review Focus:** Is cryptography used correctly?

### Data

Data handling issues:
- Prototype pollution
- Insecure deserialization
- Sensitive data exposure

**Review Focus:** Is data handled securely?

## LLM Confidence Scores

When LLM enhancement is enabled, each finding includes a confidence score:

| Confidence | Interpretation | Recommended Action |
|------------|----------------|---------------------|
| 90-100% | Confirmed security issue | Prioritize for immediate fix |
| 70-89% | Likely security issue | Include in security review |
| 50-69% | Uncertain | Manual review recommended |
| 0-49% | Likely false positive | Lower priority, verify context |

**Note:** Confidence scores are AI-generated and should inform, not replace, human judgment.

## Common Patterns and Their Meaning

### eval-usage

```javascript
// FLAGGED: eval(userInput)
```

**Risk:** Executes arbitrary JavaScript code.
**Context Matters:** Sometimes used for JSON parsing (unsafe) or configuration (risky).
**Action:** Replace with `JSON.parse()` for JSON, or remove entirely.

### fetch-credentials

```javascript
// FLAGGED: fetch(url, { credentials: 'include' })
```

**Risk:** Sends cookies/auth to potentially untrusted domains.
**Context Matters:** Required for same-origin requests, risky for cross-origin.
**Action:** Verify the destination domain is trusted.

### fs-dynamic-path

```javascript
// FLAGGED: fs.readFile(userInput + '/file.txt')
```

**Risk:** Path traversal if userInput contains `../`.
**Context Matters:** Safe if input is validated or whitelisted.
**Action:** Validate and sanitize all path inputs.

### insecure-random

```javascript
// FLAGGED: Math.random() for security purposes
```

**Risk:** `Math.random()` is not cryptographically secure.
**Context Matters:** Fine for non-security uses (UI, games), bad for tokens/keys.
**Action:** Use `crypto.randomBytes()` for security purposes.

## Making Decisions

### When to Use an Extension

| Risk Score | Findings | Decision |
|------------|----------|----------|
| 0-20 | Few/none low | ✅ Generally safe |
| 21-50 | Some medium | ⚠️ Review findings first |
| 51-80 | Several high | 🔍 Careful review required |
| 81-100 | Critical issues | ❌ Avoid or extensive audit |

### When to Trust LLM Confidence

**High confidence (90%+):**
- Pattern is clearly dangerous in context
- Standard vulnerability pattern
- **Action:** Treat as confirmed issue

**Medium confidence (50-89%):**
- Context-dependent risk
- May be legitimate use
- **Action:** Manual review recommended

**Low confidence (<50%):**
- Likely false positive
- Pattern matches but context is safe
- **Action:** Verify, but lower priority

## Troubleshooting Reports

### Empty Report

**Cause:** No patterns matched or scan failed.
**Check:** Server logs for errors.

### Too Many Findings

**Cause:** Broad patterns matching legitimate code.
**Solution:** Enable LLM enhancement to filter false positives.

### Missing Context

**Cause:** Minified code or insufficient snippet extraction.
**Solution:** Download VSIX and review source manually.

## Next Steps

After reviewing a report:

1. **Prioritize** critical and high findings
2. **Research** unfamiliar patterns
3. **Verify** context for medium/low findings
4. **Decide** whether to use the extension
5. **Document** your decision for compliance

## Maintenance

| Trigger | Action |
|---------|--------|
| New pattern added | Update Common Patterns section |
| LLM confidence feedback | Refine interpretation guidance |
| User questions | Add to Troubleshooting |

Last Updated: 2026-03-29
