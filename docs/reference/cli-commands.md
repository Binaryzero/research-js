<!-- SCOPE: Reference — Command-line interface usage -->
<!-- TYPE: Reference -->

# CLI Commands Reference

Command-line interface for the Extension Security Analyzer.

## Global Installation

```bash
npm install -g extension-security-analyzer
esa --help
```

## Local Usage

```bash
npm run cli -- [command] [options]
```

## Commands

### scan

Analyze a single extension.

```bash
esa scan [options] <extension-id>
```

**Arguments:**

| Argument | Description | Example |
|----------|-------------|---------|
| `extension-id` | VS Code extension identifier | `esbenp.prettier-vscode` |

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `-v, --version` | Specific version to scan | Latest |
| `-o, --output` | Output file path | `./reports/{id}.md` |
| `-f, --format` | Output format (markdown, json) | `markdown` |
| `--no-llm` | Disable LLM enhancement | Enabled if configured |
| `--patterns` | Custom patterns file | `docs/patterns.yaml` |

**Examples:**

```bash
# Scan latest version
esa scan esbenp.prettier-vscode

# Scan specific version
esa scan esbenp.prettier-vscode -v 10.1.0

# Output to specific file
esa scan esbenp.prettier-vscode -o ./my-report.md

# JSON output
esa scan esbenp.prettier-vscode -f json
```

### batch

Analyze multiple extensions.

```bash
esa batch [options] <file>
```

**Arguments:**

| Argument | Description | Example |
|----------|-------------|---------|
| `file` | Path to file with extension IDs (one per line) | `./extensions.txt` |

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `-o, --output` | Output directory | `./reports/batch-{timestamp}/` |
| `-c, --concurrency` | Parallel scans | `3` |
| `--no-llm` | Disable LLM enhancement | Enabled if configured |

**Examples:**

```bash
# Basic batch scan
echo "esbenp.prettier-vscode" > extensions.txt
echo "dbaeumer.vscode-eslint" >> extensions.txt
esa batch extensions.txt

# High concurrency batch
esa batch extensions.txt -c 5

# Custom output directory
esa batch extensions.txt -o ./batch-reports/
```

### search

Search VS Code Marketplace.

```bash
esa search [options] <query>
```

**Arguments:**

| Argument | Description | Example |
|----------|-------------|---------|
| `query` | Search term | "python" |

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `-l, --limit` | Max results | `20` |
| `-s, --sort` | Sort by (relevance, installs, rating) | `relevance` |

**Examples:**

```bash
# Basic search
esa search python

# Top 10 results
esa search python -l 10

# Sort by installs
esa search python -s installs
```

### report

View or list reports.

```bash
esa report [options] [id]
```

**Arguments:**

| Argument | Description | Example |
|----------|-------------|---------|
| `id` | Report ID (optional) | `550e8400-e29b-41d4-a716-446655440000` |

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `-l, --list` | List all reports | `false` |
| `-o, --open` | Open in browser/editor | `false` |

**Examples:**

```bash
# List all reports
esa report -l

# View specific report
esa report 550e8400-e29b-41d4-a716-446655440000

# Open report in default editor
esa report 550e8400-e29b-41d4-a716-446655440000 -o
```

### config

View or edit configuration.

```bash
esa config [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `-g, --global` | Edit global config file |
| `-l, --local` | Edit local `.env` file |
| `--get` | Get specific key value |
| `--set` | Set specific key value |

**Examples:**

```bash
# View current config
esa config

# Get specific value
esa config --get llm.model

# Set specific value
esa config --set llm.concurrency=5

# Edit global config
esa config -g
```

### patterns

Manage security patterns.

```bash
esa patterns [command]
```

**Commands:**

| Command | Description |
|---------|-------------|
| `list` | List all patterns |
| `show <name>` | Show pattern details |
| `validate` | Validate patterns file |
| `test <file>` | Test patterns against file |

**Examples:**

```bash
# List all patterns
esa patterns list

# Show specific pattern
esa patterns show eval-usage

# Validate patterns file
esa patterns validate

# Test patterns against file
esa patterns test ./suspicious-code.js
```

### server

Start the web server.

```bash
esa server [options]
```

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `-p, --port` | Server port | `8001` |
| `-h, --host` | Bind address | `127.0.0.1` |
| `-d, --dev` | Development mode (hot reload) | `false` |

**Examples:**

```bash
# Start server
esa server

# Custom port
esa server -p 3000

# Development mode
esa server -d

# Bind to all interfaces
esa server -h 0.0.0.0
```

## Global Options

These options work with any command:

| Option | Description |
|--------|-------------|
| `-V, --version` | Show version number |
| `-h, --help` | Show help for command |
| `-v, --verbose` | Verbose output |
| `-q, --quiet` | Suppress output (errors only) |
| `--config` | Path to config file |

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | General error |
| `2` | Invalid arguments |
| `3` | Scan failed |
| `4` | Network error |
| `5` | Configuration error |

## Environment Variables

CLI commands respect these environment variables:

| Variable | Affects Commands |
|----------|------------------|
| `ESA_CONFIG` | Path to config file (all) |
| `ESA_PATTERNS` | Path to patterns file (scan, batch) |
| `LLM_URL` | LLM endpoint (scan, batch) |
| `LLM_MODEL` | LLM model (scan, batch) |
| `NO_COLOR` | Disable colored output (all) |

## Examples

### CI/CD Integration

```bash
#!/bin/bash
# Scan extension before publishing

esa scan "$EXTENSION_ID" -f json -o scan-result.json

# Check risk score
RISK_SCORE=$(jq '.riskScore' scan-result.json)
if [ "$RISK_SCORE" -gt 50 ]; then
  echo "Risk score $RISK_SCORE exceeds threshold"
  exit 1
fi
```

### Batch Analysis Script

```bash
#!/bin/bash
# Analyze top 10 Python extensions

esa search python -l 10 --format=ids > python-extensions.txt
esa batch python-extensions.txt -c 3 -o ./python-reports/

# Generate summary
echo "Batch complete. Reports in ./python-reports/"
```

## Maintenance

| Trigger | Action |
|---------|--------|
| New command added | Add to Commands table |
| Option changes | Update Options tables |
| Exit code added | Update Exit Codes table |

Last Updated: 2026-03-29
