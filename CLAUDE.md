# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
# Development server with hot reload
npm run dev

# Build TypeScript to dist/
npm run build

# Run production server (uses dist/)
npm start

# Run CLI tool for direct analysis
npm run cli

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Type checking only
npm run lint
npm run typecheck
```

## Architecture Overview

This is a VS Code extension security analyzer with a Fastify web server, static analysis engine, and optional LLM enhancement.

**Documentation:** See [docs/README.md](docs/README.md) for complete documentation organized by the Diátaxis Framework.

### Core Flow

1. **Static Analysis** (`src/analyzer/static.ts`) - Extracts VSIX files, scans JS/TS for security patterns defined in `docs/patterns.yaml`, performs file type detection using magic bytes
2. **Pattern Matching** (`src/analyzer/patterns.ts`) - Loads regex patterns from YAML, compiles with flags, matches against file content
3. **Scoring** (`src/analyzer/scoring.ts`) - Calculates suspicion score (0-100) based on finding risk levels (critical=10, high=5, medium=2, low=1)
4. **LLM Enhancement** (`src/analyzer/llm.ts`) - Optional OpenAI-compatible API analysis for false positive detection using prompts from `prompts.yaml`
5. **Report Generation** - Each scan writes three artifacts: a markdown report (`src/analyzer/report.ts`), the persisted structured result (`.json`), and a standalone interactive HTML report (`src/analyzer/report-html.ts`, embedding the slim payload from `src/analyzer/render-model.ts` plus the shared client renderer `assets/static/report-view.js` with a hash-based CSP). The web UI report page renders interactively from `GET /api/reports/:name/data` and falls back to markdown for legacy scans. Endpoint filtering is shared across generators via `src/analyzer/endpoint-filter.ts`.

### Server Architecture

- `src/index.ts` - Fastify server with SSE endpoints for real-time scan progress, file upload handling, API routes
- `src/config.ts` - Configuration loading with auto-port detection, prompt loading from YAML
- In-memory scan registry (`Map<string, ScanTaskEmitter>`) for tracking scan state
- Nunjucks templating for HTML UI (`assets/templates/`)

### Services Layer

- `src/services/download.ts` - VS Code Marketplace extension download, URL parsing, VSIX extraction
- `src/services/marketplace.ts` - Marketplace search API integration

### Path Resolution

TypeScript compiles `src/` to `dist/`. Runtime paths use `join(__dirname, '..')` to resolve from `dist/` to project root for accessing:
- `assets/` - templates, static files, reports
- `docs/patterns.yaml` - security pattern definitions
- `prompts.yaml` - LLM prompt templates

## Configuration

Environment variables (all optional):
- `PORT` - Server port (default: 8001)
- `HOST` - Bind address (default: 127.0.0.1)
- `LLM_MODEL` - Model name (default: llama3.2)
- `LLM_URL` - OpenAI-compatible API URL (default: http://localhost:11434)
- `LLM_CONCURRENCY` - Parallel LLM requests (default: 20; lower if you hit 429s)
- `REPORTS_DIR` - Report output directory

Hot-reloadable config:
- `prompts.yaml` - LLM prompts reloadable via `/api/prompts` endpoint
- `docs/patterns.yaml` - Security patterns loaded at scan time

## Testing

Vitest configuration in `vitest.config.ts`. Tests use `fastify.inject()` for HTTP-level integration testing without starting a real server. Tests create temporary directories in `.temp-test/` for isolation.

## Key Conventions

- ES modules with `.js` extensions in imports (even for `.ts` files)
- NodeNext module resolution
- Strict TypeScript with unused variable/parameter checking enabled
- Pattern matching uses pre-compiled regexes with category-based risk levels
