```markdown
# research-js Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches the core development patterns and conventions used in the `research-js` TypeScript codebase. You'll learn how to structure files, write imports and exports, follow commit message patterns, and write and run tests. These guidelines help maintain consistency and readability in projects without a framework.

## Coding Conventions

### File Naming
- Use **snake_case** for all file names.

  **Example:**
  ```
  data_processor.ts
  user_profile.test.ts
  ```

### Import Style
- Use **relative imports** for referencing other modules.

  **Example:**
  ```typescript
  import { processData } from './data_processor';
  ```

### Export Style
- Use **named exports** rather than default exports.

  **Example:**
  ```typescript
  // In data_processor.ts
  export function processData(data: any): any {
    // ...
  }
  ```

  ```typescript
  // In another file
  import { processData } from './data_processor';
  ```

### Commit Messages
- Mixed commit types, with some using the `fix` prefix.
- Keep commit messages concise (average ~58 characters).

  **Example:**
  ```
  fix: correct data parsing for edge cases
  update: add new utility for string normalization
  ```

## Workflows

### Adding a New Module
**Trigger:** When you need to add a new feature or utility.
**Command:** `/add-module`

1. Create a new file using snake_case (e.g., `feature_name.ts`).
2. Implement your logic using named exports.
3. Use relative imports to include dependencies.
4. Write a corresponding test file (`feature_name.test.ts`).
5. Commit with a clear, concise message (optionally using a prefix like `fix:` or `add:`).

### Fixing a Bug
**Trigger:** When you identify and resolve a bug.
**Command:** `/fix-bug`

1. Locate the relevant file.
2. Apply the fix.
3. Add or update a test in the corresponding `*.test.ts` file.
4. Commit with a message starting with `fix:`, describing the change.

### Writing and Running Tests
**Trigger:** When you add new code or need to verify existing code.
**Command:** `/run-tests`

1. Create or update a test file matching `*.test.ts`.
2. Write tests for all exported functions.
3. Use your preferred test runner (not specified in repo).
4. Run the tests and ensure they pass before committing.

## Testing Patterns

- Test files are named with the pattern `*.test.ts`.
- Place tests alongside the modules they test or in a dedicated test directory.
- Each test file should import the module using a relative path and test all named exports.

  **Example:**
  ```typescript
  // data_processor.test.ts
  import { processData } from './data_processor';

  describe('processData', () => {
    it('should process input correctly', () => {
      const result = processData(sampleInput);
      expect(result).toEqual(expectedOutput);
    });
  });
  ```

## Commands
| Command      | Purpose                                        |
|--------------|------------------------------------------------|
| /add-module  | Scaffold and implement a new module            |
| /fix-bug     | Apply and commit a bug fix                     |
| /run-tests   | Run all test files matching `*.test.ts`        |
```
