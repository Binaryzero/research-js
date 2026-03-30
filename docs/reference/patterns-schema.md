<!-- SCOPE: Reference — Pattern YAML schema and structure -->
<!-- TYPE: Reference -->

# Pattern Schema Reference

Complete reference for the security patterns YAML schema.

## File Location

Default: `docs/patterns.yaml`

## Schema Structure

```yaml
patterns:
  - name: string          # Required: Unique identifier
    description: string   # Required: Human-readable explanation
    severity: enum        # Required: critical | high | medium | low
    category: enum        # Required: network | crypto | files | exec | data
    regex: string         # Required: JavaScript-compatible regex
    flags: string         # Optional: Regex flags (default: 'gi')
```

## Field Reference

### name

- **Type:** `string`
- **Required:** Yes
- **Pattern:** `^[a-z0-9-]+$`
- **Description:** Unique identifier for the pattern
- **Example:** `eval-usage`, `fetch-credentials`, `path-traversal`

**Naming conventions:**
- Use lowercase letters, numbers, and hyphens
- Be descriptive but concise
- Use kebab-case (hyphen-separated)

### description

- **Type:** `string`
- **Required:** Yes
- **Min length:** 10 characters
- **Max length:** 500 characters
- **Description:** Human-readable explanation of what the pattern detects

**Good descriptions:**
- "Detects use of eval() which can execute arbitrary code"
- "Identifies fetch requests with credentials sent to external domains"
- "Finds potential path traversal vulnerabilities in file operations"

### severity

- **Type:** `enum`
- **Required:** Yes
- **Values:** `critical`, `high`, `medium`, `low`
- **Description:** Severity level affecting risk score calculation

| Value | Weight | Use When |
|-------|--------|----------|
| `critical` | 10 | Remote code execution, credential exfiltration |
| `high` | 5 | eval usage, dynamic imports, path traversal |
| `medium` | 2 | Weak crypto, debug logging |
| `low` | 1 | Information disclosure, TODOs |

### category

- **Type:** `enum`
- **Required:** Yes
- **Values:** `network`, `crypto`, `files`, `exec`, `data`
- **Description:** Attack vector category for grouping findings

| Category | Description | Examples |
|----------|-------------|----------|
| `network` | Network activity | fetch, XMLHttpRequest, WebSocket |
| `crypto` | Cryptography | Math.random, weak hashes, hardcoded keys |
| `files` | File system | fs module, path traversal |
| `exec` | Code execution | eval, Function, child_process |
| `data` | Data handling | prototype pollution, deserialization |

### regex

- **Type:** `string`
- **Required:** Yes
- **Description:** JavaScript-compatible regular expression
- **Format:** Must be a valid JavaScript RegExp

**Escaping rules:**
- YAML requires backslash escaping
- Write `'eval\s*\('` in YAML
- Becomes `/eval\s*\(/` in JavaScript

**Common patterns:**

| Pattern | YAML Regex | Matches |
|---------|------------|---------|
| eval() | `'eval\s*\('` | `eval(`, `eval (`, `eval\n(` |
| fetch with credentials | `'fetch\s*\([^)]*credentials\s*:\s*["\']include'` | fetch with credentials: 'include' |
| path traversal | `'\.\./'` | `../` sequences |
| console.log | `'console\.log\s*\('` | `console.log(`, `console.log (` |

### flags

- **Type:** `string`
- **Required:** No
- **Default:** `gi`
- **Description:** JavaScript RegExp flags

| Flag | Meaning | Use When |
|------|---------|----------|
| `g` | Global | Match all occurrences (usually yes) |
| `i` | Case-insensitive | Pattern should match regardless of case |
| `m` | Multiline | `^` and `$` match line boundaries |
| `s` | DotAll | `.` matches newlines |
| `u` | Unicode | Pattern includes Unicode characters |
| `y` | Sticky | Match only from lastIndex |

**Common combinations:**
- `gi` — Global, case-insensitive (default)
- `g` — Global only (case-sensitive)
- `gim` — Global, case-insensitive, multiline

## Complete Example

```yaml
patterns:
  - name: eval-usage
    description: Detects use of eval() which can execute arbitrary code from user input
    severity: high
    category: exec
    regex: 'eval\s*\('
    flags: gi

  - name: fetch-credentials
    description: Identifies fetch requests that include credentials, potentially sending auth tokens to untrusted domains
    severity: medium
    category: network
    regex: 'fetch\s*\([^)]*credentials\s*:\s*["\']include["\']'
    flags: gi

  - name: path-traversal
    description: Detects potential path traversal vulnerabilities using ../ sequences in file paths
    severity: high
    category: files
    regex: '(?:\.\./|\.\.\\/)'
    flags: g

  - name: insecure-random
    description: Finds usage of Math.random() for security purposes which is not cryptographically secure
    severity: medium
    category: crypto
    regex: 'Math\.random\s*\(\)'
    flags: g
```

## Validation Rules

The patterns file is validated on load:

| Rule | Error Message |
|------|---------------|
| Valid YAML syntax | `Invalid YAML: [details]` |
| Required fields present | `Pattern [name] missing required field: [field]` |
| Unique pattern names | `Duplicate pattern name: [name]` |
| Valid regex syntax | `Invalid regex in pattern [name]: [error]` |
| Valid severity value | `Invalid severity '[value]' in pattern [name]` |
| Valid category value | `Invalid category '[value]' in pattern [name]` |
| Valid flags | `Invalid flags '[value]' in pattern [name]` |

## Pattern Testing

Test patterns before deployment:

```bash
# Validate all patterns
npm run cli -- patterns validate

# Test against a file
npm run cli -- patterns test ./suspicious-code.js

# Test specific pattern
npm run cli -- patterns show eval-usage
```

## Hot Reloading

Patterns are automatically reloaded on each scan. To force reload:

```bash
curl -X POST http://127.0.0.1:8001/api/patterns/reload
```

## Best Practices

### Pattern Design

1. **Be specific** — Avoid overly broad patterns
2. **Test thoroughly** — Validate against real code
3. **Document clearly** — Explain the security risk
4. **Use appropriate severity** — Consider actual impact
5. **Choose right category** — Helps with prioritization

### Regex Guidelines

1. **Escape properly** — Remember YAML escaping
2. **Avoid catastrophic backtracking** — Test with long inputs
3. **Use non-capturing groups** — `(?:...)` when no extraction needed
4. **Consider minified code** — Patterns should work on single lines
5. **Test edge cases** — Whitespace, comments, different quotes

### Maintenance

| Trigger | Action |
|---------|--------|
| New vulnerability type | Add pattern |
| False positive reported | Refine regex |
| Pattern effectiveness low | Review and improve |
| New category needed | Update schema |

Last Updated: 2026-03-29
