import { execSync } from "child_process";

import { consola } from "consola";

import { generatePRContent } from "./ai";
import { getCurrentBranch } from "./git";
import { handleUncommittedChanges, pushBranchIfNeeded, createPullRequest, restoreStashedChangesIfNeeded } from "./pr-shared";

/**
 * Start a new hotfix branch from main
 * Hotfixes are for urgent fixes that bypass the normal develop → release cycle
 */
export async function startHotfix(): Promise<void> {
     consola.start("Starting hotfix...");

     const current_branch = getCurrentBranch();

     // Ensure we're on main
     if (current_branch !== "main") {
          consola.warn(`You're currently on: ${current_branch}`);
          const should_switch = await consola.prompt("Switch to main first?", {
               type: "confirm",
               default: true,
          });

          if (should_switch) {
               consola.start("Checking out main...");
               try {
                    execSync("git fetch origin main");
                    execSync("git checkout main");
                    execSync("git pull origin main");
                    consola.success("Switched to main");
               } catch {
                    consola.error("Failed to switch to main");
                    process.exit(1);
               }
          } else {
               consola.warn("Hotfix should branch from main");
               process.exit(1);
          }
     }

     // Prompt for hotfix description
     const description = await consola.prompt("Brief description of hotfix:", {
          type: "text",
          validate: (value: string) => value.length > 0 && value.length <= 50,
     });

     // Normalize description to kebab-case
     const kebab_description = description
          .toLowerCase()
          .replace(/\s+/g, "-")
          .replace(/[^a-z0-9-]/g, "-")
          .replace(/-+/g, "-")
          .replace(/^-|-$/g, "");

     const branch_name = `hotfix/${kebab_description}`;

     // Create and checkout hotfix branch
     consola.start(`Creating hotfix branch: ${branch_name}`);
     try {
          execSync(`git checkout -b ${branch_name}`);
          execSync(`git push -u origin ${branch_name}`);
          consola.success(`✅ Hotfix branch created: ${branch_name}`);
          consola.info("Push your fixes and then finish the hotfix");
     } catch (error) {
          consola.error("Failed to create hotfix branch");
          consola.error(error);
          process.exit(1);
     }
}

/**
 * Finish a hotfix branch - create TWO PRs:
 * 1. PR to main (squash merge - urgent fix gets to production)
 * 2. PR to develop (squash merge - ensure fix is in active development)
 */
export async function finishHotfix(gh_token: string): Promise<void> {
     consola.start("Finishing hotfix...");

     const current_branch = getCurrentBranch();

     // Validate we're on a hotfix branch
     if (!current_branch.startsWith("hotfix/")) {
          consola.error(`You're not on a hotfix branch! Current: ${current_branch}`);
          process.exit(1);
     }

     consola.info(`Current branch: ${current_branch}`);

     // Handle uncommitted changes
     const _was_stashed = await handleUncommittedChanges();

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

     consola.success(`✅ Hotfix PRs created!`);
     consola.info("Remember: Merge main PR first, then develop PR");

     // Restore stashed changes if any
     await restoreStashedChangesIfNeeded();
}
