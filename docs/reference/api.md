<!-- SCOPE: Reference — REST API endpoint specifications -->
<!-- TYPE: Reference -->

# REST API Reference

Complete reference for the Extension Security Analyzer REST API.

## Base URL

```
http://127.0.0.1:8001/api
```

All endpoints return JSON unless otherwise specified.

## Endpoints Overview

| Method | Endpoint | Description |
|----------|----------|-------------|
| GET | `/health` | Health check |
| POST | `/scan` | Start a new scan |
| GET | `/scan/:id` | Get scan status and results |
| GET | `/scan/:id/stream` | SSE stream for real-time updates |
| POST | `/batch` | Start batch scan |
| GET | `/batch/:id` | Get batch status |
| GET | `/reports` | List available reports |
| GET | `/reports/:id` | Download report |
| GET | `/config` | Get current configuration |
| POST | `/config` | Update configuration |
| GET | `/prompts` | Get LLM prompts |
| POST | `/prompts` | Update LLM prompts |

---

## Health Check

### `GET /api/health`

Check if the server is running.

**Response:**
```json
{
  "status": "ok",
  "version": "1.0.0",
  "timestamp": "2026-03-29T10:30:00Z"
}
```

---

## Scan Operations

### Start Scan

### `POST /api/scan`

Start a new security scan.

**Request Body:**
```json
{
  "extensionId": "esbenp.prettier-vscode",
  "version": "10.1.0"
}
```

Or upload a VSIX file:
```bash
curl -X POST -F "file=@extension.vsix" http://127.0.0.1:8001/api/scan
```

**Response:**
```json
{
  "scanId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "pending",
  "message": "Scan queued"
}
```

### Get Scan Status

### `GET /api/scan/:id`

Retrieve scan status and results.

**Response (in progress):**
```json
{
  "scanId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "analyzing",
  "progress": {
    "filesScanned": 45,
    "totalFiles": 120,
    "patternsMatched": 12
  }
}
```

**Response (complete):**
```json
{
  "scanId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "complete",
  "result": {
    "riskScore": 35,
    "findings": [
      {
        "pattern": "eval-usage",
        "severity": "high",
        "file": "src/extension.js",
        "line": 45,
        "context": "eval(userInput)"
      }
    ],
    "summary": {
      "critical": 0,
      "high": 2,
      "medium": 5,
      "low": 8
    }
  }
}
```

### Stream Updates

### `GET /api/scan/:id/stream`

Server-Sent Events stream for real-time scan progress.

**Event Types:**

| Event | Data | Description |
|-------|------|-------------|
| `progress` | `{"filesScanned": 45, "totalFiles": 120}` | Scan progress |
| `finding` | Finding object | New pattern match |
| `complete` | Full result | Scan finished |
| `error` | Error message | Scan failed |

**Example (JavaScript client):**
```javascript
const eventSource = new EventSource('/api/scan/550e8400-e29b-41d4-a716-446655440000/stream');

eventSource.addEventListener('progress', (e) => {
  const data = JSON.parse(e.data);
  console.log(`Scanned ${data.filesScanned}/${data.totalFiles}`);
});

eventSource.addEventListener('complete', (e) => {
  const result = JSON.parse(e.data);
  console.log('Scan complete:', result);
  eventSource.close();
});
```

---

## Batch Operations

### Start Batch Scan

### `POST /api/batch`

Scan multiple extensions.

**Request Body:**
```json
{
  "extensions": [
    "esbenp.prettier-vscode",
    "dbaeumer.vscode-eslint",
    "ms-python.python"
  ]
}
```

**Response:**
```json
{
  "batchId": "batch-550e8400-e29b-41d4-a716-446655440000",
  "status": "pending",
  "total": 3,
  "queued": 3
}
```

### Get Batch Status

### `GET /api/batch/:id`

**Response:**
```json
{
  "batchId": "batch-550e8400-e29b-41d4-a716-446655440000",
  "status": "running",
  "progress": {
    "completed": 1,
    "failed": 0,
    "pending": 2,
    "total": 3
  },
  "results": [
    {
      "extensionId": "esbenp.prettier-vscode",
      "status": "complete",
      "riskScore": 15
    }
  ]
}
```

---

## Reports

### List Reports

### `GET /api/reports`

**Response:**
```json
{
  "reports": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "extensionId": "esbenp.prettier-vscode",
      "createdAt": "2026-03-29T10:30:00Z",
      "riskScore": 35
    }
  ]
}
```

### Download Report

### `GET /api/reports/:id`

Returns the Markdown report file.

---

## Configuration

### Get Configuration

### `GET /api/config`

**Response:**
```json
{
  "port": 8001,
  "host": "127.0.0.1",
  "llm": {
    "enabled": true,
    "url": "http://localhost:11434",
    "model": "llama3.2",
    "concurrency": 10
  }
}
```

### Update Configuration

### `POST /api/config`

**Request Body:**
```json
{
  "llm": {
    "concurrency": 20
  }
}
```

**Note:** Changes take effect immediately but are not persisted across restarts.

---

## Prompts

### Get Prompts

### `GET /api/prompts`

Returns the current LLM prompts configuration.

### Update Prompts

### `POST /api/prompts`

Update LLM prompts (hot-reloadable).

**Request Body:**
```yaml
analysis_prompt: |
  Analyze the following code for security issues...
```

---

## Error Responses

All errors follow this format:

```json
{
  "error": {
    "code": "SCAN_NOT_FOUND",
    "message": "Scan with ID 550e8400-e29b-41d4-a716-446655440000 not found",
    "status": 404
  }
}
```

### Common Error Codes

| Code | Status | Description |
|------|--------|-------------|
| `INVALID_REQUEST` | 400 | Malformed request body |
| `SCAN_NOT_FOUND` | 404 | Scan ID doesn't exist |
| `EXTENSION_NOT_FOUND` | 404 | Extension not in marketplace |
| `SCAN_FAILED` | 500 | Internal scan error |

## Maintenance

| Trigger | Action |
|---------|--------|
| New endpoint added | Add to Endpoints Overview table |
| Response format changes | Update all examples |
| New error code | Add to Common Error Codes table |

Last Updated: 2026-03-29
