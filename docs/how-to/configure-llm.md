<!-- SCOPE: How-to guide — Setting up LLM integration for false positive detection -->
<!-- TYPE: How-to -->

# Configure LLM Integration

Enable AI-powered false positive detection using Ollama or OpenAI-compatible APIs.

## Goal

Configure the Extension Security Analyzer to use LLM models for reducing false positives in scan results.

## Prerequisites

Before starting:
- Extension Security Analyzer installed and running
- Access to an LLM API (local or remote)

## Supported LLM Providers

| Provider | Setup Complexity | Privacy | Cost |
|----------|------------------|---------|------|
| **Ollama** (Local) | Low | High (local) | Free |
| **OpenAI** | Low | Low (cloud) | Per-token |
| **Azure OpenAI** | Medium | Medium | Per-token |
| **Custom** | Medium | Varies | Varies |

## Option 1: Ollama (Recommended for Local)

### Step 1: Install Ollama

Download and install Ollama from [ollama.com](https://ollama.com):

```bash
# macOS/Linux
curl -fsSL https://ollama.com/install.sh | sh

# Or download from https://ollama.com/download
```

### Step 2: Pull a Model

Download a model for security analysis:

```bash
# Recommended: llama3.2 (good balance of speed and quality)
ollama pull llama3.2

# Alternative: codellama (code-focused)
ollama pull codellama

# Alternative: mistral (fast)
ollama pull mistral
```

### Step 3: Verify Ollama is Running

```bash
ollama list
```

You should see your downloaded model.

### Step 4: Configure the Analyzer

Create or edit `.env` in the project root:

```bash
# LLM Configuration
LLM_URL=http://localhost:11434
LLM_MODEL=llama3.2
LLM_CONCURRENCY=5
```

### Step 5: Test the Configuration

Restart the server:

```bash
npm run dev
```

Run a scan with LLM enhancement enabled. Check the logs for LLM queries.

## Option 2: OpenAI

### Step 1: Get API Key

Sign up at [platform.openai.com](https://platform.openai.com) and create an API key.

### Step 2: Configure Environment

```bash
# .env file
LLM_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
LLM_API_KEY=sk-your-api-key-here
LLM_CONCURRENCY=10
```

### Step 3: Test

```bash
npm run dev
```

## Option 3: Azure OpenAI

### Step 1: Create Azure OpenAI Resource

Follow [Azure documentation](https://learn.microsoft.com/azure/ai-services/openai/how-to/create-resource) to create a resource.

### Step 2: Deploy a Model

Deploy a model (e.g., `gpt-4o-mini`) in the Azure portal.

### Step 3: Configure

```bash
# .env file
LLM_URL=https://your-resource.openai.azure.com/openai/deployments/your-deployment
LLM_MODEL=gpt-4o-mini
LLM_API_KEY=your-azure-api-key
LLM_CONCURRENCY=10
```

## Verification

### Check Configuration Endpoint

```bash
curl http://127.0.0.1:8001/api/config
```

Expected response:
```json
{
  "llm": {
    "enabled": true,
    "url": "http://localhost:11434",
    "model": "llama3.2",
    "concurrency": 5
  }
}
```

### Test with a Scan

Run a scan and check the report for LLM confidence scores:

```bash
# Start a scan
curl -X POST http://127.0.0.1:8001/api/scan \
  -H "Content-Type: application/json" \
  -d '{"extensionId": "publisher.extension-name"}'
```

In the report, look for:
- `llmConfidence` field on findings
- `analyzedBy` indicating LLM review

## Troubleshooting

### "Connection refused" Error

**Cause:** Ollama not running or wrong port.

**Solution:**
```bash
# Check if Ollama is running
ollama list

# Start Ollama if needed
ollama serve

# Verify port
curl http://localhost:11434/api/tags
```

### "Model not found" Error

**Cause:** Model not downloaded.

**Solution:**
```bash
ollama pull llama3.2
```

### Slow Response Times

**Cause:** Model too large or concurrency too high.

**Solutions:**
1. Use a smaller model (e.g., `llama3.2` instead of `llama3.1:70b`)
2. Reduce `LLM_CONCURRENCY` in `.env`
3. Ensure GPU acceleration is enabled (check Ollama logs)

### High API Costs (OpenAI/Azure)

**Cause:** Too many LLM calls or large prompts.

**Solutions:**
1. Reduce `LLM_CONCURRENCY` to limit parallel requests
2. Adjust prompts in `prompts.yaml` to be more concise
3. Filter findings before LLM review (configure in `config.ts`)

## Advanced Configuration

### Custom Prompts

Edit `prompts.yaml` to customize LLM instructions:

```yaml
analysis_prompt: |
  Analyze this code finding for false positives.
  Pattern: {{pattern}}
  Severity: {{severity}}
  
  Code context:
  {{context}}
  
  Is this a true security issue? Reply with:
  - confidence: 0-100
  - reasoning: brief explanation
```

Changes are hot-reloadable via `/api/prompts` endpoint.

### Multi-Model Consensus

Configure multiple providers for consensus:

```javascript
// src/config.ts
llm: {
  providers: [
    { url: 'http://localhost:11434', model: 'llama3.2', weight: 1 },
    { url: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKey: process.env.OPENAI_KEY, weight: 2 }
  ],
  consensusThreshold: 0.6
}
```

## Performance Tuning

| Setting | Default | Recommendation |
|---------|---------|----------------|
| `LLM_CONCURRENCY` | 10 | Start with 5, increase if CPU allows |
| Model size | - | Use 7B-13B params for speed/quality balance |
| GPU | - | Enable for 10x+ speedup |

## Next Steps

- **[Interpret Scan Reports](interpret-reports.md)** — Understanding LLM confidence scores
- **[Extend Security Patterns](extend-patterns.md)** — Adding custom detection patterns

## Maintenance

| Trigger | Action |
|---------|--------|
| New LLM provider supported | Add to Supported LLM Providers table |
| Default model changes | Update Step 2 in Option 1 |
| New configuration options | Add to Advanced Configuration |

Last Updated: 2026-03-29
