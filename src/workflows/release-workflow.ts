import { execSync } from "child_process";

import { consola } from "consola";

import { generatePRContent } from "./ai";
import { getCurrentBranch } from "./git";
import { handleUncommittedChanges, pushBranchIfNeeded, createPullRequest, restoreStashedChangesIfNeeded } from "./pr-shared";

/**
 * Get today's date in YYYYMMDD format
 */
const getTodayDateFormat = (): string => {
     const today = new Date();
     const yyyy = today.getFullYear();
     const mm = String(today.getMonth() + 1).padStart(2, "0");
     const dd = String(today.getDate()).padStart(2, "0");
     return `${yyyy}${mm}${dd}`;
};

/**
 * Find next increment for release branch
 * Check existing release branches and return next increment
 */
const getNextReleaseIncrement = (date: string): number => {
     try {
          const branches = execSync("git branch -r", { encoding: "utf-8" }).split("\n");
          const release_branches = branches.filter((b) => b.includes(`release/${date}.`));

          if (release_branches.length === 0) return 1;

          const increments = release_branches.map((b) => {
               const match = b.match(/release\/\d+\.(\d+)/);
               return match ? parseInt(match[1]) : 0;
          });

          return Math.max(...increments) + 1;
     } catch {
          return 1;
     }
};

/**
 * Start a new release branch from develop
 */
export async function startRelease(): Promise<void> {
     consola.start("Starting new release...");

     const current_branch = getCurrentBranch();

     // Ensure we're on develop
     if (current_branch !== "develop") {
          consola.warn(`You're currently on: ${current_branch}`);
          const should_switch = await consola.prompt("Switch to develop first?", {
               type: "confirm",
               default: true,
          });

          if (should_switch) {
               consola.start("Checking out develop...");
               try {
                    execSync("git fetch origin develop");
                    execSync("git checkout develop");
                    execSync("git pull origin develop");
                    consola.success("Switched to develop");
               } catch {
                    consola.error("Failed to switch to develop");
                    process.exit(1);
               }
          } else {
               consola.warn("Release should branch from develop");
               process.exit(1);
          }
     }

     // Get release date
     const today = getTodayDateFormat();
     const default_date = today;

     const release_date = await consola.prompt("Release date (YYYYMMDD):", {
          type: "text",
          default: default_date,
          validate: (value: string) => /^\d{8}$/.test(value) || "Invalid format. Use YYYYMMDD",
     });

     // Find next increment
     const increment = getNextReleaseIncrement(release_date);
     const branch_name = `release/${release_date}.${increment}`;

     // Create and checkout release branch
     consola.start(`Creating release branch: ${branch_name}`);
     try {
          execSync(`git checkout -b ${branch_name}`);
          execSync(`git push -u origin ${branch_name}`);
          consola.success(`✅ Release branch created: ${branch_name}`);
          consola.info("Next steps:");
          consola.info(`1. Test on staging: flow-automator -> Stage release`);
          consola.info(`2. When ready: flow-automator -> Finish release`);
     } catch (error) {
          consola.error("Failed to create release branch");
          consola.error(error);
          process.exit(1);
     }
}

/**
 * Push release branch to staging for testing
 */
export async function stageRelease(): Promise<void> {
     consola.start("Preparing release for staging...");

     const current_branch = getCurrentBranch();

     // Validate we're on a release branch
     if (!current_branch.startsWith("release/")) {
          consola.error(`You're not on a release branch! Current: ${current_branch}`);
          process.exit(1);
     }

     consola.info(`Pushing ${current_branch} to staging branch...`);

     try {
          // Push to staging (force push is OK since staging is ephemeral)
          execSync(`git push -u origin ${current_branch}:staging --force`);
          consola.success(`✅ Release pushed to staging`);
          consola.info("Staging deployment is in progress...");
          consola.info("Testing will run automatically on your staging environment");
     } catch (error) {
          consola.error("Failed to push to staging");
          consola.error(error);
          process.exit(1);
     }
}

/**
 * Finish a release branch - create PR to main
 */
export async function finishRelease(gh_token: string): Promise<void> {
     consola.start("Finishing release...");

     const current_branch = getCurrentBranch();

     // Validate we're on a release branch
     if (!current_branch.startsWith("release/")) {
          consola.error(`You're not on a release branch! Current: ${current_branch}`);
          process.exit(1);
     }

     consola.info(`Current branch: ${current_branch}`);
     consola.info(`Base branch: main`);

     // Handle uncommitted changes
     const _was_stashed = await handleUncommittedChanges();

     // Push branch if needed
     await pushBranchIfNeeded(current_branch);

     // Fetch latest main for comparison
     consola.start("Fetching latest main...");
     try {
          execSync("git fetch origin main");
          consola.success("Fetched latest changes");
     } catch {
          consola.warn("Failed to fetch latest changes");
     }

     // Analyze changes
     consola.start("Analyzing changes...");
     const commit_count = parseInt(execSync("git rev-list --count origin/main..HEAD", { encoding: "utf-8" }).trim());

     if (commit_count === 0) {
          consola.warn("No commits to create PR from.");
          process.exit(0);
     }

     const diff_summary = execSync("git diff origin/main..HEAD --stat", { encoding: "utf-8" });
     consola.box(`Release Changes\n\nCommits: ${commit_count}\n\n${diff_summary}`);

     // Get user description
     const user_description = await consola.prompt("Summary of release (optional):", {
          type: "text",
          default: "",
          required: false,
     });

     // Generate PR content
     consola.start("Generating PR title and description...");
     const generated_content = await generatePRContent(current_branch, "main", user_description);

     let pr_title: string;
     let pr_description: string;

     if (!generated_content) {
          pr_title = `Release ${current_branch.replace("release/", "")}`;
          pr_description = "Release to production";
     } else {
          pr_title = generated_content.title;
          pr_description = generated_content.description;

          consola.box(`PR Title:\n${pr_title}`);
          console.log("\nPR Description:");
          console.log("─".repeat(40));
          console.log(pr_description);
          console.log("─".repeat(40));

          const action = await consola.prompt("Proceed?", {
               type: "confirm",
               default: true,
          });

          if (!action) {
               consola.info("PR creation cancelled.");
               process.exit(0);
          }
     }

     // Create PR
     const pr_url = await createPullRequest({
          gh_token: gh_token,
          title: pr_title,
          description: pr_description,
          base_branch: "main",
          draft: false,
     });

     if (pr_url) {
          consola.success(`✅ Release PR created and ready for merge!`);
     }

     // Restore stashed changes if any
     await restoreStashedChangesIfNeeded();
}
