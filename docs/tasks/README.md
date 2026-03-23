<!-- SCOPE: Task management system and workflow rules -->

# Task Management

Rules and workflow for tracking development tasks in the Extension Security Analyzer.

## Task Tracking

Tasks are tracked using Claude Code's built-in task system (`TaskCreate`, `TaskUpdate`, `TaskList`). For complex multi-step work, tasks provide:

- Progress visibility during long operations
- Dependency tracking between steps
- Clear completion criteria

## Task Workflow

| Status | Meaning |
|--------|---------|
| pending | Task defined, not yet started |
| in_progress | Actively being worked on |
| completed | Finished and verified |
| deleted | Removed (no longer relevant) |

## When to Create Tasks

| Scenario | Create Tasks? |
|----------|---------------|
| Multi-step feature implementation | Yes |
| Bug fix requiring investigation | Yes, if >3 steps |
| Single file edit | No |
| Documentation update | No, unless batch |
| Test suite overhaul | Yes |

## Naming Conventions

| Element | Convention | Example |
|---------|-----------|---------|
| Subject | Imperative verb + specific target | "Add consensus timeout handling" |
| Description | What, why, acceptance criteria | "LLM judges need timeout handling..." |
| Active form | Present continuous + target | "Adding consensus timeout handling" |

## Maintenance

| Trigger | Action |
|---------|--------|
| Workflow process changed | Update Task Workflow table |
| New task tool introduced | Add to Task Tracking section |

Last Updated: 2026-03-22
