import { mock } from "bun:test";
import type { Mock } from "bun:test";

/**
 * Mock consola for tests
 */
export function createMockConsola() {
     return {
          start: mock(() => {}),
          success: mock(() => {}),
          error: mock(() => {}),
          warn: mock(() => {}),
          info: mock(() => {}),
          box: mock(() => {}),
          prompt: mock(() => Promise.resolve("mock-response")),
     };
}

/**
 * Mock execSync for tests
 */
export function createMockExecSync() {
     const execSyncMock = mock(() => "mock-output");
     return execSyncMock;
}

/**
 * Setup test environment with mocked modules
 */
export function setupTestMocks() {
     const consolaMock = createMockConsola();
     const execSyncMock = createMockExecSync();

     return {
          consola: consolaMock,
          execSync: execSyncMock,
     };
}

/**
 * Reset all mocks
 */
export function resetMocks(...mocks: Mock<any>[]) {
     mocks.forEach((m) => m.mockClear());
}

