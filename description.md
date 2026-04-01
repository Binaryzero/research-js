# Extension Security Analyzer - Technical Specification

## Overview

A TypeScript/Node.js security analysis platform for VS Code extensions that performs static analysis on VSIX files, detects security patterns using regex signatures, and uses LLM-based false positive triage to produce Markdown security reports.

## Core Architecture

### 1. Server Layer (`src/index.ts`)

- Fastify-based HTTP server with auto-port detection (starts at 8001)
- In-memory scan registry using `EventEmitter` for real-time progress tracking
- Server-Sent Events (SSE) endpoint at `/api/scan/:id/events` for live progress updates
- RESTful API endpoints for:
  - Extension scanning (`/api/scan`)
  - Marketplace search (`/api/search`)
  - Batch operations (`/api/batch-scan`, `/api/batch-llm`)
  - Report management (`/api/reports`, `/api/history`)
  - LLM configuration (`/api/models`, `/api/prompts`)
- Nunjucks templating engine for HTML UI with `assets/templates/`
- Static file serving from `assets/`

### 2. Static Analysis Engine (`src/analyzer/static.ts`)

- VSIX extraction using adm-zip
- File categorization: JS/TS files, binaries (using magic bytes), config files, assets
- Pattern matching against YAML-defined security signatures (`docs/patterns.yaml`)
- Pattern categories: supplyChain, permissionAbuse, network, exfiltration, codeExecution, obfuscation, aiAgent, secrets
- File type mismatch detection (e.g., JS file with PNG magic bytes)
- Endpoint extraction from JS files using regex (URLs, IPs, WebSocket addresses)
- Dependency analysis from package.json with "notable dependency" flagging
- Telemetry configuration detection
- Binary hash calculation (SHA-256)

### 3. Pattern System (`src/analyzer/patterns.ts`, `docs/patterns.yaml`)

- YAML configuration with version field
- Pattern definition: regex pattern, optional flags, description, risk level (critical/high/medium/low), optional note
- Pre-compiled regexes for performance
- Categories:
  - **supplyChain**: Malicious dependencies
  - **permissionAbuse**: Unnecessary VS Code API usage
  - **network**: External communication
  - **exfiltration**: Data theft patterns
  - **codeExecution**: eval, Function constructor
  - **obfuscation**: Packed/encoded code
  - **aiAgent**: AI configuration tampering
  - **secrets**: Hardcoded credentials

### 4. Scoring System (`src/analyzer/scoring.ts`)

- Calculates suspicion score 0-100 based on weighted findings
- Weights: critical=10, high=5, medium=2, low=1
- LLM-adjusted scoring that reduces false positives
- Risk label calculation based on score thresholds

### 5. LLM Integration (`src/analyzer/llm.ts`, `src/analyzer/llm-batch.ts`)

Two assessment modes:

#### Strategic Mode (Default)

- Groups findings by pattern + file path
- Diverse sampling: first occurrence, last occurrence, distributed samples
- Sample size calculation based on risk and file type (extension code vs bundled dependency vs config)
- Critical patterns in extension code get full assessment (all occurrences)
- Extrapolates assessments from samples to similar findings
- ~50-200 LLM calls for 3000 findings

#### Bulk Mode

- Single LLM call with all findings
- Fast heuristic pre-filtering for obvious false positives (license text, test files, non-English words, TypeScript compilation artifacts)
- Groups findings by category in prompt for organization
- JSON array response format
- Automatic fallback to strategic mode on failure
- Requires large context model (1M+ tokens) and high max_tokens

Both modes output: `riskLevel` (critical/high/medium/low/none), `isFalsePositive`, `falsePositiveReason`, `explanation`, `recommendation` (investigate/likely_benign/dismiss)

### 6. Report Generation (`src/analyzer/report.ts`)

- Markdown output with executive summary, statistics, findings by category
- Full vs truncated output modes
- Severity filtering and grouping
- LLM-generated prose for findings (optional)

### 7. Configuration (`src/config.ts`)

- Environment variable-based config with auto-detection
- LLM config: model, baseUrl, timeout, maxTokens, temperature, concurrency, assessmentMode
- Server config: port, host, reportsDir, patternsFile, historyFile
- Hot-reloadable prompts from `prompts.yaml`

### 8. CLI Tool (`src/cli.ts`)

- Standalone CLI using `util.parseArgs`
- Args: --output, --model, --no-llm, --verbose, --json, --full, --help
- Direct VSIX or directory analysis
- Progress logging to stdout

### 9. Web UI (`assets/templates/`)

- Base template with navigation
- Index: Extension ID input with marketplace search suggestions
- Scan page: Real-time progress with SSE, expandable log view
- Report view: Markdown rendering with tabs (report, findings by category, raw JSON)
- Settings: LLM connection, model selection, API style, assessment mode toggle, prompt customization
- History: Previous scans table with filtering

### 10. Services (`src/services/`)

- `download.ts`: VSIX download from VS Code Marketplace, URL parsing, extraction
- `marketplace.ts`: Marketplace search API integration using VS Code's public API

## Data Types (`src/types/index.ts`)

### Finding

- category, title, location (file:line), observation, evidence (code snippet)
- lineStart, lineEnd, context, isFalsePositive, falsePositiveReason, riskLevel

### AnalysisResult

- Extension metadata (name, version, publisher, description, repository, install count)
- File inventory (jsFiles, binaryFiles, configFiles, assetFiles, agentConfigFiles)
- File stats and type information
- Permissions, dependencies, notableDependencies
- Telemetry config, VSIX manifest
- Endpoints array
- Findings array
- Executive summary
- Pattern search results by category

### LlmAssessment

- riskLevel, isFalsePositive, falsePositiveReason, explanation, recommendation

### ScanTask

- id, status (pending/running/complete/failed/cancelled), progress (0-1), message, log[], result, error

## Key Implementation Details

1. **ES Modules**: Uses `.js` extensions in imports even for TypeScript files
2. **NodeNext module resolution**
3. **Strict TypeScript**: Unused variable checking enabled
4. **Magic bytes detection**: For identifying actual file types vs extensions
5. **Fast heuristic assessor**: Pre-filters obvious false positives before LLM calls
6. **Scan task registry**: `Map<string, ScanTaskEmitter>` for tracking active scans
7. **File size limits**: Evidence truncated to 1500 chars for LLM prompts
8. **Progressive scan states**:
   - Download (0-10%)
   - Extract (10-15%)
   - Static Analysis (15-40%)
   - LLM Analysis (40-88%)
   - Report Generation (88-100%)

## Testing Strategy

- Vitest for unit/integration tests
- `fastify.inject()` for HTTP-level testing without real server
- Temporary directories in `.temp-test/` for isolation
- Pattern matching tests, scoring tests, API endpoint tests

## Deployment

- Single Node.js process
- No database (file-based history JSON)
- In-memory scan state (resets on restart)
- Optional: Docker container with Ollama sidecar for local LLM

## Summary

This is essentially a specialized static analysis platform combining traditional signature-based detection with LLM-powered false positive reduction, packaged as both a web service and CLI tool.
