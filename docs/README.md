<!-- SCOPE: Documentation hub — navigation and standards overview -->

# Extension Security Analyzer — Documentation

Central navigation hub for all project documentation.

## Quick Navigation

| Document | Purpose |
|----------|---------|
| [CLAUDE.md](../CLAUDE.md) | AI agent entry point — commands, architecture, conventions |
| [Principles](principles.md) | Development principles and decision framework |
| [Documentation Standards](documentation_standards.md) | Writing and structure requirements |

### Project Documentation

| Document | Purpose |
|----------|---------|
| [Requirements](project/requirements.md) | Functional requirements and scope |
| [Architecture](project/architecture.md) | System layers, data flow, component design |
| [Tech Stack](project/tech_stack.md) | Technology choices, versions, rationale |
| [API Specification](project/api_spec.md) | REST API endpoints and contracts |
| [Infrastructure](project/infrastructure.md) | Runtime environment and deployment |

### Reference Documentation

| Directory | Purpose |
|-----------|---------|
| [Reference Hub](reference/README.md) | ADRs, guides, manuals, research |
| [Tasks](tasks/README.md) | Task management and workflow |

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
| New document added | Add to Quick Navigation table |
| Document moved/renamed | Update all links in this hub |
| Major feature added | Verify architecture and requirements docs updated |

Last Updated: 2026-03-22
