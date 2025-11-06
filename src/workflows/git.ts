import { execSync } from "child_process";

import { consola } from "consola";

import { runCommandCapture, runCommandCaptureOrThrow, runCommandSilent } from "../utils/command";

export const getGitStatus = (): { staged: string[]; unstaged: string[]; untracked: string[] } => {
     try {
          const staged_output = runCommandCaptureOrThrow(
               "git diff --cached --name-only",
               "Failed to get git status",
          );
          const staged = staged_output.split("\n").filter(Boolean);

          const unstaged_output = runCommandCaptureOrThrow(
               "git diff --name-only",
               "Failed to get git status",
          );
          const unstaged = unstaged_output.split("\n").filter(Boolean);

          const untracked_output = runCommandCaptureOrThrow(
               "git ls-files --others --exclude-standard",
               "Failed to get git status",
          );
          const untracked = untracked_output.split("\n").filter(Boolean);

          return { staged: staged, unstaged: unstaged, untracked: untracked };
     }
     catch {
          consola.error("Failed to get git status");
          process.exit(1);
     }
};

export const displayGitStatus = (status: ReturnType<typeof getGitStatus>): void => {
     consola.box("Git Status");

     if (status.staged.length > 0) {
          consola.success("Staged files:");
          status.staged.forEach((file) => {
               console.log(`  ✓ ${file}`);
          });
          console.log();
     }

     if (status.unstaged.length > 0) {
          consola.warn("Modified files (not staged):");
          status.unstaged.forEach((file) => {
               console.log(`  ● ${file}`);
          });
          console.log();
     }

     if (status.untracked.length > 0) {
          consola.info("Untracked files:");
          status.untracked.forEach((file) => {
               console.log(`  ? ${file}`);
          });
          console.log();
     }
};

export const getRepoInfo = (): string | null => {
     const remote_url = runCommandCapture("git remote get-url origin");
     if (!remote_url) {
          return null;
     }
     const match = remote_url.match(/github\.com[:/](.*)\.git/);
     return match ? (match[1] ?? null) : null;
};

/**
 * Check if we're in a git repository
 */
export const isGitRepository = (): boolean => {
     return runCommandSilent("git rev-parse --git-dir");
};

/**
 * Check if a branch exists locally
 */
export const branchExistsLocal = (branch: string): boolean => {
     const branches = runCommandCapture(`git branch --list ${branch}`);
     return branches !== null && branches.trim() !== "";
};

/**
 * Check if a branch exists remotely
 * Uses a timeout to prevent hanging on network issues
 */
export const branchExistsRemote = (branch: string): boolean => {
     try {
          // Add timeout to prevent hanging on network issues
          return runCommandSilent(`git ls-remote --heads origin ${branch}`, {
               timeout: 5000, // 5 second timeout
          });
     } catch {
          // If check fails (network issue, timeout, etc.), assume branch doesn't exist remotely
          return false;
     }
};

/**
 * Check if a branch exists (locally or remotely)
 */
export const branchExists = (branch: string): boolean => {
     return branchExistsLocal(branch) || branchExistsRemote(branch);
};

/**
 * Check if develop branch is behind main
 * Returns the number of commits develop is behind, or null if can't determine
 */
export const isDevelopBehindMain = (): number | null => {
     try {
          // First check if both branches exist
          if (!branchExists("main") || !branchExists("develop")) {
               return null;
          }

          // Fetch both branches
          runCommandSilent("git fetch origin main develop");

          // Check how many commits develop is behind main
          const behind_output = runCommandCapture("git rev-list --count origin/main..origin/develop");
          if (behind_output === null) {
               return null;
          }

          // If develop is behind, this will be negative, so we need to check the other direction
          const ahead_output = runCommandCapture("git rev-list --count origin/develop..origin/main");
          if (ahead_output === null) {
               return null;
          }

          const behind = parseInt(ahead_output.trim(), 10);
          return behind > 0 ? behind : 0;
     } catch {
          return null;
     }
};

export const getCurrentBranch = (): string => {
     const branch = runCommandCaptureOrThrow(
          "git branch --show-current",
          "Failed to get current branch",
     );
     return branch;
};

/**
 * Detect branch type from branch name
 * Pattern: feature/EV-123-description -> 'feature'
 *          release/20250106.1 -> 'release'
 *          hotfix/description -> 'hotfix'
 */
export type BranchType = "feature" | "release" | "hotfix" | "develop" | "main" | "staging" | "unknown";

export const getBranchType = (branch: string): BranchType => {
     if (branch === "main") return "main";
     if (branch === "develop") return "develop";
     if (branch === "staging") return "staging";
     if (branch.startsWith("feature/")) return "feature";
     if (branch.startsWith("release/")) return "release";
     if (branch.startsWith("hotfix/")) return "hotfix";
     return "unknown";
};

/**
 * Get the base branch for a given branch type
 * Features merge into develop, hotfixes/releases merge into main
 */
export const getBaseBranchFor = (type: BranchType): string => {
     switch (type) {
          case "feature":
               return "develop";
          case "hotfix":
               return "main";
          case "release":
               return "main";
          default:
               return "main";
     }
};

/**
 * Protected branches that should NEVER be deleted or modified
 */
export const PROTECTED_BRANCHES = ["main", "develop", "staging"] as const;

/**
 * Check if a branch is protected
 * @param branch - Branch name to check
 * @returns true if branch is protected, false otherwise
 */
export const isProtectedBranch = (branch: string): boolean => {
     return PROTECTED_BRANCHES.includes(branch as typeof PROTECTED_BRANCHES[number]);
};

/**
 * Assert that current branch is NOT on a protected branch
 * Prevents accidental operations on main, develop, staging
 */
export const assertNotOnProtectedBranch = (branch: string): void => {
     if (isProtectedBranch(branch)) {
          consola.error(`Cannot perform this operation on protected branch: ${branch}`);
          consola.error(`Protected branches (${PROTECTED_BRANCHES.join(", ")}) cannot be deleted or modified.`);
          process.exit(1);
     }
};
