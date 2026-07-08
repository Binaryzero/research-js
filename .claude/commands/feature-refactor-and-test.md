---
name: feature-refactor-and-test
description: Workflow command scaffold for feature-refactor-and-test in research-js.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /feature-refactor-and-test

Use this workflow when working on **feature-refactor-and-test** in `research-js`.

## Goal

Refactor or optimize an existing feature, unify related logic, and add or update corresponding tests.

## Common Files

- `src/index.ts`
- `src/history.ts`
- `tests/saveScanToHistory.test.ts`
- `.gitignore`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Refactor or optimize logic in main implementation file(s) (e.g., src/index.ts).
- Move or unify logic into a dedicated module (e.g., src/history.ts).
- Update or add new test files to cover the refactored logic (e.g., tests/saveScanToHistory.test.ts).
- Update .gitignore to exclude new temporary or test-related artifacts.
- Remove tracked test artifacts if accidentally committed.

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.