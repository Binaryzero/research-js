<!-- SCOPE: Functional requirements and project scope -->

# Requirements

Functional requirements for the Extension Security Analyzer.

## Core Capabilities

| # | Requirement | Status |
|---|-------------|--------|
| R1 | Download VSIX packages from VS Code Marketplace by extension ID or URL | Implemented |
| R2 | Extract and scan VSIX contents for security-relevant patterns | Implemented |
| R3 | Match file content against configurable regex patterns from `docs/patterns.yaml` | Implemented |
| R4 | Detect file type mismatches using magic byte analysis | Implemented |
| R5 | Calculate suspicion score (0-100) based on finding risk levels | Implemented |
| R6 | Generate markdown reports grouped by finding category | Implemented |
| R7 | Optionally enhance analysis with LLM-based false positive detection | Implemented |
| R8 | Support multi-model consensus (main + judge models) | Implemented |
| R9 | Provide web UI for search, scan, batch operations, and report viewing | Implemented |
| R10 | Support CLI mode for headless analysis | Implemented |

## Web UI Requirements

| # | Requirement | Status |
|---|-------------|--------|
| U1 | Search VS Code Marketplace extensions with filters | Implemented |
| U2 | Single extension scan with real-time SSE progress | Implemented |
| U3 | Batch scan multiple extensions with progress tracking (X/Y counter) | Implemented |
| U4 | View scan history with filtering (status, verdict, risk level) | Implemented |
| U5 | View and navigate generated reports | Implemented |
| U6 | Configure LLM settings (models, endpoints, judges) via settings page | Implemented |
| U7 | Re-scan with LLM from report view | Implemented |
| U8 | Bulk selection and rescan from batch page | Implemented |

## LLM Integration Requirements

| # | Requirement | Status |
|---|-------------|--------|
| L1 | Support OpenAI-compatible API endpoints (Ollama, OpenRouter, etc.) | Implemented |
| L2 | Auto-detect API style (openai, chat, generate) | Implemented |
| L3 | Strategic assessment mode — group findings, sample diverse evidence | Implemented |
| L4 | Bulk assessment mode — send all findings at once | Implemented |
| L5 | Fast heuristic pre-filtering (license text, test files) | Implemented |
| L6 | Multi-model consensus with configurable judges | Implemented |
| L7 | Executive summary with verdict (CLEAN/SUSPICIOUS/MALICIOUS) | Implemented |
| L8 | Customizable prompts via `prompts.yaml` with profile support | Implemented |

## Maintenance

| Trigger | Action |
|---------|--------|
| New feature planned | Add requirement row with Status: Planned |
| Feature implemented | Update Status to Implemented |
| Requirement deprecated | Move to separate Deprecated section |

Last Updated: 2026-03-22
