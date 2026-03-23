<!-- SCOPE: Development principles, decision framework, and anti-patterns -->

# Development Principles

Guiding principles for development decisions in the Extension Security Analyzer.

## Core Principles

| # | Principle | Description |
|---|-----------|-------------|
| 1 | **Security First** | Never introduce OWASP Top 10 vulnerabilities. Sanitize all user input. Use DOMPurify for HTML rendering. |
| 2 | **Static Over Dynamic** | Prefer compile-time checks (strict TypeScript, `noUnusedLocals`) over runtime validation for internal code. |
| 3 | **Minimal Complexity** | Only add what is directly needed. Three similar lines beat a premature abstraction. No speculative features. |
| 4 | **Pattern-Driven Analysis** | Security patterns live in `docs/patterns.yaml` — external, hot-reloadable, not hardcoded in source. |
| 5 | **Prompt Separation** | LLM prompts live in `prompts.yaml` — editable without code changes, reloadable via API. |
| 6 | **Isolate Side Effects** | Pure functions for scoring, parsing, grouping. Side effects (network, disk) confined to providers and services. |
| 7 | **Test at Boundaries** | Use `fastify.inject()` for API tests. Mock external services (fetch, fs). Test pure functions directly. |
| 8 | **ES Module Discipline** | Use `.js` extensions in all imports. NodeNext resolution. No CommonJS mixing. |

## Decision Framework

When making implementation choices, evaluate in this order:

1. **Does it introduce a security risk?** → If yes, reject or mitigate first
2. **Is it the simplest solution?** → Prefer direct code over abstractions
3. **Does it respect the boundary?** → Patterns/prompts external, providers isolated, pure functions pure
4. **Is it testable?** → If not, restructure to make it so

## Anti-Patterns

| Anti-Pattern | Why It's Wrong | Do This Instead |
|-------------|----------------|-----------------|
| Hardcoded regex patterns | Patterns can't be updated without deployment | Use `docs/patterns.yaml` |
| LLM prompts in source code | Prompts need rapid iteration | Use `prompts.yaml` |
| Mocking fs in integration tests | Masks real filesystem behavior | Use temp directories, clean up in afterEach |
| `innerHTML` without sanitization | XSS vulnerability | Always use `DOMPurify.sanitize()` |
| Tests that write to project root | Overwrites real config/data | Use isolated temp directories or mock writes |
| Catching errors silently | Hides bugs in LLM/network code | Log errors, return typed empty results |

## Conventions

| Convention | Rule |
|-----------|------|
| Import extensions | Always `.js` even for `.ts` files |
| Module system | ES modules only, `"type": "module"` |
| TypeScript strictness | All strict flags enabled, no `any` |
| Test isolation | Each test creates/cleans its own temp directory |
| Config files | Never edit `docs/patterns.yaml` or `prompts.yaml` programmatically in tests |

## Maintenance

| Trigger | Action |
|---------|--------|
| New architectural pattern adopted | Add to Core Principles |
| Bug caused by anti-pattern | Add to Anti-Patterns table |
| Convention changed | Update Conventions table |

Last Updated: 2026-03-22
