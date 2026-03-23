<!-- SCOPE: System architecture, layers, data flow, component design -->

# Architecture

System architecture for the Extension Security Analyzer.

## System Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Web UI (Nunjucks)                     │
│  index.html │ batch.html │ report.html │ settings.html  │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTP / SSE
┌──────────────────────▼──────────────────────────────────┐
│                  Fastify Server (src/index.ts)           │
│  API Routes │ SSE Progress │ Scan Registry │ Templates   │
└──────┬───────────┬──────────────┬───────────────────────┘
       │           │              │
┌──────▼──┐ ┌──────▼──────┐ ┌────▼────────────────────────┐
│ Services │ │  Analyzer   │ │      LLM Enhancement        │
│download  │ │static.ts    │ │llm.ts │ llm-batch.ts        │
│market-   │ │patterns.ts  │ │ConsensusOrchestrator        │
│place     │ │scoring.ts   │ │FastRiskAssessor             │
│          │ │report.ts    │ │                             │
└──────────┘ └─────────────┘ └────────────┬───────────────┘
                                          │
                              ┌───────────▼───────────────┐
                              │    Providers Layer        │
                              │OllamaProvider (fetch)     │
                              │LlmProvider interface      │
                              └───────────────────────────┘
```

## Layer Responsibilities

| Layer | Files | Responsibility |
|-------|-------|---------------|
| **Web UI** | `assets/templates/*.html`, `assets/static/` | User interaction, form submission, SSE consumption, report rendering |
| **Server** | `src/index.ts`, `src/config.ts` | HTTP routing, SSE endpoints, scan lifecycle, config persistence |
| **Services** | `src/services/download.ts`, `marketplace.ts` | VS Code Marketplace API, VSIX download/extraction |
| **Analyzer** | `src/analyzer/static.ts`, `patterns.ts`, `scoring.ts`, `report.ts` | Pattern matching, file analysis, score calculation, report generation |
| **LLM** | `src/analyzer/llm.ts`, `llm-batch.ts` | Finding assessment, consensus orchestration, executive summaries |
| **Providers** | `src/providers/ollama-provider.ts` | HTTP transport to LLM endpoints, API style detection |
| **Types** | `src/types/index.ts` | Shared TypeScript interfaces and type definitions |

## Data Flow: Single Scan

```
User Input (extension ID / URL / local path)
    │
    ▼
Download & Extract VSIX ──► tempDir with extension files
    │
    ▼
Static Analysis (patterns.yaml regex matching)
    │
    ▼
Findings[] + Endpoints[] + FileStats + Metadata
    │
    ▼
[Optional] LLM Enhancement
    ├─► FastRiskAssessor (heuristic pre-filter)
    ├─► Main Model Assessment (strategic/bulk)
    ├─► Judge Models Assessment (consensus)
    └─► Executive Summary + Verdict
    │
    ▼
Score Calculation (0-100 suspicion score)
    │
    ▼
Report Generation (markdown) ──► Saved to reports dir
    │
    ▼
SSE Progress Events ──► UI Update
```

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| In-memory scan registry (`Map<string, ScanTaskEmitter>`) | Scans are short-lived; no need for persistent queue |
| SSE for progress | Simpler than WebSocket for unidirectional progress updates |
| External pattern files (YAML) | Security patterns evolve independently of code |
| Provider abstraction (`LlmProvider` interface) | Swap LLM backends without changing analysis logic |
| Multi-model consensus | Reduce false positives by cross-validating with independent models |
| `fastify.inject()` for testing | HTTP-level integration tests without starting a real server |

## Path Resolution

TypeScript compiles `src/` → `dist/`. Runtime paths resolve from `dist/` back to project root:

| Resource | Runtime Path |
|----------|-------------|
| Templates | `join(__dirname, '..', 'assets', 'templates')` |
| Static files | `join(__dirname, '..', 'assets', 'static')` |
| Patterns | `join(__dirname, '..', 'docs', 'patterns.yaml')` |
| Prompts | `join(__dirname, '..', 'prompts.yaml')` |
| Config | `join(__dirname, '..', 'config.json')` |
| Reports | `join(__dirname, '..', 'assets', 'reports')` or `REPORTS_DIR` env var |

## Maintenance

| Trigger | Action |
|---------|--------|
| New layer or major component added | Update System Overview diagram and Layer table |
| Data flow changed | Update Data Flow diagram |
| New design decision made | Add to Key Design Decisions table |

Last Updated: 2026-03-22
