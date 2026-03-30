<!-- SCOPE: Tutorial — Adding custom security patterns -->
<!-- TYPE: Tutorial -->

# Custom Patterns Tutorial

Learn to add your own security detection patterns.

## What You'll Learn

By the end of this tutorial, you will:
- Understand the pattern YAML structure
- Write effective regex patterns
- Test patterns before deployment
- Deploy patterns to your analyzer

## Prerequisites

Before starting:
- Complete the [Getting Started Tutorial](getting-started.md)
- Basic understanding of regular expressions
- Text editor for YAML files

## Step 1: Understand Pattern Structure

Patterns are defined in `docs/patterns.yaml`. Each pattern has these fields:

```yaml
patterns:
  - name: pattern-name
    description: What this pattern detects
    severity: high
    category: execution
    regex: 'regex pattern here'
```

### Field Reference

| Field | Required | Description | Example |
|-------|----------|-------------|---------|
| `name` | Yes | Unique identifier | `unsafe-eval` |
| `description` | Yes | Human-readable explanation | "Detects eval() usage" |
| `severity` | Yes | `critical`, `high`, `medium`, `low` | `high` |
| `category` | Yes | `network`, `crypto`, `files`, `exec`, `data` | `exec` |
| `regex` | Yes | JavaScript-compatible regex | `'eval\\s*\\('` |
| `flags` | No | Regex flags | `gi` |

## Step 2: Create a Test Pattern

Let's create a pattern to detect `console.log` statements (useful for finding debug code):

1. Open `docs/patterns.yaml` in your editor

2. Add a new pattern at the end:

```yaml
  - name: debug-logging
    description: Detects console.log statements that may leak sensitive information
    severity: low
    category: data
    regex: 'console\.log\s*\('
    flags: g
```

3. Save the file

## Step 3: Test Your Pattern

### Method 1: Using the CLI

```bash
npm run cli -- patterns test ./test-file.js
```

Create a test file:

```javascript
// test-file.js
console.log("User password:", password);  // Should match
console.log("Debug info");                 // Should match
const x = 1;                              // Should not match
```

### Method 2: Using the Web UI

1. Navigate to http://127.0.0.1:8001
2. Click "Pattern Test"
3. Paste your test code
4. Click "Test Patterns"

## Step 4: Validate Pattern Syntax

Check your patterns file for errors:

```bash
npm run cli -- patterns validate
```

Expected output:
```
✓ patterns.yaml is valid
  - 15 patterns loaded
  - All regexes compile successfully
```

Common errors:
- Invalid YAML syntax
- Malformed regex
- Duplicate pattern names

## Step 5: Reload Patterns

Patterns are hot-reloadable. After saving:

1. The server automatically reloads patterns on next scan
2. Or trigger reload via API:

```bash
curl -X POST http://127.0.0.1:8001/api/patterns/reload
```

## Step 6: Test with Real Extension

Run a scan to see your pattern in action:

```bash
npm run cli -- scan some.extension -o test-report.md
```

Check the report for your pattern name in the findings.

## Pattern Writing Best Practices

### Be Specific

**Bad:** Too broad, many false positives
```yaml
regex: 'fetch'  # Matches any fetch usage
```

**Good:** Specific to suspicious behavior
```yaml
regex: 'fetch\s*\([^)]*credentials\s*:\s*["\']include'
```

### Escape Properly

YAML requires escaping backslashes:

```yaml
# In YAML, write:
regex: 'eval\s*\('

# Which becomes in JavaScript:
/eval\s*\(/g
```

### Test Edge Cases

Consider:
- Whitespace variations
- Comments between tokens
- Different quote styles
- Minified code

### Use Appropriate Severity

| Severity | When to Use |
|----------|-------------|
| Critical | Remote code execution, credential theft |
| High | eval, dynamic imports, path traversal |
| Medium | Weak crypto, debug logging |
| Low | Information disclosure, TODOs |

## Advanced Pattern Techniques

### Capturing Groups

Use groups to extract specific parts:

```yaml
regex: 'fetch\s*\(\s*["\']([^"\']+)["\']'
# Captures the URL being fetched
```

### Negative Lookahead

Exclude safe patterns:

```yaml
regex: 'eval\s*\((?!\s*["\']\s*\))'
# Matches eval() but not eval("")
```

### Multi-line Patterns

For patterns spanning lines:

```yaml
regex: 'function\s+\w+\s*\([^)]*\)\s*\{[^}]*eval'
flags: gsi
```

## Pattern Categories

Choose the right category for your pattern:

| Category | Use For | Examples |
|----------|---------|----------|
| `network` | HTTP requests, WebSockets | fetch, XMLHttpRequest |
| `exec` | Code execution | eval, Function, child_process |
| `files` | File system operations | fs.readFile, path traversal |
| `crypto` | Cryptography | Math.random, weak hashes |
| `data` | Data handling | prototype pollution, deserialization |

## Troubleshooting

### Pattern not matching

1. Test regex in [regex101.com](https://regex101.com) (JavaScript flavor)
2. Check for YAML escaping issues
3. Verify flags are appropriate

### Too many false positives

1. Make regex more specific
2. Add negative lookahead/behind
3. Consider LLM enhancement to filter

### Pattern crashes scanner

1. Check for catastrophic backtracking in regex
2. Validate with `patterns validate`
3. Test on small files first

## Sharing Patterns

To contribute patterns back:

1. Document the pattern thoroughly
2. Include test cases
3. Submit via pull request
4. Explain the security risk

## Next Steps

Now that you can create custom patterns:

- **[Interpret Scan Reports](../how-to/interpret-reports.md)** — Understand your findings
- **[Configure LLM Integration](../how-to/configure-llm.md)** — Reduce false positives
- **[Architecture Overview](../explanation/architecture.md)** — Understand how patterns work

## Maintenance

| Trigger | Action |
|---------|--------|
| New pattern syntax | Update Field Reference |
| New category added | Update Pattern Categories |
| Common issue identified | Add to Troubleshooting |

Last Updated: 2026-03-29
