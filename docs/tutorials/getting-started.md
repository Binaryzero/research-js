<!-- SCOPE: Tutorial — First-time user getting started with their first scan -->
<!-- TYPE: Tutorial -->

# Getting Started with Extension Security Analyzer

Learn how to run your first security scan on a VS Code extension.

## What You'll Learn

By the end of this tutorial, you will:
- Install and start the Extension Security Analyzer
- Scan a VS Code extension for security vulnerabilities
- View and understand the scan results

## Prerequisites

Before starting, ensure you have:
- Node.js 18 or higher installed
- npm or yarn package manager
- A web browser

## Step 1: Install Dependencies

Open a terminal in the project directory and install the required packages:

```bash
npm install
```

This installs Fastify, Nunjucks, and other dependencies listed in `package.json`.

## Step 2: Start the Development Server

Start the server with hot-reload enabled:

```bash
npm run dev
```

You should see output indicating the server is running:

```
Server listening on http://127.0.0.1:8001
```

## Step 3: Access the Web Interface

Open your web browser and navigate to:

```
http://127.0.0.1:8001
```

You'll see the Extension Security Analyzer dashboard with options to search the marketplace or upload a VSIX file.

## Step 4: Search for an Extension

1. In the search box, type a popular extension name (e.g., "prettier")
2. Click "Search" or press Enter
3. Select an extension from the results

The analyzer will automatically download and begin scanning the extension.

## Step 5: View the Scan Progress

As the scan runs, you'll see real-time updates:
- Download progress
- Extraction status
- Files being analyzed
- Patterns matched

The scan typically takes 10-30 seconds depending on the extension size.

## Step 6: Review the Results

Once complete, you'll see:

### Summary Card
- **Risk Score**: 0-100 indicating overall suspicion level
- **Critical/High/Medium/Low**: Count of findings by severity
- **Files Scanned**: Number of JavaScript/TypeScript files analyzed

### Findings Table
Each finding shows:
- **Pattern**: The security pattern that matched
- **Severity**: Critical, High, Medium, or Low
- **File**: Location in the extension code
- **Line**: Specific line number
- **Context**: Code snippet showing the match

### Risk Score Interpretation

| Score | Meaning | Action |
|-------|---------|--------|
| 0-20 | Low risk | Generally safe to use |
| 21-50 | Medium risk | Review findings before use |
| 51-80 | High risk | Careful review recommended |
| 81-100 | Critical risk | Avoid or extensive audit required |

## Step 7: Download the Report

Click "Download Report" to save a Markdown file containing:
- Executive summary
- Detailed findings
- Risk breakdown by category
- Recommendations

## Next Steps

Now that you've completed your first scan:

- **[Batch Analysis Tutorial](batch-analysis.md)** — Learn to scan multiple extensions
- **[Interpret Scan Reports](../how-to/interpret-reports.md)** — Deep dive into understanding findings
- **[Configure LLM Integration](../how-to/configure-llm.md)** — Enable AI-powered false positive detection

## Troubleshooting

### Server won't start
- Check if port 8001 is already in use
- Try setting a different port: `PORT=8002 npm run dev`

### Extension not found
- Verify the extension name is correct
- Try searching with partial names
- Check your internet connection

### Scan hangs
- Large extensions may take longer
- Check the terminal for error messages
- Try a smaller extension first

## Maintenance

| Trigger | Action |
|---------|--------|
| UI changes | Update screenshots and step descriptions |
| New scan features | Add to Step 5 or create new step |
| Default port changes | Update all port references |

Last Updated: 2026-03-29
