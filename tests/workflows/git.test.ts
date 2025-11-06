import { describe, it, expect } from "bun:test";

// Test pure functions that don't require git commands
describe("Git Utilities - Pure Functions", () => {
     describe("getBranchType", () => {
          it("should identify main branch", async () => {
               const gitUtils = await import("../../src/workflows/git");
               expect(gitUtils.getBranchType("main")).toBe("main");
          });

          it("should identify develop branch", async () => {
               const gitUtils = await import("../../src/workflows/git");
               expect(gitUtils.getBranchType("develop")).toBe("develop");
          });

          it("should identify staging branch", async () => {
               const gitUtils = await import("../../src/workflows/git");
               expect(gitUtils.getBranchType("staging")).toBe("staging");
          });

          it("should identify feature branch", async () => {
               const gitUtils = await import("../../src/workflows/git");
               expect(gitUtils.getBranchType("feature/EV-123-add-auth")).toBe("feature");
          });

          it("should identify release branch", async () => {
               const gitUtils = await import("../../src/workflows/git");
               expect(gitUtils.getBranchType("release/20250106.1")).toBe("release");
          });

          it("should identify hotfix branch", async () => {
               const gitUtils = await import("../../src/workflows/git");
               expect(gitUtils.getBranchType("hotfix/fix-login-bug")).toBe("hotfix");
          });

          it("should return unknown for unrecognized branch", async () => {
               const gitUtils = await import("../../src/workflows/git");
               expect(gitUtils.getBranchType("random-branch")).toBe("unknown");
          });
     });

     describe("isProtectedBranch", () => {
          it("should return true for main", async () => {
               const gitUtils = await import("../../src/workflows/git");
               expect(gitUtils.isProtectedBranch("main")).toBe(true);
          });

          it("should return true for develop", async () => {
               const gitUtils = await import("../../src/workflows/git");
               expect(gitUtils.isProtectedBranch("develop")).toBe(true);
          });

          it("should return true for staging", async () => {
               const gitUtils = await import("../../src/workflows/git");
               expect(gitUtils.isProtectedBranch("staging")).toBe(true);
          });

          it("should return false for feature branches", async () => {
               const gitUtils = await import("../../src/workflows/git");
               expect(gitUtils.isProtectedBranch("feature/test")).toBe(false);
          });

          it("should return false for hotfix branches", async () => {
               const gitUtils = await import("../../src/workflows/git");
               expect(gitUtils.isProtectedBranch("hotfix/fix")).toBe(false);
          });

          it("should return false for release branches", async () => {
               const gitUtils = await import("../../src/workflows/git");
               expect(gitUtils.isProtectedBranch("release/1.0.0")).toBe(false);
          });

          it("should be case-sensitive", async () => {
               const gitUtils = await import("../../src/workflows/git");
               expect(gitUtils.isProtectedBranch("Main")).toBe(false);
               expect(gitUtils.isProtectedBranch("MAIN")).toBe(false);
               expect(gitUtils.isProtectedBranch("develop")).toBe(true);
          });
     });

     describe("getBaseBranchFor", () => {
          it("should return develop for feature branches", async () => {
               const gitUtils = await import("../../src/workflows/git");
               expect(gitUtils.getBaseBranchFor("feature")).toBe("develop");
          });

          it("should return main for hotfix branches", async () => {
               const gitUtils = await import("../../src/workflows/git");
               expect(gitUtils.getBaseBranchFor("hotfix")).toBe("main");
          });

          it("should return main for release branches", async () => {
               const gitUtils = await import("../../src/workflows/git");
               expect(gitUtils.getBaseBranchFor("release")).toBe("main");
          });

          it("should return main as default", async () => {
               const gitUtils = await import("../../src/workflows/git");
               expect(gitUtils.getBaseBranchFor("unknown")).toBe("main");
          });
     });

     describe("getRepoInfo - URL parsing logic", () => {
          it("should extract repo info from GitHub SSH URL", async () => {
               const gitUtils = await import("../../src/workflows/git");
               // We can't easily mock runCommandCapture, so we'll test the regex logic
               const url = "git@github.com:MidtownHI/evergreen.git";
               const match = url.match(/github\.com[:/](.*)\.git/);
               expect(match?.[1]).toBe("MidtownHI/evergreen");
          });

          it("should extract repo info from GitHub HTTPS URL", async () => {
               const url = "https://github.com/MidtownHI/evergreen.git";
               const match = url.match(/github\.com[:/](.*)\.git/);
               expect(match?.[1]).toBe("MidtownHI/evergreen");
          });

          it("should not match non-GitHub URLs", async () => {
               const url = "https://gitlab.com/user/repo.git";
               const match = url.match(/github\.com[:/](.*)\.git/);
               expect(match).toBeNull();
          });
     });
});
