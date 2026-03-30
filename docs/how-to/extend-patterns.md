<!-- SCOPE: How-to guide — Contributing new security patterns -->
<!-- TYPE: How-to -->

# Extend Security Patterns

Contribute new security detection patterns to the analyzer.

## Goal

Add a new security pattern to detect a specific vulnerability or suspicious code pattern.

## Prerequisites

Before starting:
- Understanding of regular expressions
- Familiarity with JavaScript/TypeScript code patterns
- Access to the `docs/patterns.yaml` file

## Step 1: Identify the Pattern

### What Makes a Good Pattern?

A good security pattern:
1. **Detects a real security risk** — Not just "suspicious looking" code
2. **Has low false positive rate** — Doesn't flag legitimate uses
3. **Is specific** — Targets the vulnerability precisely
4. **Is explainable** — Users understand why it was flagged

### Research the Vulnerability

Before writing a pattern, understand:
- What is the vulnerability?
- How is it exploited?
- What does vulnerable code look like?
- What does safe code look like?

**Example:** Prototype pollution
- **Vulnerability:** Modifying `Object.prototype` affects all objects
- **Exploitation:** Attacker sets `__proto__` or `constructor.prototype`
- **Vulnerable code:** `obj[key] = value` where `key` is user-controlled
- **Safe code:** `Object.create(null)` for maps, or key validation

## Step 2: Design the Regex

### Start Simple

Begin with a basic pattern:

```regex
__proto__
```

### Test Against Real Code

Collect samples:
- **Vulnerable examples** — Should match
- **Safe examples** — Should NOT match
- **Edge cases** — Comments, strings, minified code

**Test cases:**
```javascript
// Should match (vulnerable)
obj[req.body.key] = value
obj['__proto__'] = payload
obj[`${userInput}`] = data

// Should NOT match (safe)
// __proto__ in comment
const str = "__proto__"
Object.create(null)[key] = value
if (key === '__proto__') return
```

### Refine the Pattern

Add specificity to reduce false positives:

```regex
\[\s*['"`]\s*__proto__\s*['"`]\s*\]
```

This matches:
- `obj['__proto__']`
- `obj["__proto__"]`
- `obj[`__proto__`]`

But not:
- `// __proto__`
- `"__proto__"`

## Step 3: Write the Pattern Entry

Add to `docs/patterns.yaml`:

```yaml
  - name: prototype-pollution
    description: Detects potential prototype pollution vulnerabilities where user-controlled keys are used to access object properties without validation
    severity: high
    category: data
    regex: '\[\s*['"`]\s*__proto__\s*['"`]\s*\]|\[\s*['"`]\s*constructor\s*['"`]\s*\]\s*\.\s*prototype'
    flags: gi
```

### Field Guidelines

**name:**
- Use kebab-case: `prototype-pollution`
- Be descriptive but concise
- Avoid generic names like `vulnerability-1`

**description:**
- Explain the security risk in plain English
- Mention the attack scenario
- Keep under 200 characters

**severity:**
- `critical` — Remote code execution, credential theft
- `high` — Significant security impact
- `medium` — Moderate concern
- `low` — Informational

**category:**
- `data` — Data handling vulnerabilities
- `exec` — Code execution
- `network` — Network-related
- `files` — File system
- `crypto` — Cryptography

## Step 4: Validate the Pattern

### Run Validation

```bash
npm run cli -- patterns validate
```

Expected output:
```
✓ patterns.yaml is valid
  - 16 patterns loaded
  - All regexes compile successfully
```

### Test Against Files

Create a test file:

```javascript
// test-prototype-pollution.js
// Should match:
obj[req.body.key] = value
config['__proto__'] = malicious

// Should NOT match:
// __proto__ in comment
const safe = Object.create(null)
```

Run test:
```bash
npm run cli -- patterns test test-prototype-pollution.js
```

## Step 5: Test with Real Extension

### Find a Test Extension

Search for extensions that might have this pattern:

```bash
npm run cli -- search "config" -l 5
```

### Run Scan

```bash
npm run cli -- scan publisher.extension-name -o test-report.md
```

### Review Results

Check the report for:
- **True positives** — Correctly flagged vulnerable code
- **False positives** — Legitimate code incorrectly flagged
- **Missed vulnerabilities** — Vulnerable code not detected

## Step 6: Refine Based on Results

### If Too Many False Positives

Make the pattern more specific:

```yaml
# Before (too broad)
regex: '__proto__'

# After (more specific)
regex: '\[\s*['"`]\s*__proto__\s*['"`]\s*\]\s*=|\.\s*__proto__\s*=|\.\s*__proto__\s*\.\s*'
```

### If Missing Vulnerabilities

Broaden the pattern carefully:

```yaml
# Before (too specific)
regex: 'obj\[\s*__proto__\s*\]'

# After (broader but still targeted)
regex: '\w+\[\s*['"`]\s*__proto__\s*['"`]\s*\]'
```

### If Uncertain

Consider LLM enhancement to filter:

```yaml
# Keep pattern broad
regex: '__proto__'
severity: medium  # Lower severity due to potential FPs
```

Then let LLM determine if it's truly vulnerable in context.

## Step 7: Document the Pattern

### Add to Pattern Documentation

Update `docs/reference/security-patterns.md`:

```markdown
### prototype-pollution

**Severity:** High
**Category:** Data

Detects potential prototype pollution where user-controlled property names modify Object.prototype.

**Vulnerable:**
```javascript
obj[req.body.key] = value
```

**Safe:**
```javascript
const safe = Object.create(null)
safe[validatedKey] = value
```

**References:**
- [CWE-1321](https://cwe.mitre.org/data/definitions/1321.html)
- [Prototype Pollution Explained](https://example.com)
```

## Step 8: Submit for Review

### Create Pull Request

1. Fork the repository
2. Create a branch: `git checkout -b add-prototype-pollution-pattern`
3. Commit changes: `git commit -am "Add prototype pollution detection pattern"`
4. Push: `git push origin add-prototype-pollution-pattern`
5. Create PR with description

### PR Description Template

```markdown
## Pattern: Prototype Pollution

### Description
Detects potential prototype pollution vulnerabilities where user-controlled keys access `__proto__` or `constructor.prototype`.

### Severity Justification
High — Can lead to remote code execution in some contexts.

### Testing
- [ ] Validated against 5+ real extensions
- [ ] False positive rate < 20%
- [ ] Pattern documentation updated

### References
- CWE-1321
- [Research paper](link)
```

## Pattern Review Checklist

Before submitting:

- [ ] Pattern has unique, descriptive name
- [ ] Description explains the security risk clearly
- [ ] Severity is appropriate for the vulnerability
- [ ] Category matches the attack vector
- [ ] Regex compiles without errors
- [ ] Tested against real code samples
- [ ] False positive rate is acceptable
- [ ] Documentation is updated
- [ ] References to standards (CWE, etc.) included

## Common Pitfalls

### Overly Broad Patterns

**Bad:**
```yaml
regex: 'function'  # Matches every function!
```

**Good:**
```yaml
regex: 'eval\s*\('  # Specific to eval calls
```

### Not Escaping Special Characters

**Bad:**
```yaml
regex: 'obj.__proto__'  # . matches any character
```

**Good:**
```yaml
regex: 'obj\.\s*__proto__'  # Escaped dot
```

### Ignoring Context

**Bad:**
```yaml
regex: 'password'  # Matches in comments, strings
```

**Good:**
```yaml
regex: 'password\s*=\s*["\'][^"\']+'  # Assignment with value
```

## Maintenance

| Trigger | Action |
|---------|--------|
| False positive reported | Refine regex or lower severity |
| New attack variant | Update pattern or add new one |
| Pattern ineffective | Review and improve |
| Security standard updated | Update references |

Last Updated: 2026-03-29
