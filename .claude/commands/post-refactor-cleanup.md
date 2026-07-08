---
name: post-refactor-cleanup
description: Workflow command scaffold for post-refactor-cleanup in research-js.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /post-refactor-cleanup

Use this workflow when working on **post-refactor-cleanup** in `research-js`.

## Goal

Remove unused imports and clean up code after a refactor or logic unification.

## Common Files

- `src/index.ts`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Identify unused imports or code in files affected by recent refactoring.
- Remove unused imports or code.
- Run type checking (e.g., tsc --noEmit) to verify cleanup.
- Commit the cleanup changes.

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.