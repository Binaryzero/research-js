<!-- SCOPE: Reference — Built-in security patterns catalog -->
<!-- TYPE: Reference -->

# Security Patterns Reference

Catalog of built-in security detection patterns.

## Execution Patterns

Patterns detecting code execution vulnerabilities.

### eval-usage

| Attribute | Value |
|-----------|-------|
| **Severity** | High |
| **Category** | Execution |
| **Description** | Detects use of eval() which can execute arbitrary code |

**Pattern:** `eval\s*\(`

**Matches:**
```javascript
eval(userInput)
eval (code)
eval(
  malicious
)
```

**Does NOT match:**
```javascript
// eval in comment
const x = "eval("
```

**Remediation:**
- Use `JSON.parse()` for JSON data
- Use `new Function()` only with validated input
- Avoid dynamic code execution when possible

---

### function-constructor

| Attribute | Value |
|-----------|-------|
| **Severity** | High |
| **Category** | Execution |
| **Description** | Detects use of Function constructor with dynamic input |

**Pattern:** `new\s+Function\s*\(`

**Matches:**
```javascript
new Function(userCode)
new Function('return ' + input)
```

**Remediation:**
- Validate all inputs to Function constructor
- Use safer alternatives like JSON.parse
- Sandbox if dynamic execution is required

---

### settimeout-string

| Attribute | Value |
|-----------|-------|
| **Severity** | High |
| **Category** | Execution |
| **Description** | Detects setTimeout/setInterval with string argument |

**Pattern:** `setTimeout\s*\(\s*["\']`

**Matches:**
```javascript
setTimeout("alert('xss')", 1000)
setInterval('malicious()', 5000)
```

**Remediation:**
- Always use function references: `setTimeout(fn, 1000)`
- Never pass strings to setTimeout/setInterval

---

### child-process

| Attribute | Value |
|-----------|-------|
| **Severity** | Critical |
| **Category** | Execution |
| **Description** | Detects use of child_process module |

**Pattern:** `require\s*\(\s*["\']child_process["\']\s*\)`

**Matches:**
```javascript
const { exec } = require('child_process')
import { spawn } from 'child_process'
```

**Note:** This is informational — child_process is legitimate for many use cases. Review usage context.

---

## Network Patterns

Patterns detecting suspicious network activity.

### fetch-credentials

| Attribute | Value |
| **Severity** | Medium |
| **Category** | Network |
| **Description** | Detects fetch requests with credentials included |

**Pattern:** `fetch\s*\([^)]*credentials\s*:\s*["\']include["\']`

**Matches:**
```javascript
fetch(url, { credentials: 'include' })
fetch(url, {
  method: 'POST',
  credentials: 'include'
})
```

**Remediation:**
- Verify destination domain is trusted
- Use `same-origin` for same-domain requests
- Consider token-based auth instead of cookies

---

### xmlhttprequest-credentials

| Attribute | Value |
| **Severity** | Medium |
| **Category** | Network |
| **Description** | Detects XMLHttpRequest with credentials |

**Pattern:** `withCredentials\s*=\s*true`

**Matches:**
```javascript
xhr.withCredentials = true
req.withCredentials = true
```

---

### websocket-external

| Attribute | Value |
| **Severity** | Medium |
| **Category** | Network |
| **Description** | Detects WebSocket connections to external domains |

**Pattern:** `new\s+WebSocket\s*\(\s*["\']wss?://(?!localhost|127\.0\.0\.1)`

**Matches:**
```javascript
new WebSocket('wss://external-server.com')
new WebSocket('ws://attacker.com')
```

**Does NOT match:**
```javascript
new WebSocket('ws://localhost:8080')
new WebSocket('wss://127.0.0.1:3000')
```

---

## File Patterns

Patterns detecting file system vulnerabilities.

### path-traversal

| Attribute | Value |
| **Severity** | High |
| **Category** | Files |
| **Description** | Detects potential path traversal using ../ sequences |

**Pattern:** `(?:\.\./|\.\.\\/)`

**Matches:**
```javascript
fs.readFile(userInput + '/../../etc/passwd')
path.join(base, '../config')
```

**Remediation:**
- Validate and sanitize all path inputs
- Use path.normalize() and check result
- Implement chroot jail or sandbox

---

### fs-dynamic-path

| Attribute | Value |
| **Severity** | Medium |
| **Category** | Files |
| **Description** | Detects file system operations with dynamic paths |

**Pattern:** `fs\.(readFile|writeFile|appendFile)\s*\([^)]*\+`

**Matches:**
```javascript
fs.readFile(userInput + '.txt')
fs.writeFile(path + '/' + filename, data)
```

**Remediation:**
- Validate path components
- Use allowlists for allowed directories
- Avoid concatenating user input into paths

---

### arbitrary-file-write

| Attribute | Value |
| **Severity** | High |
| **Category** | Files |
| **Description** | Detects potential arbitrary file writes |

**Pattern:** `fs\.writeFile\s*\(\s*[^,]*[^\)]*\)`

**Note:** Broad pattern — review context carefully.

---

## Cryptography Patterns

Patterns detecting weak cryptography.

### insecure-random

| Attribute | Value |
| **Severity** | Medium |
| **Category** | Crypto |
| **Description** | Detects Math.random() used for security purposes |

**Pattern:** `Math\.random\s*\(\)`

**Matches:**
```javascript
const token = Math.random().toString(36)
const id = Math.random() * 1000000
```

**Remediation:**
- Use `crypto.randomBytes()` for tokens
- Use `crypto.randomUUID()` for IDs
- Never use Math.random() for security

---

### weak-hash-md5

| Attribute | Value |
| **Severity** | Medium |
| **Category** | Crypto |
| **Description** | Detects use of MD5 hash algorithm |

**Pattern:** `createHash\s*\(\s*["\']md5["\']\s*\)`

**Matches:**
```javascript
crypto.createHash('md5')
```

**Remediation:**
- Use SHA-256 or stronger for hashing
- Use bcrypt/argon2 for passwords
- MD5 is broken — never use for security

---

### weak-hash-sha1

| Attribute | Value |
| **Severity** | Low |
| **Category** | Crypto |
| **Description** | Detects use of SHA1 hash algorithm |

**Pattern:** `createHash\s*\(\s*["\']sha1["\']\s*\)`

**Remediation:**
- Use SHA-256 minimum for new code
- SHA1 is deprecated but not yet broken for all uses

---

### hardcoded-key

| Attribute | Value |
| **Severity** | High |
| **Category** | Crypto |
| **Description** | Detects potential hardcoded cryptographic keys |

**Pattern:** `(?:secret|key|password|token)\s*[=:]\s*["\'][a-zA-Z0-9]{16,}["\']`

**Matches:**
```javascript
const API_KEY = 'sk_live_abc123xyz789'
const secret = 'mysecretpassword123456'
```

**Note:** May have false positives — review context.

---

## Data Patterns

Patterns detecting data handling vulnerabilities.

### prototype-pollution

| Attribute | Value |
| **Severity** | High |
| **Category** | Data |
| **Description** | Detects potential prototype pollution |

**Pattern:** `\[\s*["\']\s*__proto__\s*["\']\s*\]`

**Matches:**
```javascript
obj['__proto__'] = payload
obj["__proto__"] = value
```

**Remediation:**
- Use `Object.create(null)` for maps
- Validate property names
- Use Map instead of plain objects

---

### merge-recursive

| Attribute | Value |
| **Severity** | High |
| **Category** | Data |
| **Description** | Detects recursive merge functions (common prototype pollution vector) |

**Pattern:** `function\s+merge\s*\([^)]*\)\s*\{[^}]*recursive|\.\s*assign\s*\([^)]*\)\s*;?\s*\.\s*assign`

**Note:** Complex pattern — review implementation carefully.

---

### insecure-deserialization

| Attribute | Value |
| **Severity** | Critical |
| **Category** | Data |
| **Description** | Detects insecure deserialization |

**Pattern:** `JSON\.parse\s*\([^)]*\)|eval\s*\(\s*[^)]*JSON`

**Matches:**
```javascript
JSON.parse(userInput)
eval('(' + json + ')')
```

**Remediation:**
- Validate JSON schema before parsing
- Use reviver function to sanitize
- Never eval JSON

---

## Information Disclosure Patterns

Patterns detecting information leaks.

### debug-logging

| Attribute | Value |
| **Severity** | Low |
| **Category** | Data |
| **Description** | Detects console.log statements |

**Pattern:** `console\.(log|debug|info)\s*\(`

**Matches:**
```javascript
console.log("User:", user)
console.debug(password)
```

**Note:** Informational only — console.log is common in development.

---

### stack-trace-exposure

| Attribute | Value |
| **Severity** | Medium |
| **Category** | Data |
| **Description** | Detects potential stack trace exposure |

**Pattern:** `\.stack\s*\+\s*["\']|res\.send\s*\(\s*[^)]*err[^)]*\)`

**Matches:**
```javascript
res.send(error.stack)
return err + " occurred"
```

**Remediation:**
- Log stack traces server-side only
- Send generic error messages to client
- Use error handling middleware

---

## Pattern Statistics

| Category | Count | Most Common |
|----------|-------|-------------|
| Execution | 4 | eval-usage |
| Network | 3 | fetch-credentials |
| Files | 3 | path-traversal |
| Crypto | 4 | insecure-random |
| Data | 4 | prototype-pollution |
| **Total** | **18** | — |

## Maintenance

| Trigger | Action |
|---------|--------|
| New pattern added | Update catalog |
| Pattern modified | Update description |
| Pattern removed | Remove from catalog |
| Category changed | Reorganize sections |

Last Updated: 2026-03-29
