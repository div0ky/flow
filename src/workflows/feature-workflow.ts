import { consola } from "consola";

import { getConfig } from "../config/config-manager";
import { isLinearEnabled } from "../config/config-validation";
import { runCommandCapture, runCommandCaptureOrThrow, runCommandSilent, runCommandWithOutput } from "../utils/command";
import { ensureDevelopIsUpToDate } from "../utils/setup";
import { displayGitStatus, getGitStatus, getCurrentBranch } from "./git";
import { generatePRContent } from "./ai";
import { detectLinearIssue, linkLinearIssueToPR, cleanTitleForLinear } from "./linear";
import { handleUncommittedChanges, pushBranchIfNeeded, createPullRequest, restoreStashedChangesIfNeeded } from "./pr-shared";

/**
 * Start a new feature branch from develop
 * Prompts for Linear issue ID and description
 */
export async function startFeature(): Promise<void> {
     consola.start("Starting new feature...");

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
                    'git stash push -u -m "dflow: temporary stash for feature start"',
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

     // Check if develop is behind main and offer to catch it up
     await ensureDevelopIsUpToDate();

     // Switch to develop (always do this, don't ask)
     if (current_branch !== "develop") {
          const fetchSuccess = runCommandWithOutput("git fetch origin develop", "Fetching latest develop...");
          if (!fetchSuccess) {
               consola.error("Failed to fetch develop. Make sure develop branch exists.");
               process.exit(1);
          }

          const checkoutSuccess = runCommandWithOutput("git checkout develop", "Switching to develop...");
          if (!checkoutSuccess) {
               consola.error("Failed to switch to develop. Make sure develop branch exists.");
               process.exit(1);
          }

          const pullSuccess = runCommandWithOutput("git pull origin develop", "Pulling latest develop...");
          if (!pullSuccess) {
               consola.warn("Failed to pull latest develop. Continuing anyway...");
          }
     }

     // Reapply stashed changes if we stashed them
     if (stashed_changes) {
          const reapply_success = runCommandWithOutput("git stash pop", "Reapplying stashed changes...");
          if (!reapply_success) {
               consola.warn("Failed to reapply stashed changes. Run 'git stash pop' manually.");
          }
     }

     // Prompt for Linear issue ID (only if Linear is enabled)
     const linear_enabled = await isLinearEnabled();
     let linear_id: string | null = null;
     
     if (linear_enabled) {
          linear_id = await consola.prompt("Enter Linear issue ID (e.g., EV-123):", {
               type: "text",
               validate: (value: string) => /^[A-Z]+-\d+$/.test(value) || "Invalid format. Use EV-123",
          });
     } else {
          // If Linear is disabled, skip Linear ID prompt
          consola.info("Linear integration is disabled. Skipping Linear issue ID.");
     }

     // Prompt for feature branch name (short identifier)
     const description = await consola.prompt("Feature branch name (short identifier, e.g., 'add-user-auth'):", {
          type: "text",
          validate: (value: string) => {
               if (value.length === 0) return "Branch name cannot be empty";
               if (value.length > 50) return "Branch name must be 50 characters or less (will be prefixed with 'feature/{linear-id}-')";
               return true;
          },
     });

     // Build branch name with or without Linear ID
     let branch_name: string;
     if (linear_id) {
          const kebab_description = description
               .toLowerCase()
               .replace(/\s+/g, "-")
               .replace(/[^a-z0-9-]/g, "-")
               .replace(/-+/g, "-")
               .replace(/^-|-$/g, "");
          branch_name = `feature/${linear_id.toLowerCase()}-${kebab_description}`;
     } else {
          // No Linear ID - use simple feature branch name
          const kebab_description = description
               .toLowerCase()
               .replace(/\s+/g, "-")
               .replace(/[^a-z0-9-]/g, "-")
               .replace(/-+/g, "-")
               .replace(/^-|-$/g, "");
          branch_name = `feature/${kebab_description}`;
     }
     
     // Show preview of branch name
     consola.info(`Branch name will be: ${branch_name}`);

     // Create and checkout feature branch
     const branch_success = runCommandWithOutput(`git checkout -b ${branch_name}`, `Creating feature branch: ${branch_name}...`);
     if (!branch_success) {
          consola.error("Failed to create feature branch");
          process.exit(1);
     }

     const push_success = runCommandWithOutput(`git push -u origin ${branch_name}`, "Pushing branch to origin...");
     if (!push_success) {
          consola.warn("Branch created locally but failed to push to origin. You can push manually later.");
     } else {
          consola.success(`✅ Feature branch created: ${branch_name}`);
     }
}

/**
 * Finish a feature branch - create PR to develop
 */
export async function finishFeature(gh_token: string): Promise<void> {
     consola.start("Finishing feature...");

     let current_branch = getCurrentBranch();

     // Validate we're on a feature branch
     if (!current_branch.startsWith("feature/")) {
          consola.error(`You're not on a feature branch! Current: ${current_branch}`);
          process.exit(1);
     }

     consola.info(`Current branch: ${current_branch}`);
     consola.info(`Base branch: develop`);

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

     // Fetch latest develop for comparison
     runCommandWithOutput("git fetch origin develop", "Fetching latest develop...");

     // Analyze changes
     const commit_count_output = runCommandCaptureOrThrow(
          "git rev-list --count origin/develop..HEAD",
          "Failed to analyze changes",
     );
     const commit_count = parseInt(commit_count_output, 10);

     if (commit_count === 0) {
          consola.warn("No commits to create PR from.");
          process.exit(0);
     }

     const diff_summary = runCommandCaptureOrThrow(
          "git diff origin/develop..HEAD --stat",
          "Failed to get diff summary",
     );
     consola.box(`Changes Summary\n\nCommits: ${commit_count}\n\n${diff_summary}`);

     // Get user description for PR
     const user_description = await consola.prompt("Provide a brief description of your changes (optional):", {
          type: "text",
          default: "",
          required: false,
     });

     // Generate PR content
     consola.start("Generating PR title and description...");
     const generated_content = await generatePRContent(current_branch, "develop", user_description);

     let pr_title: string;
     let pr_description: string;

     if (!generated_content) {
          consola.error("Failed to generate PR content");
          const should_manual = await consola.prompt("Enter PR details manually?", {
               type: "confirm",
               default: true,
          });

          if (!should_manual) {
               process.exit(1);
          }

          pr_title = await consola.prompt("PR title:", {
               type: "text",
               validate: (value: string) => {
                    if (!value || value.length === 0) return "Title cannot be empty";
                    if (value.length > 72) return "Title must be 72 characters or less";
                    return true;
               },
          });

          pr_description = await consola.prompt("PR description:", {
               type: "text",
               default: "",
          });
     } else {
          consola.success("PR content generated!");
          pr_title = generated_content.title;
          pr_description = generated_content.description;

          consola.box(`PR Title:\n${pr_title}`);
          console.log("\nPR Description:");
          console.log("─".repeat(40));
          console.log(pr_description);
          console.log("─".repeat(40));

          const action = await consola.prompt("What would you like to do?", {
               type: "select",
               options: [
                    { value: "create", label: "Create PR" },
                    { value: "edit", label: "Edit the details" },
                    { value: "cancel", label: "Cancel" },
               ],
          });

          if (action === "edit") {
               pr_title = await consola.prompt("PR title:", {
                    type: "text",
                    default: pr_title,
                    validate: (value: string) => value.length > 0 && value.length <= 72,
               });

               pr_description = await consola.prompt("PR description:", {
                    type: "text",
                    default: pr_description,
               });
          } else if (action === "cancel") {
               consola.info("PR creation cancelled.");
               process.exit(0);
          }
     }

     // Create PR
     const pr_url = await createPullRequest({
          gh_token: gh_token,
          title: pr_title,
          description: pr_description,
          base_branch: "develop",
          draft: false,
     });

     if (!pr_url) {
          consola.error("Failed to create PR. Branch cleanup skipped.");
          await restoreStashedChangesIfNeeded();
          return;
     }

     // Link to Linear if applicable and enabled
     const linear_enabled = await isLinearEnabled();
     if (linear_enabled) {
          const linear_issue_id = detectLinearIssue(current_branch);
          if (linear_issue_id) {
               const config = await getConfig();
               const linear_api_key = config.linearApiKey;
               if (linear_api_key) {
                    const clean_title = cleanTitleForLinear(pr_title);
                    const linear_comment = generated_content?.linear_comment;

                    const linked = await linkLinearIssueToPR(
                         linear_issue_id,
                         clean_title,
                         pr_url,
                         linear_api_key,
                         false,
                         linear_comment,
                    );

                    if (linked) {
                         consola.success(`✅ Linked Linear issue ${linear_issue_id} to PR`);
                    }
               }
          }
     }

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
          
          // Ask if user wants to delete the local feature branch
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
