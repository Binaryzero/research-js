<!-- SCOPE: How-to guide — Installing and setting up the analyzer -->
<!-- TYPE: How-to -->

# Install the Extension Security Analyzer

Set up the Extension Security Analyzer on your local machine.

## Goal

Install the analyzer and verify it's working correctly.

## Prerequisites

| Requirement | Version | Check Command |
|-------------|---------|---------------|
| Node.js | >= 18 | `node --version` |
| npm | >= 9 | `npm --version` |
| Git | Any | `git --version` |

## Installation Steps

### Step 1: Clone the Repository

```bash
git clone https://github.com/Binaryzero/research-js.git
cd research-js
```

### Step 2: Install Dependencies

```bash
npm install
```

This installs all required packages including:
- Fastify 5.8 (web server)
- Nunjucks (templating)
- Vitest (testing)
- TypeScript 5.9

### Step 3: Verify Installation

Run the test suite to ensure everything is working:

```bash
npm test
```

Expected output:
```
 ✓ tests/analyzer.test.ts (15 tests)
 ✓ tests/api.test.ts (8 tests)
 ...
 Test Files  8 passed (8)
```

### Step 4: Start the Server

Development mode (with hot-reload):
```bash
npm run dev
```

Production mode:
```bash
npm run build
npm start
```

### Step 5: Verify Server is Running

Open http://127.0.0.1:8001 in your browser. You should see the Extension Security Analyzer dashboard.

## Configuration (Optional)

Create a `.env` file in the project root to customize settings:

```bash
# Server configuration
PORT=8001
HOST=127.0.0.1

# LLM integration (optional)
LLM_URL=http://localhost:11434
LLM_MODEL=llama3.2
LLM_CONCURRENCY=10

# Reports directory
REPORTS_DIR=./reports
```

## Troubleshooting

### Port already in use

Error: `EADDRINUSE: address already in use :::8001`

Solution: Use a different port:
```bash
PORT=8002 npm run dev
```

### Node version too old

Error: `SyntaxError: Unexpected token '??='`

Solution: Upgrade to Node.js 18 or higher:
```bash
# Using nvm
nvm install 18
nvm use 18
```

### Permission denied on npm install

Error: `EACCES: permission denied`

Solution: Fix npm permissions or use a node version manager:
```bash
# Recommended: Use nvm instead of sudo
nvm use 18
npm install
```

## Next Steps

- **[Getting Started Tutorial](../tutorials/getting-started.md)** — Run your first scan
- **[Configure LLM Integration](configure-llm.md)** — Enable AI-powered analysis

## Maintenance

| Trigger | Action |
|---------|--------|
| New Node version requirement | Update Prerequisites table |
| New dependencies | Update Step 2 description |
| Default port changes | Update port references |

Last Updated: 2026-03-29
