import { execSync } from "child_process";

import { consola } from "consola";

import { generatePRContent } from "./ai";
import { getCurrentBranch, getGitStatus, displayGitStatus } from "./git";
import { runCommandWithOutput } from "../utils/command";
import { handleUncommittedChanges, pushBranchIfNeeded, createPullRequest, restoreStashedChangesIfNeeded } from "./pr-shared";

/**
 * Start a new hotfix branch from main
 * Hotfixes are for urgent fixes that bypass the normal develop → release cycle
 * Can be started from main or develop - will automatically switch to main and create branch from there
 */
export async function startHotfix(): Promise<void> {
     consola.start("Starting hotfix...");

     const current_branch = getCurrentBranch();

     // Check for uncommitted changes first
     const status = getGitStatus();
     const has_changes = status.staged.length > 0 || status.unstaged.length > 0 || status.untracked.length > 0;

     let stashed_changes = false;

     if (has_changes) {
          displayGitStatus(status);
          const action = await consola.prompt("You have uncommitted changes. What would you like to do?", {
               type: "select",
               options: [
                    { value: "stash", label: "Stash changes and reapply after switching" },
                    { value: "discard", label: "Discard all changes" },
                    { value: "cancel", label: "Cancel" },
               ],
          });

          if (action === "cancel") {
               consola.info("Cancelled.");
               process.exit(0);
          }

          if (action === "stash") {
               const stash_success = runCommandWithOutput(
                    'git stash push -u -m "dflow: temporary stash for hotfix start"',
                    "Stashing changes...",
               );
               if (!stash_success) {
                    consola.error("Failed to stash changes");
                    process.exit(1);
               }
               stashed_changes = true;
          } else if (action === "discard") {
               const discard_confirm = await consola.prompt("Are you sure you want to discard all changes? This cannot be undone.", {
                    type: "confirm",
                    default: false,
               });
               if (!discard_confirm) {
                    consola.info("Cancelled.");
                    process.exit(0);
               }
               runCommandWithOutput("git reset --hard HEAD", "Discarding staged changes...");
               runCommandWithOutput("git clean -fd", "Removing untracked files...");
          }
     }

     // Switch to main if not already on it (hotfixes must branch from main)
     if (current_branch !== "main") {
          consola.info(`Current branch: ${current_branch}`);
          consola.info("Hotfixes must be created from main. Switching to main...");

          const fetchSuccess = runCommandWithOutput("git fetch origin main", "Fetching latest main...");
          if (!fetchSuccess) {
               consola.error("Failed to fetch main. Make sure main branch exists.");
               process.exit(1);
          }

          const checkoutSuccess = runCommandWithOutput("git checkout main", "Switching to main...");
          if (!checkoutSuccess) {
               consola.error("Failed to switch to main. Make sure main branch exists.");
               process.exit(1);
          }

          const pullSuccess = runCommandWithOutput("git pull origin main", "Pulling latest main...");
          if (!pullSuccess) {
               consola.warn("Failed to pull latest main. Continuing anyway...");
          }
     }

     // Prompt for hotfix branch name (short identifier)
     const description = await consola.prompt("Hotfix branch name (short identifier, e.g., 'fix-login-bug'):", {
          type: "text",
          validate: (value: string) => {
               if (value.length === 0) return "Branch name cannot be empty";
               if (value.length > 50) return "Branch name must be 50 characters or less (will be prefixed with 'hotfix/')";
               return true;
          },
     });

     // Normalize description to kebab-case
     const kebab_description = description
          .toLowerCase()
          .replace(/\s+/g, "-")
          .replace(/[^a-z0-9-]/g, "-")
          .replace(/-+/g, "-")
          .replace(/^-|-$/g, "");

     const branch_name = `hotfix/${kebab_description}`;
     
     // Show preview of branch name
     consola.info(`Branch name will be: ${branch_name}`);

     // Create and checkout hotfix branch from main
     const branch_success = runCommandWithOutput(`git checkout -b ${branch_name}`, `Creating hotfix branch: ${branch_name}...`);
     if (!branch_success) {
          consola.error("Failed to create hotfix branch");
          process.exit(1);
     }

     const push_success = runCommandWithOutput(`git push -u origin ${branch_name}`, "Pushing branch to origin...");
     if (!push_success) {
          consola.warn("Branch created locally but failed to push to origin. You can push manually later.");
     } else {
          consola.success(`✅ Hotfix branch created: ${branch_name}`);
     }

     // Reapply stashed changes if we stashed them
     if (stashed_changes) {
          const reapply_success = runCommandWithOutput("git stash pop", "Reapplying stashed changes...");
          if (!reapply_success) {
               consola.warn("Failed to reapply stashed changes. Run 'git stash pop' manually.");
          }
     }
}

/**
 * Finish a hotfix branch - create TWO PRs:
 * 1. PR to main (squash merge - urgent fix gets to production)
 * 2. PR to develop (squash merge - ensure fix is in active development)
 */
export async function finishHotfix(gh_token: string): Promise<void> {
     consola.start("Finishing hotfix...");

     let current_branch = getCurrentBranch();

     // Validate we're on a hotfix branch
     if (!current_branch.startsWith("hotfix/")) {
          consola.error(`You're not on a hotfix branch! Current: ${current_branch}`);
          process.exit(1);
     }

     consola.info(`Current branch: ${current_branch}`);

     // Handle uncommitted changes (this may rename the branch if Linear issue is created)
     const _was_stashed = await handleUncommittedChanges();

     // Refresh current branch in case it was renamed during commit workflow
     const updated_branch = getCurrentBranch();
     if (updated_branch !== current_branch) {
          consola.info(`Branch was renamed to: ${updated_branch}`);
          current_branch = updated_branch;
     }

     // Push branch if needed
     await pushBranchIfNeeded(current_branch);

     // Fetch latest main for comparison
     consola.start("Fetching latest main and develop...");
     try {
          execSync("git fetch origin main develop");
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
     consola.box(`Hotfix Changes\n\nCommits: ${commit_count}\n\n${diff_summary}`);

     // Get user description
     const user_description = await consola.prompt("Describe the fix (optional):", {
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
          pr_title = `Hotfix: ${current_branch.replace("hotfix/", "")}`;
          pr_description = "Urgent fix for production";
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

     // Step 1: Create PR to main (urgent fix)
     consola.start("Creating PR to main...");
     const main_pr_url = await createPullRequest({
          gh_token: gh_token,
          title: pr_title,
          description: pr_description,
          base_branch: "main",
          draft: false,
     });

     if (!main_pr_url) {
          consola.error("Failed to create PR to main");
          process.exit(1);
     }

     consola.success(`✅ Main PR created: ${main_pr_url}`);

     // Step 2: Optionally create PR to develop (backport fix)
     const should_backport = await consola.prompt("Create PR to develop (backport fix)?", {
          type: "confirm",
          default: true,
     });

     if (should_backport) {
          consola.start("Creating PR to develop...");
          const develop_pr_url = await createPullRequest({
               gh_token: gh_token,
               title: `Backport: ${pr_title}`,
               description: `Backport of hotfix to develop\n\n${pr_description}`,
               base_branch: "develop",
               draft: false,
          });

          if (develop_pr_url) {
               consola.success(`✅ Develop PR created: ${develop_pr_url}`);
          }
     }

     // Only proceed with cleanup if at least the main PR was created
     if (!main_pr_url) {
          consola.error("Failed to create main PR. Branch cleanup skipped.");
          await restoreStashedChangesIfNeeded();
          return;
     }

     consola.success(`✅ Hotfix PRs created!`);
     consola.info("Remember: Merge main PR first, then develop PR");

     // Restore stashed changes if any
     await restoreStashedChangesIfNeeded();

     // Switch back to develop
     consola.start("Switching back to develop...");
     const checkoutSuccess = runCommandWithOutput("git checkout develop", "Switching to develop...");
     if (!checkoutSuccess) {
          consola.warn("Failed to switch to develop. Please switch manually.");
     } else {
          // Pull latest develop
          runCommandWithOutput("git pull origin develop", "Pulling latest develop...");
          
          // Ask if user wants to delete the local hotfix branch
          const shouldDelete = await consola.prompt(`Delete local branch "${current_branch}"?`, {
               type: "confirm",
               default: true,
          });

          if (shouldDelete) {
               const deleteSuccess = runCommandWithOutput(`git branch -d ${current_branch}`, `Deleting local branch ${current_branch}...`);
               if (!deleteSuccess) {
                    consola.warn(`Failed to delete branch. It may have unmerged changes. Use 'git branch -D ${current_branch}' to force delete.`);
               } else {
                    consola.success(`✅ Deleted local branch: ${current_branch}`);
               }
          } else {
               consola.info(`Local branch "${current_branch}" kept. You can delete it later with: git branch -d ${current_branch}`);
          }
     }
}
