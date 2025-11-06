import { describe, it, expect, beforeEach, mock } from "bun:test";
import { isProtectedBranch, PROTECTED_BRANCHES } from "../../src/workflows/git";

describe("Branch Protection", () => {
     describe("isProtectedBranch", () => {
          it("should protect main branch", () => {
               expect(isProtectedBranch("main")).toBe(true);
          });

          it("should protect develop branch", () => {
               expect(isProtectedBranch("develop")).toBe(true);
          });

          it("should protect staging branch", () => {
               expect(isProtectedBranch("staging")).toBe(true);
          });

          it("should not protect feature branches", () => {
               expect(isProtectedBranch("feature/test")).toBe(false);
               expect(isProtectedBranch("feature/EV-123-description")).toBe(false);
          });

          it("should not protect hotfix branches", () => {
               expect(isProtectedBranch("hotfix/fix")).toBe(false);
               expect(isProtectedBranch("hotfix/dev-123-fix")).toBe(false);
          });

          it("should not protect release branches", () => {
               expect(isProtectedBranch("release/1.0.0")).toBe(false);
               expect(isProtectedBranch("release/20250106.1")).toBe(false);
          });

          it("should be case-sensitive", () => {
               expect(isProtectedBranch("Main")).toBe(false);
               expect(isProtectedBranch("MAIN")).toBe(false);
               expect(isProtectedBranch("develop")).toBe(true);
          });
     });

     describe("PROTECTED_BRANCHES constant", () => {
          it("should contain exactly main, develop, and staging", () => {
               expect(PROTECTED_BRANCHES).toEqual(["main", "develop", "staging"]);
          });

          it("should be readonly", () => {
               // TypeScript should prevent modification, but we can verify the values
               expect(PROTECTED_BRANCHES.length).toBe(3);
          });
     });
});

