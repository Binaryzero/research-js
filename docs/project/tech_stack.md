<!-- SCOPE: Technology choices, versions, and rationale -->

# Tech Stack

Technology choices for the Extension Security Analyzer.

## Runtime

| Technology | Version | Purpose |
|-----------|---------|---------|
| Node.js | >=18.0.0 | Runtime environment |
| TypeScript | 5.9.x | Type safety, strict mode |
| ES Modules | NodeNext | Module system (`"type": "module"`) |

## Server

| Technology | Version | Purpose |
|-----------|---------|---------|
| Fastify | 5.8.x | HTTP server, route handling, plugin system |
| @fastify/static | 9.0.x | Static file serving (`assets/static/`) |
| @fastify/view | 11.1.x | Nunjucks template rendering |
| @fastify/multipart | 9.4.x | File upload handling (VSIX uploads) |
| @fastify/cors | 11.2.x | Cross-origin request handling |
| Pino | 10.3.x | Structured logging |
| pino-pretty | 13.1.x | Human-readable log formatting (dev) |
| undici | 7.22.x | HTTP client for Marketplace and LLM APIs |

## Analysis

| Technology | Version | Purpose |
|-----------|---------|---------|
| js-yaml | 4.1.x | Parse patterns.yaml and prompts.yaml |
| adm-zip | 0.5.x | VSIX (ZIP) extraction |

## Templating & UI

| Technology | Version | Purpose |
|-----------|---------|---------|
| Nunjucks | 3.2.x | Server-side HTML templates |
| Vanilla JS | — | Client-side interactivity (no framework) |
| CSS Custom Properties | — | Theming and design tokens |

## Testing

| Technology | Version | Purpose |
|-----------|---------|---------|
| Vitest | 4.0.x | Test runner, mocking, assertions |
| fastify.inject() | — | HTTP-level integration testing without real server |

## Development

| Technology | Version | Purpose |
|-----------|---------|---------|
| tsx | 4.21.x | TypeScript execution for dev server and CLI |
| @types/node | 25.x | Node.js type definitions |

## Build

| Setting | Value | Rationale |
|---------|-------|-----------|
| Target | ES2022 | Modern Node.js features |
| Module | NodeNext | ES module interop |
| Strict | All flags enabled | Maximum type safety |
| outDir | `./dist` | Compiled output separate from source |

## External Dependencies (Runtime)

| Dependency | Purpose |
|-----------|---------|
| Ollama (optional) | Local LLM inference for finding assessment |
| OpenAI-compatible API (optional) | Remote LLM endpoints (OpenRouter, etc.) |
| VS Code Marketplace API | Extension search and VSIX download |

## Maintenance

| Trigger | Action |
|---------|--------|
| Dependency version bumped | Update version in relevant table |
| New technology added | Add row to appropriate table with rationale |
| Technology removed | Remove from table, note in git commit |

Last Updated: 2026-03-22
