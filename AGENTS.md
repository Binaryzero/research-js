# Extension Security Analyzer

VS Code extension security analyzer with static analysis and LLM-enhanced reporting.

## Development Commands

<!-- fallow:setup-hooks:start -->
## Fallow checks

Use fallow for code-quality, cleanup, and setup tasks in this repository. Fallow checks the changed code before each `git commit` and `git push`. In Claude Code and Codex, a PreToolUse hook from `fallow agent install` runs this check and blocks the command when the verdict is `fail`. Other agents run the check themselves: `fallow audit --format json --quiet --explain --gate-marker agent`. If the verdict is `fail`, fix the reported findings before you try again. A JSON runtime error such as `{ "error": true, ... }` does not block.

Audit defaults to `gate=new-only`: only findings introduced by the current changeset affect the verdict. Inherited findings on touched files are reported under `attribution` and annotated with `introduced: false`, but do not block the commit. Set `[audit] gate = "all"` in `fallow.toml` to gate every finding in changed files.

For non-skill agents, treat the task map below as the local onboarding source: run the listed fallow command before destructive edits, before commits, and before pull request handoff.

## Fallow task map

| When the agent is about to... | Run |
|---|---|
| delete an "unused" export or file | `fallow dead-code --trace <file>:<export>` |
| prove a TypeScript symbol's exact consumers before refactoring | `fallow dead-code --type-aware --symbol-impact <file>:<export-or-class.method>` |
| find how one module reaches another | `fallow trace --path <from> <to>` (Reports `reachable: false` instead of failing when no import path exists; type-only hops are reported, not skipped.) |
| delete an "unused" dependency | `fallow dead-code --trace-dependency <name>` |
| migrate a dependency | `fallow trace --dependency <name> --sites` (Counts each imported name, follows one hop through project wrappers, and counts each use that it cannot resolve.) |
| commit or open a PR | `fallow audit --base <ref>` |
| read a diff before approving it | `fallow review --base <ref> --brief` (orientation, never gates: deterministic and always exit 0, unlike the audit row) |
| prioritize refactoring | `fallow health --hotspots --targets` |
| ask who owns code | `fallow health --ownership` |
| check untested-but-reachable code | `fallow health --coverage-gaps` |
| consolidate duplication | `fallow dupes --trace dup:<fingerprint>` |
| find feature flags | `fallow flags` |
| check which architecture rules apply to a file before changing it | `fallow guard <files>` |
| check import cycles, boundaries and policy rules after changing code | `fallow architecture` |
| surface security candidates | `fallow security` |
| understand a finding | `fallow explain <issue-type>` |
| scope a monorepo | `--workspace <glob> / --changed-workspaces <ref>` (global flags, prefix any command) |
<!-- fallow:setup-hooks:end -->

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
