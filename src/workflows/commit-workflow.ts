import { execSync } from "child_process";

import { consola } from "consola";

import { getConfig } from "../config/config-manager";
import { generateCommitMessage, generateLinearContent } from "./ai";
import type { CommitMessage } from "./ai";
import { displayGitStatus, getGitStatus, getCurrentBranch } from "./git";
import {
     hasLinearPattern,
     createLinearIssue,
     generateLinearBranchName,
     renameBranchToLinearPattern,
     confirmLinearMetadata,
} from "./linear";

const commit_type_descriptions = {
     feat: "An entirely new feature",
     fix: "Correcting unintended behavior / fixing a bug",
     chore: "Maintenance, refactoring, tooling, comments, jsdocs",
     docs: "Documentation changes",
     improve: "Improving or expanding on existing features",
     change: "Changes to existing functionality without expanding or improving",
     hotfix: "Urgent fixes of unintended behavior",
} as const;

const formatCommitMessage = (commit: CommitMessage): string => {
     return commit.scope
          ? `${commit.type}(${commit.scope}): ${commit.description}`
          : `${commit.type}: ${commit.description}`;
};

async function processCommit(message: string): Promise<void> {
     consola.start("Committing changes...");

     try {
          execSync("git add .");
          execSync(`git commit -m "${message}"`);
          consola.success("Changes committed successfully!");

          // Get current branch
          const branch = execSync("git branch --show-current", { encoding: "utf-8" }).trim();
          consola.info(`Current branch: ${branch}`);

          // Ask about pushing
          const should_push = await consola.prompt("Push to origin?", {
               type: "confirm",
               default: true,
          });

          if (should_push) {
               consola.start(`Pushing to origin/${branch}...`);
               try {
                    execSync(`git push origin ${branch}`);
                    consola.success("Changes pushed successfully!");
               } catch (error: unknown) {
                    consola.error("Failed to push changes");

                    // Check if it's a non-fast-forward error (branch diverged)
                    const error_str = String(error);
                    if (error_str.includes("non-fast-forward") || error_str.includes("rejected")) {
                         // Offer intelligent options for handling diverged branches
                         const action = await consola.prompt("Remote has changes. What would you like to do?", {
                              type: "select",
                              options: [
                                   { value: "pull", label: "Pull and merge remote changes" },
                                   { value: "rebase", label: "Pull and rebase on remote changes" },
                                   { value: "force", label: "Force push (overwrites remote)" },
                                   { value: "skip", label: "Skip push for now" },
                              ],
                         });

                         if (action === "pull") {
                              try {
                                   consola.start("Pulling remote changes...");
                                   execSync(`git pull origin ${branch}`);
                                   consola.success("Merged remote changes");
                                   execSync(`git push origin ${branch}`);
                                   consola.success("Changes pushed successfully!");
                              } catch {
                                   consola.error("Failed to pull and push. You may need to resolve conflicts.");
                              }
                         } else if (action === "rebase") {
                              try {
                                   consola.start("Rebasing on remote changes...");
                                   execSync(`git pull --rebase origin ${branch}`);
                                   consola.success("Rebased on remote changes");
                                   execSync(`git push origin ${branch}`);
                                   consola.success("Changes pushed successfully!");
                              } catch {
                                   consola.error("Failed to rebase. You may need to resolve conflicts.");
                              }
                         } else if (action === "force") {
                              execSync(`git push --force origin ${branch}`);
                              consola.success("Changes force-pushed successfully!");
                         }
                         // 'skip' action does nothing
                    } else {
                         // Other error, offer simple force push
                         const force_push = await consola.prompt("Force push?", {
                              type: "confirm",
                              default: false,
                         });
                         if (force_push) {
                              execSync(`git push --force origin ${branch}`);
                              consola.success("Changes force-pushed successfully!");
                         }
                    }
               }
          }
     } catch (error) {
          consola.error("Failed to commit changes");
          consola.error(error);
          process.exit(1);
     }
}

/**
 * Interactive commit workflow. We always ask for an optional user description up front
 * (same UX as PR flow) to improve AI commit generation. After showing the suggestion,
 * users can commit, edit manually, or provide a new description to regenerate.
 */
export async function commitWorkflow(): Promise<void> {
     execSync("git add .");
     const status = getGitStatus();

     if (status.staged.length === 0 && status.unstaged.length === 0 && status.untracked.length === 0) {
          consola.info("No changes detected. Working tree is clean.");
          process.exit(0);
     }

     displayGitStatus(status);

     if (status.staged.length === 0) {
          const should_stage = await consola.prompt("No files are staged. Stage all changes?", {
               type: "confirm",
               default: true,
          });

          if (should_stage) {
               consola.start("Staging all changes...");
               try {
                    execSync("git add -A");
                    consola.success("All changes staged!");
                    Object.assign(status, getGitStatus());
               } catch {
                    consola.error("Failed to stage changes");
                    process.exit(1);
               }
          } else {
               consola.warn("Please stage your changes first.");
               process.exit(0);
          }
     }

     // Check for Linear issue pattern in branch name
     const current_branch = getCurrentBranch();
     const has_linear_pattern = hasLinearPattern(current_branch);

     if (!has_linear_pattern) {
          consola.warn("⚠️  No Linear issue detected in branch name.");
          consola.info(`Current branch: ${current_branch}`);

          const create_linear_issue = await consola.prompt("Create a Linear issue for this work?", {
               type: "confirm",
               default: true,
          });

          if (create_linear_issue) {
               const config = await getConfig();
               const linear_api_key = config.linearApiKey;

               if (!linear_api_key) {
                    consola.error("Linear API key not configured.");
                    consola.info("Please run: div-flow config init");
                    consola.info("You can find your API key at: https://linear.app/settings/api");
               } else {
                    // Ask user to describe the work being done
                    const user_description = await consola.prompt(
                         "Briefly describe what this work accomplishes (helps AI generate better Linear issue):",
                         {
                              type: "text",
                              default: "",
                              required: false,
                         },
                    );

                    // Generate Linear issue content from the staged changes and user description
                    const linear_content = await generateLinearContent(user_description);

                    if (linear_content) {
                         consola.success("Linear issue content generated!");
                         consola.box(`Title: ${linear_content.title}`);
                         console.log("\nDescription:");
                         console.log("─".repeat(40));
                         console.log(linear_content.description);
                         console.log("─".repeat(40));

                         const action = await consola.prompt("What would you like to do?", {
                              type: "select",
                              options: [
                                   { value: "create", label: "Create Linear issue with this content" },
                                   { value: "edit", label: "Edit the title and description" },
                                   { value: "skip", label: "Skip Linear issue creation" },
                              ],
                         });

                         if (action === "edit") {
                              linear_content.title = await consola.prompt("Issue title:", {
                                   type: "text",
                                   default: linear_content.title,
                                   validate: (value: string) => value.length > 0 && value.length <= 200,
                              });

                              linear_content.description = await consola.prompt("Issue description:", {
                                   type: "text",
                                   default: linear_content.description,
                              });
                         }

                         if (action === "create" || action === "edit") {
                              // Get user confirmation for AI-suggested metadata
                              const confirmed_metadata = await confirmLinearMetadata(
                                   {
                                        priority: linear_content.priority,
                                        estimate: linear_content.estimate,
                                        suggested_label: linear_content.suggested_label,
                                   },
                                   linear_api_key,
                              );

                              if (confirmed_metadata) {
                                   const created_issue = await createLinearIssue(
                                        linear_content.title,
                                        linear_content.description,
                                        linear_api_key,
                                        confirmed_metadata,
                                   );

                                   if (created_issue) {
                                        consola.success(`✅ Linear issue created: ${created_issue.url}`);

                                        // Automatically rename branch to follow Linear pattern
                                        const new_branch_name = generateLinearBranchName(created_issue.identifier, current_branch);
                                        consola.info(`Renaming branch to ${new_branch_name} to link with Linear issue...`);
                                        renameBranchToLinearPattern(new_branch_name, current_branch);
                                   }
                              } else {
                                   consola.info("Linear issue creation cancelled by user");
                              }
                         }
                    }
               }
          }
     }

     // Optional description from user to help AI generate better commit message
     let user_description = await consola.prompt(
          "Provide a brief description of your changes (optional - helps AI generate better commit message):",
          {
               type: "text",
               default: "",
               required: false,
          },
     );

     let generated_commit = await generateCommitMessage(user_description);

     if (!generated_commit) {
          consola.error("Failed to generate commit message");
          const should_manual = await consola.prompt("Enter commit message manually?", {
               type: "confirm",
               default: true,
          });

          if (!should_manual) {
               process.exit(1);
          }

          const type = await consola.prompt("Select commit type:", {
               type: "select",
               options: Object.entries(commit_type_descriptions).map(([value, label]) => ({
                    value: value,
                    label: `${value}: ${label}`,
               })),
          }) as keyof typeof commit_type_descriptions;

          const description = await consola.prompt("Description:", {
               type: "text",
               validate: (value: string) => value.length > 0,
          });

          const manual_commit: CommitMessage = {
               type: type,
               description: description,
          };

          await processCommit(formatCommitMessage(manual_commit));
     } else {
          // Loop to allow refine-with-description until the user commits or cancels
          // We keep last generated message so users can compare and iterate quickly.
          // This mirrors the PR flow where additional context improves AI output.

          while (true) {
               consola.success("Commit message generated!");

               const formatted_message = formatCommitMessage(generated_commit);
               consola.box(formatted_message);

               const action = await consola.prompt("What would you like to do?", {
                    type: "select",
                    options: [
                         { value: "commit", label: "Commit with this message" },
                         { value: "edit", label: "Edit the message" },
                         { value: "refine", label: "Provide description to try again" },
                         { value: "cancel", label: "Cancel" },
                    ],
               });

               if (action === "edit") {
                    const edited = await consola.prompt("Edit commit message:", {
                         type: "text",
                         default: formatted_message,
                    });
                    await processCommit(edited);
                    break;
               } else if (action === "commit") {
                    await processCommit(formatted_message);
                    break;
               } else if (action === "refine") {
                    user_description = await consola.prompt(
                         "Describe the changes (this will be heavily prioritized):",
                         {
                              type: "text",
                              default: "",
                              required: false,
                         },
                    );
                    const retry = await generateCommitMessage(user_description);
                    if (!retry) {
                         consola.error("Failed to regenerate commit message");
                         continue;
                    }
                    generated_commit = retry;
                    continue;
               } else {
                    consola.info("Commit cancelled.");
                    process.exit(0);
               }
          }
     }
}
