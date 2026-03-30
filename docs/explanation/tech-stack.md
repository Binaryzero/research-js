<!-- SCOPE: Explanation — Technology choices and their rationale -->
<!-- TYPE: Explanation -->

# Technology Stack

Why we chose these technologies for the Extension Security Analyzer.

## Overview

| Layer | Technology | Version | Purpose |
|-------|------------|---------|---------|
| Runtime | Node.js | >= 18 | JavaScript execution |
| Language | TypeScript | 5.9 | Type-safe development |
| Framework | Fastify | 5.8 | Web server |
| Templates | Nunjucks | 3.x | HTML rendering |
| Testing | Vitest | 2.x | Unit/integration tests |
| Build | tsc | 5.9 | TypeScript compilation |

## Runtime: Node.js

**Why Node.js?**

The extension analyzer processes JavaScript/TypeScript code, so using Node.js provides:
- **Native AST parsing** via `acorn` or `espree`
- **Familiar ecosystem** for JS/TS developers
- **Single language** across the stack
- **Excellent async I/O** for network operations

**Why version 18+?**

- **Native fetch()**: No need for external HTTP libraries
- **Performance improvements**: Faster startup and execution
- **Security updates**: Long-term support (LTS) versions
- **ES modules**: First-class support for `import`/`export`

**Alternatives Considered:**
- **Python**: Excellent for security tools, but adds language context switch
- **Go**: Fast, but lacks native JS parsing ecosystem
- **Rust**: Secure, but steeper learning curve for contributors

## Language: TypeScript

**Why TypeScript?**

Security tools require correctness. TypeScript provides:
- **Compile-time error detection**: Catch bugs before runtime
- **IDE support**: Autocomplete, navigation, refactoring
- **Self-documenting code**: Types clarify intent
- **Strict mode**: `noImplicitAny`, `strictNullChecks` prevent common errors

**Key Configuration:**

```json
{
  "compilerOptions": {
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "exactOptionalPropertyTypes": true
  }
}
```

These strict settings force explicit handling of edge cases, reducing bugs.

**Trade-off:** Build step required, but `tsc` is fast and CI catches errors.

## Framework: Fastify

**Why Fastify over Express?**

| Feature | Fastify | Express |
|---------|---------|---------|
| Performance | ~2x faster | Baseline |
| Schema validation | Built-in | Requires middleware |
| Async/await | First-class | Callback-based |
| Plugin architecture | Encouraged | Ad-hoc |
| TypeScript support | Excellent | Good |

**Specific Benefits:**

1. **JSON Schema validation**: Request/response validation with types
2. **Hooks**: Clean separation of concerns
3. **Plugin system**: Modular, testable architecture
4. **Benchmark leadership**: Consistently fastest Node.js framework

**Example:**

```typescript
// Schema validation built-in
fastify.post('/scan', {
  schema: {
    body: {
      type: 'object',
      properties: {
        extensionId: { type: 'string' }
      }
    }
  }
}, handler);
```

## Templates: Nunjucks

**Why Nunjucks?**

For the web UI, we needed:
- **Server-side rendering**: No client-side JS required
- **Template inheritance**: Base layouts with blocks
- **Security**: Auto-escaping by default (XSS prevention)
- **Familiar syntax**: Jinja2-like, widely understood

**Security Feature:**

```html
<!-- Auto-escaped by default -->
<p>{{ userInput }}</p>

<!-- Explicitly safe (use sparingly) -->
<p>{{ htmlContent | safe }}</p>
```

**Alternative Considered:**
- **EJS**: Popular, but less secure defaults
- **Handlebars**: Good, but no template inheritance
- **React SSR**: Overkill for this use case

## Testing: Vitest

**Why Vitest over Jest?**

| Feature | Vitest | Jest |
|---------|--------|------|
| Native ESM | ✅ | ⚠️ Experimental |
| TypeScript | Native | Requires ts-jest |
| Performance | Faster | Slower |
| Vite integration | Native | N/A |
| Modern features | Latest | Stable but older |

**Key Features We Use:**

1. **ESM native**: No CommonJS interop issues
2. **TypeScript**: No separate compilation step
3. **Fastify inject**: HTTP-level testing without server startup
4. **Isolation**: Tests run in parallel with proper cleanup

**Example:**

```typescript
import { test, expect } from 'vitest';
import fastify from '../src/index.js';

test('POST /api/scan creates scan', async () => {
  const response = await fastify.inject({
    method: 'POST',
    url: '/api/scan',
    payload: { extensionId: 'test.ext' }
  });
  
  expect(response.statusCode).toBe(201);
  expect(JSON.parse(response.payload)).toHaveProperty('scanId');
});
```

## Build: TypeScript Compiler

**Why tsc over esbuild/swc?**

For this project:
- **tsc is fast enough**: < 2 seconds for our codebase
- **Type checking**: Build fails on type errors (feature, not bug)
- **Declaration files**: Generates `.d.ts` for IDE support
- **No bundling needed**: Server-side code, no client bundle

**For production:**

```bash
npm run build  # tsc --outDir dist
npm start      # node dist/index.js
```

**Trade-off:** Slower than esbuild, but type safety is worth it.

## Package Management: npm

**Why npm over yarn/pnpm?**

- **Ubiquitous**: No additional tool to install
- **Workspaces**: Monorepo support if needed later
- **Audit**: Built-in security auditing
- **Lockfile**: `package-lock.json` for reproducible builds

## Development Tools

### ESLint + TypeScript ESLint

Static analysis for code quality:
- `@typescript-eslint/recommended`: TypeScript best practices
- `@typescript-eslint/strict`: Additional strictness
- `no-console`: Prevent debug logging in production

### Prettier

Consistent formatting:
- Single source of truth for style
- No debates about formatting in PRs
- IDE integration for auto-format on save

## Security Considerations

### Dependency Security

- **npm audit**: Run in CI to catch known vulnerabilities
- **Minimal dependencies**: Fastify + Nunjucks + Vitest only
- **Lockfile**: Reproducible, auditable builds

### Runtime Security

- **DOMPurify**: Sanitizes HTML in templates
- **Strict TypeScript**: Prevents common injection vulnerabilities
- **Input validation**: JSON Schema on all endpoints

## Performance Characteristics

| Operation | Expected Performance |
|-----------|---------------------|
| Server startup | < 1 second |
| VSIX download | Network-bound |
| Static analysis | ~100 files/second |
| Pattern matching | ~1000 patterns/second |
| LLM query | 1-5 seconds per finding |
| Report generation | < 100ms |

**Bottlenecks:**
1. Network (VSIX download)
2. LLM API latency
3. File I/O (extraction)

**Not bottlenecks:**
- Pattern matching (regex is fast)
- JSON serialization
- Template rendering

## Future Considerations

### Potential Additions

| Technology | Use Case | Status |
|------------|----------|--------|
| Redis | Scan registry persistence | Under consideration |
| BullMQ | Job queue for scans | Under consideration |
| Prometheus | Metrics collection | Planned |
| OpenTelemetry | Distributed tracing | Planned |

### Migration Path

If we need to scale:
1. **Horizontal**: Multiple server instances behind load balancer
2. **Queue**: Redis + BullMQ for scan job distribution
3. **Database**: PostgreSQL for scan history and reports

Current architecture supports these migrations without major rewrites.

## Maintenance

| Trigger | Action |
|---------|--------|
| Major version update | Evaluate breaking changes |
| Security advisory | Update affected dependencies |
| Performance regression | Profile and optimize |
| New requirement | Assess against current stack |

Last Updated: 2026-03-29
