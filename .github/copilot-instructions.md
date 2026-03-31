# Copilot workspace instructions

This repository is a TypeScript-based VS Code extension security analyzer with a Fastify web UI and optional LLM augmentation.

## Use this file for agent guidance
- Use this file as the workspace-specific Copilot bootstrap instruction set.
- Do not duplicate large design or architecture content from `docs/README.md` or `CLAUDE.md`.
- When more detail is needed, link to existing docs instead of embedding them.

## Key commands
- `npm install` to install dependencies
- `npm run dev` to run the app in development mode via `tsx src/index.ts`
- `npm run build` to compile TypeScript via `tsc`
- `npm start` to run the compiled server from `dist/index.js`
- `npm run cli` to run the CLI entrypoint
- `npm test` to execute tests once
- `npm run test:watch` to run Vitest in watch mode
- `npm run lint` / `npm run typecheck` to validate all TypeScript

## What this repo does
- Downloads and scans VSIX extension packages
- Runs static security analysis against regex-based patterns in `docs/patterns.yaml`
- Optionally uses LLM analysis for false positive filtering and consensus
- Generates markdown reports under `assets/reports/`
- Exposes a browser UI with scan, history, batch, settings, and report endpoints

## Primary code boundaries
- `src/index.ts` — server bootstrap, routes, API endpoints
- `src/config.ts` — configuration loading and environment defaults
- `src/analyzer/` — static analysis, LLM analysis, scoring, batch orchestration
- `src/services/` — marketplace download integration and helper services
- `assets/templates/` + `assets/static/` — frontend view templates and assets
- `docs/` — project documentation and reference material

## Important conventions
- This is a native ES module project (`type: "module"`) targeting Node 18+
- Keep builds in `dist/`; do not edit generated files there directly
- Prefer existing docs links for architecture, requirements, and principles
- `AGENTS.md` currently contains a high-level project summary, not Copilot instructions

## Helpful docs
- `CLAUDE.md` — AI agent entry point and architecture summary
- `docs/README.md` — documentation hub and navigation
- `docs/project/architecture.md` — system design and component behavior
- `docs/principles.md` — development guidelines and project principles

## When editing this repo
- Validate code with `npm run lint` / `npm run typecheck`
- Run affected tests with `npm test`
- Keep workspace-specific guidance here and leave deep design in `docs/`
- If the user asks for a new feature or fix, prefer linking to `docs/project/architecture.md` rather than recreating the design there

## Example prompts
- "Inspect this repo and tell me where the security pattern engine lives."
- "Add an endpoint to `src/index.ts` that returns the current scan status."
- "Update the LLM prompt loader to support a new prompt file format."
- "Run the test suite and explain any failing assertions."
