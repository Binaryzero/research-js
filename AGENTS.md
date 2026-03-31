# Extension Security Analyzer

VS Code extension security analyzer with static analysis and LLM-enhanced reporting.

## Development Commands

```bash
npm run dev          # Development server with hot reload (tsx watch)
npm run build        # TypeScript compilation (tsc)
npm start            # Production server (node dist/index.js)
npm run cli          # CLI tool for direct analysis
npm test             # Run tests once (vitest run)
npm run test:watch   # Run tests in watch mode (vitest)
npm run lint         # Type checking (tsc --noEmit)
```
> Workspace-specific Copilot bootstrap instructions are in `.github/copilot-instructions.md`.
## Architecture

### Core Flow
1. **Static Analysis** (`src/analyzer/static.ts`) - Extracts VSIX, scans JS/TS files for security patterns defined in `docs/patterns.yaml`
2. **Scoring** (`src/analyzer/scoring.ts`) - Calculates suspicion score based on findings
3. **LLM Enhancement** (`src/analyzer/llm.ts`) - Optional LLM analysis for false positive detection using prompts from `prompts.yaml`
4. **Report Generation** (`src/analyzer/report.ts`) - Markdown report output

### Key Files
- `src/index.ts` - Fastify server with SSE endpoints for scan progress
- `src/config.ts` - Server config, LLM settings, prompt loading
- `src/analyzer/patterns.ts` - Pattern loading and regex compilation
- `src/services/download.ts` - VS Code Marketplace download utilities
- `src/services/marketplace.ts` - Marketplace search API integration

### Templates
- `assets/templates/` - Nunjucks HTML templates (base.html, index.html, batch.html, history.html, settings.html, report.html)
- `assets/static/` - CSS and JavaScript frontend assets

### Paths
Compiled JS outputs to `dist/`. Paths in code use `join(__dirname, '..')` to resolve from `dist/` to project root.

## Configuration

- Environment variables: `PORT`, `HOST`, `LLM_MODEL`, `LLM_URL`, `REPORTS_DIR`
- `prompts.yaml` - LLM prompt templates (hot-reloadable via `/api/prompts`)
- `docs/patterns.yaml` - Security pattern definitions

## LLM Integration

Supports OpenAI-compatible APIs (Ollama, OpenAI, etc.). Configure in Settings UI or via environment. LLM analysis is optional - static analysis runs without it.
