<!-- SCOPE: Reference — Configuration options and environment variables -->
<!-- TYPE: Reference -->

# Configuration Reference

Complete reference for configuring the Extension Security Analyzer.

## Configuration Sources

Configuration is loaded in this priority order (highest first):

1. **Environment variables** — Runtime overrides
2. **`.env` file** — Local development settings
3. **Default values** — Built-in fallbacks

## Environment Variables

### Server Configuration

| Variable | Default | Description | Example |
|----------|---------|-------------|---------|
| `PORT` | `8001` | HTTP server port | `PORT=3000` |
| `HOST` | `127.0.0.1` | Bind address | `HOST=0.0.0.0` |
| `NODE_ENV` | `development` | Environment mode | `NODE_ENV=production` |

### LLM Configuration

| Variable | Default | Description | Example |
|----------|---------|-------------|---------|
| `LLM_URL` | `http://localhost:11434` | LLM API endpoint | `https://api.openai.com/v1` |
| `LLM_MODEL` | `llama3.2` | Model name | `gpt-4o-mini` |
| `LLM_API_KEY` | — | API key (if required) | `sk-...` |
| `LLM_CONCURRENCY` | `10` | Parallel LLM requests | `5` |
| `LLM_TIMEOUT` | `30000` | Request timeout (ms) | `60000` |

### Analysis Configuration

| Variable | Default | Description | Example |
|----------|---------|-------------|---------|
| `PATTERNS_FILE` | `docs/patterns.yaml` | Security patterns path | `/custom/patterns.yaml` |
| `PROMPTS_FILE` | `prompts.yaml` | LLM prompts path | `/custom/prompts.yaml` |
| `MAX_FILE_SIZE` | `10485760` | Max VSIX size (bytes) | `20971520` |
| `TEMP_DIR` | `os.tmpdir()` | Temporary files directory | `/tmp/scans` |

### Report Configuration

| Variable | Default | Description | Example |
|----------|---------|-------------|---------|
| `REPORTS_DIR` | `./reports` | Report output directory | `/var/reports` |
| `REPORT_FORMAT` | `markdown` | Default report format | `json` |
| `KEEP_REPORTS` | `30` | Days to keep reports | `90` |

### Security Configuration

| Variable | Default | Description | Example |
|----------|---------|-------------|---------|
| `MAX_EXTENSIONS_BATCH` | `10` | Max extensions per batch | `50` |
| `SCAN_TIMEOUT` | `300000` | Scan timeout (ms) | `600000` |
| `ALLOWED_ORIGINS` | `*` | CORS origins | `https://example.com` |

## Configuration File

Create a `.env` file in the project root:

```bash
# Server
PORT=8001
HOST=127.0.0.1

# LLM Integration
LLM_URL=http://localhost:11434
LLM_MODEL=llama3.2
LLM_CONCURRENCY=5

# Reports
REPORTS_DIR=./reports
KEEP_REPORTS=30

# Analysis
MAX_FILE_SIZE=10485760
```

## Runtime Configuration

Some settings can be changed at runtime via the API:

### GET /api/config

Returns current configuration (sensitive values masked):

```json
{
  "port": 8001,
  "host": "127.0.0.1",
  "llm": {
    "enabled": true,
    "url": "http://localhost:11434",
    "model": "llama3.2",
    "concurrency": 5
  },
  "reports": {
    "dir": "./reports",
    "keepDays": 30
  }
}
```

### POST /api/config

Update runtime configuration:

```bash
curl -X POST http://127.0.0.1:8001/api/config \
  -H "Content-Type: application/json" \
  -d '{
    "llm": {
      "concurrency": 3
    }
  }'
```

**Note:** Runtime changes are not persisted. Update `.env` for permanent changes.

## Pattern Configuration

Security patterns are defined in `docs/patterns.yaml`:

```yaml
patterns:
  - name: eval-usage
    description: Detects use of eval() which can execute arbitrary code
    severity: high
    category: execution
    regex: 'eval\s*\('
    
  - name: fetch-credentials
    description: Fetch requests with credentials included
    severity: medium
    category: network
    regex: 'fetch\s*\([^)]*credentials\s*:\s*["\']include'
```

### Pattern Fields

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `name` | Yes | string | Unique identifier |
| `description` | Yes | string | Human-readable explanation |
| `severity` | Yes | string | `critical`, `high`, `medium`, `low` |
| `category` | Yes | string | `network`, `crypto`, `files`, `exec`, `data` |
| `regex` | Yes | string | JavaScript-compatible regex |
| `flags` | No | string | Regex flags (default: `gi`) |

## Prompt Configuration

LLM prompts are defined in `prompts.yaml`:

```yaml
analysis_prompt: |
  Analyze the following code finding for false positives.
  
  Pattern: {{pattern}}
  Severity: {{severity}}
  File: {{file}}:{{line}}
  
  Code context:
  ```
  {{context}}
  ```
  
  Respond with JSON:
  {
    "confidence": 0-100,
    "reasoning": "explanation",
    "isFalsePositive": boolean
  }
```

### Template Variables

| Variable | Description |
|----------|-------------|
| `{{pattern}}` | Pattern name that matched |
| `{{severity}}` | Severity level |
| `{{file}}` | File path |
| `{{line}}` | Line number |
| `{{context}}` | Code snippet |

## Configuration Validation

The server validates configuration on startup:

| Check | Error if Failed |
|-------|-----------------|
| Port is numeric | `Invalid PORT: must be a number` |
| Port is available | `Port 8001 is already in use` |
| Patterns file exists | `PATTERNS_FILE not found: docs/patterns.yaml` |
| Reports directory writable | `REPORTS_DIR is not writable: ./reports` |
| LLM URL is valid | `Invalid LLM_URL format` |

## Production Configuration

Example `.env` for production:

```bash
# Server
PORT=8001
HOST=0.0.0.0
NODE_ENV=production

# LLM (Azure OpenAI)
LLM_URL=https://your-resource.openai.azure.com/openai/deployments/your-deployment
LLM_MODEL=gpt-4o-mini
LLM_API_KEY=your-api-key
LLM_CONCURRENCY=20

# Security
ALLOWED_ORIGINS=https://yourdomain.com
MAX_EXTENSIONS_BATCH=50
SCAN_TIMEOUT=600000

# Reports
REPORTS_DIR=/var/reports
KEEP_REPORTS=90

# Monitoring (optional)
SENTRY_DSN=https://...
LOG_LEVEL=info
```

## Maintenance

| Trigger | Action |
|---------|--------|
| New environment variable | Add to appropriate table |
| Default value changes | Update Default column |
| New validation rule | Add to Configuration Validation |

Last Updated: 2026-03-29
