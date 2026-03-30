<!-- SCOPE: Documentation writing standards, Diátaxis framework, and structure requirements -->

# Documentation Standards

Requirements for writing and maintaining documentation in this project, following the [Diátaxis Framework](https://diataxis.fr/).

## Quick Reference

| Requirement | Rule |
|-------------|------|
| Format | Markdown (GitHub-flavored) |
| Structure | SCOPE comment, Diátaxis type, sections, Maintenance table |
| Tables over lists | Use tables for structured data; lists only for ordered steps |
| Links | Relative paths, verified on creation |
| Code references | `file_path:line_number` format for source references |
| Dates | ISO 8601 (YYYY-MM-DD) |
| Language | English |
| Diátaxis type | Every doc must declare its type (see below) |

## Diátaxis Framework

We organize documentation into four types based on user needs:

| Type | Question Answered | User's Goal | Tone |
|------|-------------------|-------------|------|
| **Tutorial** | "How do I learn this?" | Gain competence through practice | Encouraging, patient |
| **How-to Guide** | "How do I solve this problem?" | Complete a specific task | Direct, practical |
| **Reference** | "What is the technical detail?" | Find precise information | Concise, accurate |
| **Explanation** | "Why does this work this way?" | Understand concepts | Thoughtful, contextual |

### Choosing the Right Type

**Use Tutorial when:**
- Teaching someone new to the project
- Building competence through hands-on practice
- Guiding through a complete workflow

**Use How-to Guide when:**
- Solving a specific problem
- Following a recipe for a task
- User knows what they want to achieve

**Use Reference when:**
- Describing technical specifications
- Listing API endpoints or configuration options
- Providing lookup information

**Use Explanation when:**
- Discussing design decisions
- Explaining how something works internally
- Providing background and context

## Document Structure

Every documentation file must include:

1. **SCOPE comment** — HTML comment in first 10 lines defining document boundaries
2. **Diátaxis type declaration** — Add `<!-- TYPE: Tutorial|How-to|Reference|Explanation -->` after SCOPE
3. **Title** — H1 with document purpose
4. **Content sections** — H2 headers appropriate to the type
5. **Maintenance section** — Table with update triggers, actions, and last-updated date

### Type-Specific Structures

**Tutorial structure:**
- Prerequisites
- Step-by-step instructions (numbered)
- Expected outcomes
- Next steps

**How-to Guide structure:**
- Goal statement
- Prerequisites
- Step-by-step instructions (numbered)
- Troubleshooting

**Reference structure:**
- Overview
- Detailed specifications (tables preferred)
- Examples
- Related references

**Explanation structure:**
- Context/background
- Core concepts
- Design rationale
- Trade-offs and decisions

## Writing Guidelines

| Guideline | Description |
|-----------|-------------|
| Be specific | Reference actual file paths, function names, config keys |
| No stale content | If code changes, docs must be updated in the same PR |
| Single source of truth | Each fact lives in exactly one document; others link to it |
| No code blocks >5 lines | Link to source files instead of duplicating code |
| Actuality | All paths, functions, APIs, and configs mentioned must exist and be accurate |
| User-centric | Write for the reader's goal, not the author's knowledge |
| Progressive disclosure | Start simple, link to complexity |

## Navigation Rules

| Rule | Description |
|------|-------------|
| Hub-and-spoke | `docs/README.md` links to all documents |
| Relative links | Always use relative paths (`../CLAUDE.md`, `explanation/architecture.md`) |
| No orphans | Every document must be reachable from `docs/README.md` |
| Bidirectional | Major documents link back to the hub |
| Type grouping | Documents grouped by Diátaxis type in the hub |

## Maintenance

| Trigger | Action |
|---------|--------|
| New document added | Add to hub, classify by Diátaxis type |
| Document type unclear | Discuss in PR, update this doc with decision rationale |
| Writing standard changed | Update Quick Reference and Guidelines |
| Link format changed | Update Navigation Rules |
| Diátaxis framework updated | Review all docs for compliance |

Last Updated: 2026-03-29
