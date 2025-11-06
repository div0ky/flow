import { describe, it, expect } from "bun:test";
import {
     detectLinearIssue,
     hasLinearPattern,
     cleanTitleForLinear,
     generateLinearBranchName,
} from "../../src/workflows/linear";

describe("Linear Utilities", () => {
     describe("detectLinearIssue", () => {
          it("should detect Linear issue from branch name", () => {
               expect(detectLinearIssue("aaron/dev-123-feature")).toBe("DEV-123");
               expect(detectLinearIssue("user/EV-456-description")).toBe("EV-456");
               expect(detectLinearIssue("feature/DEV-789-test")).toBe("DEV-789");
          });

          it("should handle lowercase issue IDs", () => {
               expect(detectLinearIssue("aaron/dev-123-feature")).toBe("DEV-123");
               expect(detectLinearIssue("user/ev-456-desc")).toBe("EV-456");
          });

          it("should return null for branches without Linear pattern", () => {
               expect(detectLinearIssue("feature/test")).toBeNull();
               expect(detectLinearIssue("main")).toBeNull();
               expect(detectLinearIssue("hotfix/fix")).toBeNull();
          });

          it("should handle various branch name formats", () => {
               expect(detectLinearIssue("username/dev-123-long-description-name")).toBe("DEV-123");
               expect(detectLinearIssue("a/bug-999-fix")).toBe("BUG-999");
          });
     });

     describe("hasLinearPattern", () => {
          it("should return true for branches with Linear pattern", () => {
               expect(hasLinearPattern("aaron/dev-123-feature")).toBe(true);
               expect(hasLinearPattern("user/EV-456-desc")).toBe(true);
          });

          it("should return false for branches without Linear pattern", () => {
               expect(hasLinearPattern("feature/test")).toBe(false);
               expect(hasLinearPattern("main")).toBe(false);
               expect(hasLinearPattern("hotfix/fix-bug")).toBe(false);
          });
     });

     describe("cleanTitleForLinear", () => {
          it("should remove conventional commit prefixes", () => {
               expect(cleanTitleForLinear("feat(auth): Add user authentication")).toBe("Add user authentication");
               expect(cleanTitleForLinear("fix: Resolve login bug")).toBe("Resolve login bug");
               expect(cleanTitleForLinear("chore(ui): Update dependencies")).toBe("Update dependencies");
          });

          it("should handle commits without scope", () => {
               expect(cleanTitleForLinear("feat: New feature")).toBe("New feature");
               expect(cleanTitleForLinear("fix: Bug fix")).toBe("Bug fix");
          });

          it("should handle commits with scope", () => {
               expect(cleanTitleForLinear("feat(api): Add endpoint")).toBe("Add endpoint");
               expect(cleanTitleForLinear("fix(ui): Fix button")).toBe("Fix button");
          });

          it("should leave titles without prefixes unchanged", () => {
               expect(cleanTitleForLinear("Regular title")).toBe("Regular title");
               expect(cleanTitleForLinear("Add new feature")).toBe("Add new feature");
          });

          it("should handle case-insensitive prefixes", () => {
               expect(cleanTitleForLinear("FEAT: Uppercase")).toBe("Uppercase");
               expect(cleanTitleForLinear("Fix: Lowercase")).toBe("Lowercase");
          });
     });

     describe("generateLinearBranchName", () => {
          it("should generate branch name with Linear issue ID", () => {
               const result = generateLinearBranchName("DEV-123", "aaron/feature-description");
               expect(result).toBe("aaron/dev-123-feature-description");
          });

          it("should extract username from current branch", () => {
               const result = generateLinearBranchName("EV-456", "john/old-branch-name");
               expect(result).toBe("john/ev-456-old-branch-name");
          });

          it("should use 'feature' as default username", () => {
               const result = generateLinearBranchName("DEV-789", "no-slash-branch");
               expect(result).toBe("feature/dev-789-no-slash-branch");
          });

          it("should clean up description part", () => {
               const result = generateLinearBranchName("DEV-123", "user/special-chars!@#-description");
               expect(result).toBe("user/dev-123-special-chars-description");
          });

          it("should handle multiple dashes", () => {
               const result = generateLinearBranchName("DEV-123", "user/multiple---dashes");
               expect(result).toBe("user/dev-123-multiple-dashes");
          });

          it("should remove leading/trailing dashes", () => {
               const result = generateLinearBranchName("DEV-123", "user/-description-");
               expect(result).toBe("user/dev-123-description");
          });
     });
});

