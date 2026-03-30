<!-- SCOPE: Tutorial — Learning to scan multiple extensions -->
<!-- TYPE: Tutorial -->

# Batch Analysis Tutorial

Learn to analyze multiple VS Code extensions efficiently.

## What You'll Learn

By the end of this tutorial, you will:
- Create a batch of extensions to analyze
- Run concurrent scans for efficiency
- Compare results across multiple extensions
- Generate a consolidated report

## Prerequisites

Before starting:
- Complete the [Getting Started Tutorial](getting-started.md)
- Have 3-5 extension IDs ready (or use the examples)

## Step 1: Create Extension List

Create a text file with extension IDs, one per line:

```bash
# extensions.txt
cat > extensions.txt << EOF
esbenp.prettier-vscode
dbaeumer.vscode-eslint
ms-python.python
ms-vscode.vscode-json
redhat.vscode-yaml
EOF
```

Each line should be a valid VS Code extension identifier in the format `publisher.name`.

## Step 2: Prepare Batch Directory

Create a directory for batch reports:

```bash
mkdir -p ./batch-reports
```

## Step 3: Start Batch Scan

Using the CLI:

```bash
npm run cli -- batch extensions.txt -o ./batch-reports -c 3
```

Or using the web UI:

1. Navigate to http://127.0.0.1:8001
2. Click "Batch Analysis"
3. Upload your `extensions.txt` file
4. Set concurrency to 3
5. Click "Start Batch"

## Step 4: Monitor Progress

The batch scan will:
- Queue all extensions
- Process up to 3 concurrently
- Show progress for each extension
- Save individual reports

**Expected timeline:**
- 5 extensions × 20 seconds each = ~100 seconds total
- With concurrency of 3: ~40 seconds

## Step 5: Review Individual Reports

Each extension gets its own report:

```bash
ls ./batch-reports/
# esbenp.prettier-vscode-2026-03-29.md
# dbaeumer.vscode-eslint-2026-03-29.md
# ...
```

Open any report to see:
- Risk score
- Findings by severity
- Detailed analysis

## Step 6: Compare Results

Create a summary comparison:

```bash
# Extract risk scores from all reports
grep "Risk Score" ./batch-reports/*.md
```

Example output:
```
esbenp.prettier-vscode-2026-03-29.md: **Risk Score**: 15/100 (Low)
dbaeumer.vscode-eslint-2026-03-29.md: **Risk Score**: 22/100 (Low)
ms-python.python-2026-03-29.md: **Risk Score**: 45/100 (Medium)
ms-vscode.vscode-json-2026-03-29.md: **Risk Score**: 12/100 (Low)
redhat.vscode-yaml-2026-03-29.md: **Risk Score**: 28/100 (Low)
```

## Step 7: Generate Consolidated Report

The batch scan creates a summary report:

```bash
cat ./batch-reports/summary.md
```

Contents include:
- Total extensions scanned
- Average risk score
- Highest risk extensions
- Common findings across extensions

## Understanding Batch Results

### Risk Score Distribution

| Score Range | Count | Interpretation |
|-------------|-------|----------------|
| 0-20 (Low) | 3 | Generally safe |
| 21-50 (Medium) | 2 | Review recommended |
| 51-80 (High) | 0 | Careful review |
| 81-100 (Critical) | 0 | Avoid |

### Common Patterns

Look for patterns that appear across multiple extensions:

| Pattern | Occurrences | Severity |
|---------|-------------|----------|
| fetch-credentials | 4/5 | Medium |
| debug-logging | 3/5 | Low |
| eval-usage | 1/5 | High |

Patterns appearing in many extensions may be:
- Common coding practices (likely false positives)
- Widespread vulnerabilities (requires attention)

## Troubleshooting

### Batch scan fails immediately

**Cause:** Invalid extension ID format
**Solution:** Verify all IDs match `publisher.name` format

### Some extensions fail to download

**Cause:** Extension not found or network issues
**Solution:** Check extension exists on marketplace

### Reports are empty

**Cause:** Extensions have no JavaScript/TypeScript code
**Solution:** Normal for pure-theme extensions

## Best Practices

### Concurrency Settings

| Scenario | Recommended Concurrency |
|----------|------------------------|
| Local Ollama | 2-3 (limited by CPU) |
| Cloud LLM API | 5-10 (higher rate limits) |
| No LLM | 5-10 (CPU-bound only) |

### Batch Size

- **Small (1-10)**: Quick analysis, easy review
- **Medium (10-50)**: Category analysis
- **Large (50+)**: Research/statistics (use overnight)

### Organizing Results

```
batch-reports/
├── 2026-03-29-python-extensions/
│   ├── summary.md
│   ├── ms-python.python.md
│   └── ...
├── 2026-03-29-formatters/
│   ├── summary.md
│   └── ...
└── ...
```

## Next Steps

Now that you've completed batch analysis:

- **[Configure LLM Integration](../how-to/configure-llm.md)** — Improve accuracy with AI
- **[Interpret Scan Reports](../how-to/interpret-reports.md)** — Deep dive into findings
- **[Custom Patterns Tutorial](custom-patterns.md)** — Add your own detection rules

## Maintenance

| Trigger | Action |
|---------|--------|
| UI workflow changes | Update Step 3 |
| New batch features | Add to Understanding Batch Results |
| Performance improvements | Update timeline estimates |

Last Updated: 2026-03-29
