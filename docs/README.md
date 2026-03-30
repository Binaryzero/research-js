<!-- SCOPE: Documentation hub — Diátaxis-organized navigation -->

# Extension Security Analyzer — Documentation

Documentation organized by the [Diátaxis Framework](https://diataxis.fr/): tutorials for learning, how-to guides for problem-solving, reference for technical details, and explanation for understanding concepts.

## Quick Start

New to the project? Start here:
- **[Getting Started Tutorial](tutorials/getting-started.md)** — Your first security scan
- **[Installation Guide](how-to/install.md)** — Set up the analyzer
- **[Architecture Overview](explanation/architecture.md)** — Understand how it works

---

## Documentation by Type

### 🎓 Tutorials (Learning-oriented)
Step-by-step lessons for newcomers.

| Document | What You'll Learn |
|----------|-------------------|
| [Getting Started](tutorials/getting-started.md) | Run your first extension scan |
| [Batch Analysis](tutorials/batch-analysis.md) | Analyze multiple extensions |
| [Custom Patterns](tutorials/custom-patterns.md) | Add your own security patterns |

### 🛠️ How-to Guides (Problem-oriented)
Recipes for specific tasks.

| Document | Problem Solved |
|----------|----------------|
| [Install the Analyzer](how-to/install.md) | Set up the tool locally |
| [Configure LLM Integration](how-to/configure-llm.md) | Enable AI-powered analysis |
| [Interpret Scan Reports](how-to/interpret-reports.md) | Understand findings |
| [Deploy to Production](how-to/deploy-production.md) | Production deployment |
| [Extend Security Patterns](how-to/extend-patterns.md) | Contribute new patterns |

### 📚 Reference (Information-oriented)
Technical descriptions and specifications.

| Document | Content |
|----------|---------|
| [REST API](reference/api.md) | Endpoint specifications |
| [Configuration](reference/configuration.md) | Environment variables and settings |
| [Pattern Schema](reference/patterns-schema.md) | Pattern YAML structure |
| [CLI Commands](reference/cli-commands.md) | Command-line usage |
| [Security Patterns](reference/security-patterns.md) | Built-in detection patterns |
| [CLAUDE.md](../CLAUDE.md) | AI agent guidance |
| [Principles](principles.md) | Development principles |

### 💡 Explanation (Understanding-oriented)
Concepts and design discussions.

| Document | Topic |
|----------|-------|
| [Architecture](explanation/architecture.md) | System design and data flow |
| [Security Model](explanation/security-model.md) | How analysis works |
| [LLM Consensus](explanation/llm-consensus.md) | Multi-model false positive detection |
| [Tech Stack](explanation/tech-stack.md) | Technology choices rationale |
| [Scoring Algorithm](explanation/scoring.md) | Risk calculation explained |

---

## For Developers

| Document | Purpose |
|----------|---------|
| [Documentation Standards](documentation_standards.md) | Writing and structure requirements |
| [Contributing Guide](../CONTRIBUTING.md) | How to contribute |

## Project Overview

**Extension Security Analyzer** is a VS Code Marketplace extension security scanner that:

1. Downloads and extracts VSIX packages from the VS Code Marketplace
2. Runs static analysis against configurable security patterns (regex-based)
3. Optionally enhances findings with LLM-based false positive detection (multi-model consensus)
4. Generates markdown reports with risk scoring and executive summaries
5. Provides a web UI for search, scan, batch operations, and report viewing

**Tech stack:** TypeScript 5.9, Fastify 5.8, Nunjucks templates, Vitest, Node.js >=18

## Maintenance

| Trigger | Action |
|---------|--------|
| New document added | Add to appropriate section above |
| Document moved/renamed | Update all links |
| Major feature added | Update tutorials and reference docs |
| Diátaxis classification unclear | Document type discussion in PR |

Last Updated: 2026-03-29
