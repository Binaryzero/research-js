<!-- SCOPE: Runtime environment, deployment, and operational configuration -->

# Infrastructure

Runtime environment and deployment configuration.

## Runtime Environment

| Component | Specification |
|-----------|--------------|
| Runtime | Node.js >=18.0.0 |
| Memory | `--max-old-space-size=4096` (production start script) |
| Module system | ES Modules (NodeNext) |
| Build output | `dist/` directory |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| PORT | 8001 | HTTP server port |
| HOST | 127.0.0.1 | Bind address |
| LLM_MODEL | llama3.2 | Default LLM model name |
| LLM_URL | http://localhost:11434 | OpenAI-compatible API endpoint |
| LLM_CONCURRENCY | 10 | Max parallel LLM requests |
| REPORTS_DIR | `assets/reports/` | Report output directory |

## File System Layout (Runtime)

| Path | Purpose | Persistence |
|------|---------|-------------|
| `dist/` | Compiled TypeScript output | Rebuilt on `npm run build` |
| `assets/templates/` | Nunjucks HTML templates | Cached by Nunjucks |
| `assets/static/` | CSS, JS, images | Served by @fastify/static |
| `assets/reports/` | Generated markdown reports | Persistent |
| `config.json` | Multi-model LLM configuration | Persistent, written by POST /api/config |
| `prompts.yaml` | LLM prompt templates | Persistent, hot-reloadable |
| `docs/patterns.yaml` | Security regex patterns | Persistent, loaded per scan |

## External Dependencies

| Service | Required | Purpose |
|---------|----------|---------|
| Ollama | Optional | Local LLM inference (default endpoint) |
| OpenAI-compatible API | Optional | Remote LLM (OpenRouter, vLLM, etc.) |
| VS Code Marketplace | Required for search/download | Extension metadata and VSIX packages |

## Development vs Production

| Aspect | Development | Production |
|--------|------------|------------|
| Command | `npm run dev` (tsx watch) | `npm start` (node dist/) |
| Hot reload | TypeScript recompilation on save | No — restart required |
| Memory | Default Node.js limits | 4GB (`--max-old-space-size=4096`) |
| Logging | Pino with pino-pretty | Pino structured JSON |

## Maintenance

| Trigger | Action |
|---------|--------|
| New environment variable added | Add to Environment Variables table |
| External service dependency changed | Update External Dependencies table |
| Deployment model changed | Update Development vs Production table |

Last Updated: 2026-03-22
