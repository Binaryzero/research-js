<!-- SCOPE: REST API endpoints, request/response contracts -->

# API Specification

REST API endpoints served by the Fastify server (`src/index.ts`).

## Pages (HTML)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Analyze page (single scan UI) |
| GET | `/batch` | Batch scan page |
| GET | `/history` | Scan history page |
| GET | `/settings` | LLM and scan configuration |
| GET | `/report/:name` | Report viewer |

## Scan Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/scan` | Start a single extension scan |
| GET | `/api/scan/:scanId/progress` | SSE stream for real-time scan progress |
| GET | `/api/scan/:scanId/result` | Poll scan result (status, findings, report) |
| DELETE | `/api/scan/:scanId` | Cancel a running scan |

### POST /api/scan

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| input_source | string | yes | Extension ID, marketplace URL, local path, or VSIX path |
| no_llm | string | no | `"true"` to skip LLM enhancement |
| full_output | string | no | `"true"` for detailed analysis |
| model | string | no | Override LLM model name |
| ollama_url | string | no | Override LLM endpoint URL |

**Response:** `{ scan_id: string }`

### GET /api/scan/:scanId/progress

SSE stream emitting events:

| Event | Data | Description |
|-------|------|-------------|
| progress | `{ progress: number, message: string }` | Progress update (0.0–1.0) |
| complete | `{ report_name, markdown, extensionId, ... }` | Scan finished |
| error | `{ error: string }` | Scan failed |

## Report Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/reports` | List all saved reports |
| GET | `/api/reports/:name` | Get report content (markdown) |
| DELETE | `/api/reports/:name` | Delete a report |

## History Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/history` | List scan history (supports `?page`, `?limit`, `?sort`, `?verdict`, `?risk`, `?llm`) |
| DELETE | `/api/history` | Clear all history |
| DELETE | `/api/history/:extension_id` | Delete history for specific extension |

## Model & Config Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/models` | List available models (`?ollama_url=` to specify endpoint) |
| POST | `/api/models` | List models for a specific base URL |
| GET | `/api/config` | Get current AppConfig (API keys sanitized) |
| POST | `/api/config` | Save AppConfig (main model, judges, consensus settings) |
| POST | `/api/test-connection` | Test connectivity to an LLM endpoint |

### POST /api/config

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| main | ModelSlotConfig | yes | Main model configuration |
| judges | ModelSlotConfig[] | no | Judge model configurations |
| consensus | object | no | `{ judgesValidateAllFindings: boolean }` |
| assessmentMode | string | no | `"strategic"` or `"bulk"` |
| concurrency | number | no | Parallel LLM request limit |

## Prompt Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/prompts` | Get current prompt configuration |
| POST | `/api/prompts` | Update prompts (saves to `prompts.yaml`) |

## Search & Batch Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/search` | Search VS Code Marketplace |
| POST | `/api/parse-search-url` | Parse a marketplace search URL into parameters |
| POST | `/api/batch-scan` | Start batch scan of multiple extensions |
| POST | `/api/batch-llm-analyze` | Start batch LLM re-analysis |
| POST | `/api/llm-analyze` | Start LLM re-analysis for single extension |

## Health

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | `{ status: "ok", timestamp: "..." }` |

## Maintenance

| Trigger | Action |
|---------|--------|
| New API route added | Add to appropriate section with method, path, description |
| Request/response contract changed | Update field tables |
| Route removed | Remove from table |

Last Updated: 2026-03-22
