<!-- SCOPE: Documentation writing standards and structure requirements -->

# Documentation Standards

Requirements for writing and maintaining documentation in this project.

## Quick Reference

| Requirement | Rule |
|-------------|------|
| Format | Markdown (GitHub-flavored) |
| Structure | Each doc has SCOPE comment, sections, Maintenance table |
| Tables over lists | Use tables for structured data; lists only for ordered steps |
| Links | Relative paths, verified on creation |
| Code references | `file_path:line_number` format for source references |
| Dates | ISO 8601 (YYYY-MM-DD) |
| Language | English |

## Document Structure

Every documentation file must include:

1. **SCOPE comment** — HTML comment in first 10 lines defining document boundaries
2. **Title** — H1 with document purpose
3. **Content sections** — H2 headers for major topics
4. **Maintenance section** — Table with update triggers, actions, and last-updated date

## Writing Guidelines

| Guideline | Description |
|-----------|-------------|
| Be specific | Reference actual file paths, function names, config keys |
| No stale content | If code changes, docs must be updated in the same PR |
| Single source of truth | Each fact lives in exactly one document; others link to it |
| No code blocks >5 lines | Link to source files instead of duplicating code |
| Actuality | All paths, functions, APIs, and configs mentioned must exist and be accurate |

## Navigation Rules

| Rule | Description |
|------|-------------|
| Hub-and-spoke | `docs/README.md` links to all documents |
| Relative links | Always use relative paths (`../CLAUDE.md`, `project/architecture.md`) |
| No orphans | Every document must be reachable from `docs/README.md` |
| Bidirectional | Major documents link back to the hub |

## Maintenance

| Trigger | Action |
|---------|--------|
| New document type needed | Add structure requirements here |
| Writing standard changed | Update Quick Reference and Guidelines |
| Link format changed | Update Navigation Rules |

Last Updated: 2026-03-22
