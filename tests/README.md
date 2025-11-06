# Testing Guide for div-flow

This directory contains tests for the div-flow CLI tool, written using Bun's built-in test framework.

## Running Tests

```bash
# Run all tests
bun test

# Run tests in watch mode
bun test --watch

# Run a specific test file
bun test tests/workflows/git.test.ts
```

## Test Structure

### Unit Tests

- **`tests/utils/command.test.ts`**: Tests for command execution utilities
- **`tests/workflows/git.test.ts`**: Tests for pure Git utility functions (branch type detection, protection checks)
- **`tests/workflows/linear.test.ts`**: Tests for Linear integration utilities
- **`tests/workflows/branch-protection.test.ts`**: Tests for branch protection logic
- **`tests/config/config-manager.test.ts`**: Tests for configuration management

### Test Strategy

Since div-flow heavily relies on Git shell commands, we use a hybrid testing approach:

1. **Pure Function Tests**: Test functions that don't require Git commands (e.g., `getBranchType`, `isProtectedBranch`)
2. **Integration Tests**: Use temporary Git repositories for testing actual Git operations (e.g., `config-manager.test.ts`)
3. **Mocking**: For functions that call external APIs or shell commands, we test the logic separately from the execution

## Writing New Tests

### Example: Testing a Pure Function

```typescript
import { describe, it, expect } from "bun:test";

describe("MyFunction", () => {
     it("should work correctly", async () => {
          const module = await import("../../src/my-module");
          const result = module.myFunction("input");
          expect(result).toBe("expected-output");
     });
});
```

### Example: Testing with Temporary Git Repo

```typescript
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";

describe("Git Integration", () => {
     let testDir: string;

     beforeEach(async () => {
          testDir = await mkdtemp(join("/tmp", "div-flow-test-"));
          // Initialize git repo, etc.
     });

     afterEach(async () => {
          await rm(testDir, { recursive: true, force: true });
     });

     it("should work with real git repo", async () => {
          // Test implementation
     });
});
```

## Notes

- Bun's test framework doesn't support module mocking the same way Jest does
- For functions that call `execSync`, we test the pure logic separately or use integration tests with real Git repos
- Configuration tests use temporary directories to avoid polluting the user's home directory

