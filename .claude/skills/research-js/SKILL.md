```markdown
# research-js Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches the core development and maintenance patterns for the `research-js` TypeScript codebase. It covers coding conventions, file organization, refactoring workflows, and testing practices. By following these patterns, contributors can write consistent, maintainable code and efficiently manage feature improvements and cleanup tasks.

## Coding Conventions

- **Language:** TypeScript
- **Framework:** None detected
- **File Naming:** Use camelCase for file names.
  - Example: `saveScanToHistory.ts`, `index.ts`
- **Import Style:** Use relative imports.
  - Example:
    ```typescript
    import { saveScanToHistory } from './history';
    ```
- **Export Style:** Use named exports.
  - Example:
    ```typescript
    export function saveScanToHistory() { ... }
    ```
- **Commit Messages:** Mixed types, often prefixed with `fix`, average length ~59 characters.
  - Example: `fix: unify scan history logic and update related tests`

## Workflows

### Feature Refactor and Test
**Trigger:** When you want to improve, refactor, or optimize an existing feature and ensure it is covered by tests.  
**Command:** `/refactor-feature-with-tests`

1. Refactor or optimize logic in main implementation file(s) (e.g., `src/index.ts`).
2. Move or unify logic into a dedicated module (e.g., `src/history.ts`).
3. Update or add new test files to cover the refactored logic (e.g., `tests/saveScanToHistory.test.ts`).
4. Update `.gitignore` to exclude new temporary or test-related artifacts.
5. Remove tracked test artifacts if they were accidentally committed.

**Example:**
```typescript
// src/history.ts
export function saveScanToHistory(scan) {
  // ...refactored logic
}

// src/index.ts
import { saveScanToHistory } from './history';
```
```typescript
// tests/saveScanToHistory.test.ts
import { saveScanToHistory } from '../src/history';

test('should save scan to history', () => {
  // ...test implementation
});
```
```gitignore
# .gitignore
*.log
*.tmp
/tests/artifacts/
```

---

### Post-Refactor Cleanup
**Trigger:** After completing a refactor or moving logic between files, to clean up unused imports or code.  
**Command:** `/cleanup-unused-imports`

1. Identify unused imports or code in files affected by recent refactoring (e.g., `src/index.ts`).
2. Remove unused imports or code.
3. Run type checking to verify cleanup:
   ```bash
   tsc --noEmit
   ```
4. Commit the cleanup changes.

**Example:**
```typescript
// Before cleanup
import { unusedFunction } from './utils';
import { saveScanToHistory } from './history';

// ...only saveScanToHistory is used

// After cleanup
import { saveScanToHistory } from './history';
```

## Testing Patterns

- **Test Files:** Located in a `tests/` directory, matching the pattern `*.test.*`.
  - Example: `tests/saveScanToHistory.test.ts`
- **Framework:** Not explicitly detected; use standard TypeScript-compatible test runners (e.g., Jest, Mocha).
- **Test Structure:** Import the function/module under test and write assertions.
  - Example:
    ```typescript
    import { saveScanToHistory } from '../src/history';

    test('should save scan to history', () => {
      // ...test implementation
    });
    ```

## Commands

| Command                       | Purpose                                                      |
|-------------------------------|--------------------------------------------------------------|
| /refactor-feature-with-tests   | Refactor a feature and ensure it is covered by tests         |
| /cleanup-unused-imports        | Remove unused imports and code after a refactor              |
```
