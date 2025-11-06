import { execSync } from "child_process";
import * as fs from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { consola } from "consola";

import { commitWorkflow } from "./commit-workflow";
import { getRepoInfo } from "./git";

const commandExists = (cmd: string): boolean => {
     try {
          execSync(`which ${cmd}`, { stdio: "ignore" });
          return true;
     }
     catch {
          return false;
     }
};

/**
 * Handle uncommitted changes before creating PR
 * Offers user choice: commit, stash, or abort
 */
export async function handleUncommittedChanges(): Promise<boolean> {
     consola.start("Checking for uncommitted changes...");
     try {
          const uncommitted = execSync("git status --porcelain", { encoding: "utf-8" }).trim();
          if (uncommitted) {
               consola.warn("You have uncommitted changes!");
               consola.box(uncommitted);

               const action = await consola.prompt("What would you like to do?", {
                    type: "select",
                    options: [
                         { value: "commit", label: "Commit changes first (run auto-commit)" },
                         { value: "stash", label: "Stash changes and continue" },
                         { value: "abort", label: "Abort PR creation" },
                    ],
               });

               if (action === "commit") {
                    await commitWorkflow();
                    return true;
               } else if (action === "stash") {
                    execSync('git stash push -m "flow-automator: temporary stash"');
                    consola.success("Changes stashed");
                    return true;
               } else {
                    process.exit(0);
               }
          } else {
               consola.success("No uncommitted changes");
               return false;
          }
     }
     catch {
          consola.error("Failed to check git status");
          process.exit(1);
     }
}

/**
 * Ensure branch is pushed to remote, prompting user if needed
 */
export async function pushBranchIfNeeded(branch: string): Promise<void> {
     consola.start("Checking remote status...");
     try {
          const remote_exists = (() => {
               try {
                    execSync(`git ls-remote --heads origin "${branch}"`, { stdio: "ignore" });
                    return true;
               }
               catch {
                    return false;
               }
          })();

          if (!remote_exists) {
               consola.warn("Branch not found on remote");
               const should_push = await consola.prompt("Push branch to origin?", {
                    type: "confirm",
                    default: true,
               });

               if (should_push) {
                    consola.start("Pushing branch to origin...");
                    try {
                         execSync(`git push -u origin ${branch}`);
                         consola.success("Branch pushed successfully!");
                    }
                    catch {
                         consola.error("Failed to push branch");
                         process.exit(1);
                    }
               } else {
                    consola.error("Cannot create PR without pushing branch");
                    process.exit(1);
               }
          } else {
               // Remote exists, check if we're ahead/behind
               try {
                    const ahead_behind = execSync(`git rev-list --left-right --count origin/${branch}...HEAD`, { encoding: "utf-8" }).trim();
                    const [_behind, ahead] = ahead_behind.split("\t").map(Number);

                    if (ahead > 0) {
                         consola.warn(`Local branch is ${ahead} commit(s) ahead of remote`);
                         const should_push = await consola.prompt("Push commits to origin?", {
                              type: "confirm",
                              default: true,
                         });

                         if (should_push) {
                              consola.start("Pushing commits to origin...");
                              try {
                                   execSync(`git push origin ${branch}`);
                                   consola.success("Commits pushed successfully!");
                              }
                              catch {
                                   consola.error("Failed to push commits");
                                   process.exit(1);
                              }
                         } else {
                              consola.error("Cannot create PR without pushing all commits");
                              process.exit(1);
                         }
                    } else {
                         consola.success("Branch is up to date with remote");
                    }
               } catch (compare_error) {
                    // If we can't compare (e.g., branch was renamed, remote doesn't exist yet), 
                    // check if branch is already pushed by trying to get the remote tracking branch
                    try {
                         const remote_tracking = execSync("git rev-parse --abbrev-ref --symbolic-full-name @{u}", { encoding: "utf-8", stdio: "pipe" }).trim();
                         if (remote_tracking.includes(branch)) {
                              // Branch is already tracking remote, assume it's up to date
                              consola.success("Branch is tracking remote");
                         } else {
                              // Branch might have been renamed - assume it's already pushed
                              consola.info("Branch appears to be pushed (may have been renamed)");
                         }
                    } catch {
                         // Can't determine tracking - assume branch is already pushed
                         // (since we're here after commit workflow which may have pushed)
                         consola.info("Branch appears to be pushed (may have been renamed)");
                    }
               }
          }
     }
     catch (error) {
          // Don't fail hard - branch might have been renamed or already pushed
          const error_str = String(error);
          if (error_str.includes("unknown revision") || error_str.includes("ambiguous argument")) {
               consola.warn("Could not verify remote status (branch may have been renamed)");
               consola.info("Assuming branch is already pushed. Continuing...");
          } else {
               consola.error("Failed to check remote status:", error);
               process.exit(1);
          }
     }
}

/**
 * Create a pull request with title and description
 */
export async function createPullRequest(options: {
     gh_token: string;
     title: string;
     description: string;
     base_branch: string;
     draft?: boolean;
}): Promise<string | null> {
     if (!commandExists("gh")) {
          consola.error("GitHub CLI (gh) is not installed!");
          consola.info("Install it with: brew install gh");
          process.exit(1);
     }

     const gh_env = {
          ...process.env,
          GH_TOKEN: options.gh_token,
     };

     const repo_info = getRepoInfo();

     consola.start("Creating pull request...");

     try {
          const temp_file = join(tmpdir(), `pr-body-${Date.now()}.txt`);
          fs.writeFileSync(temp_file, options.description);

          // Escape double quotes in the title to be safe
          const escaped_title = options.title.replace(/"/g, '\\"');

          const draft_flag = options.draft ? "--draft" : "";
          const command = `gh pr create --repo "${repo_info || "MidtownHI/evergreen"}" --base "${options.base_branch}" --title "${escaped_title}" --body-file "${temp_file}" ${draft_flag}`;

          const pr_output = execSync(command, { encoding: "utf-8", env: gh_env }).trim();
          fs.unlinkSync(temp_file);

          consola.success("Pull request created successfully!");

          const pr_url_match = pr_output.match(/(https:\/\/github\.com\/[^\s]+)/);
          if (pr_url_match) {
               const pr_url = pr_url_match[1];
               consola.box(`PR Created!\n\n${pr_url}`);

               const should_open = await consola.prompt("Open PR in browser?", {
                    type: "confirm",
                    default: true,
               });

               if (should_open) {
                    execSync("gh pr view --web", { env: gh_env });
               }

               return pr_url;
          }

          return null;
     }
     catch (error) {
          consola.error("Failed to create pull request");
          consola.error(error);
          process.exit(1);
     }
}

/**
 * Restore stashed changes if they were stashed
 */
export async function restoreStashedChangesIfNeeded(): Promise<void> {
     const stash_list = execSync("git stash list", { encoding: "utf-8" }).trim();
     const has_temp_stash = stash_list.includes("flow-automator: temporary stash");

     if (has_temp_stash) {
          const should_restore = await consola.prompt("Restore your stashed changes?", {
               type: "confirm",
               default: true,
          });

          if (should_restore) {
               try {
                    execSync("git stash pop");
                    consola.success("Stashed changes restored!");
               }
               catch {
                    consola.warn("Failed to restore stash automatically. Run: git stash pop");
               }
          }
     }
}
