import { execSync } from "child_process";

import { consola } from "consola";

import { getConfig } from "../config/config-manager";
import { isLinearEnabled } from "../config/config-validation";
import { runCommandWithOutput } from "../utils/command";
import { explainError, generateCommitMessage, generateLinearContent } from "./ai";
import type { CommitMessage } from "./ai";
import { displayGitStatus, getGitStatus, getCurrentBranch, isProtectedBranch } from "./git";
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
          execSync("git add .", { stdio: ["ignore", "pipe", "pipe"] });
          execSync(`git commit -m "${message}"`, { stdio: ["ignore", "pipe", "pipe"] });
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
                              // CRITICAL: Never allow force push to protected branches
                              if (isProtectedBranch(branch)) {
                                   consola.error(`❌ CRITICAL: Cannot force push to protected branch "${branch}"`);
                                   consola.error(`Protected branches (main, develop, staging) cannot be force-pushed.`);
                                   consola.error(`This is a safety measure to prevent accidental overwriting of critical branches.`);
                                   consola.info("Please use pull/rebase instead, or switch to a feature branch.");
                                   return;
                              }
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
                              // CRITICAL: Never allow force push to protected branches
                              if (isProtectedBranch(branch)) {
                                   consola.error(`❌ CRITICAL: Cannot force push to protected branch "${branch}"`);
                                   consola.error(`Protected branches (main, develop, staging) cannot be force-pushed.`);
                                   consola.error(`This is a safety measure to prevent accidental overwriting of critical branches.`);
                                   return;
                              }
                              execSync(`git push --force origin ${branch}`);
                              consola.success("Changes force-pushed successfully!");
                         }
                    }
               }
          }
     } catch (error: unknown) {
          // Extract error message without exposing stack traces
          let error_message = "";
          let error_str = "";
          
          if (error instanceof Error) {
               // Only use the message, not the stack trace
               error_message = error.message;
               error_str = error.message;
          } else {
               error_str = String(error);
               error_message = error_str;
          }

          // Detect pre-commit hook failures (husky, lint-staged, eslint, etc.)
          const isHookFailure = 
               error_str.includes("husky") ||
               error_str.includes("pre-commit") ||
               error_str.includes("lint-staged") ||
               error_str.includes("ESLint") ||
               error_str.includes("eslint") ||
               error_str.includes("pre-commit script failed");

          if (isHookFailure) {
               consola.error("❌ Commit failed due to pre-commit hook");
               consola.warn("Your git hooks (husky/lint-staged) prevented the commit.");
               
               // Extract just the core error message (avoid all the noise)
               const lines = error_message.split("\n");
               
               // Find the actual error line (TypeError, ESLint error, etc.)
               const error_line = lines.find(line => {
                    const trimmed = line.trim();
                    return (
                         trimmed.includes("TypeError:") ||
                         trimmed.includes("Error:") ||
                         (trimmed.includes("ESLint:") && trimmed.length < 100) ||
                         trimmed.includes("Rule:") ||
                         trimmed.includes("Occurred while linting")
                    );
               });

               // Find the file/line info
               const file_info = lines.find(line => 
                    line.includes("Occurred while linting") || 
                    line.includes(".ts:") ||
                    line.includes(".js:")
               );

               // Build a clean error summary
               const clean_error_parts: string[] = [];
               if (error_line) {
                    clean_error_parts.push(error_line.trim());
               }
               if (file_info && !clean_error_parts.includes(file_info.trim())) {
                    clean_error_parts.push(file_info.trim());
               }

               if (clean_error_parts.length > 0) {
                    consola.box(clean_error_parts.join("\n"));
               } else {
                    // Fallback: show a generic message
                    consola.warn("Pre-commit hook failed. Check the error details above.");
               }

               // Try to get AI explanation - use the clean error parts
               const error_for_ai = clean_error_parts.join("\n") || error_line || "ESLint pre-commit hook failed";
               
               consola.start("Generating user-friendly error explanation...");
               const explanation = await explainError(error_for_ai);
               
               if (explanation && !explanation.startsWith("{") && explanation.length > 50) {
                    // Only show if it's not raw JSON and has meaningful content
                    consola.success("✅ Error explanation:");
                    console.log("\n" + "─".repeat(60));
                    console.log(explanation);
                    console.log("─".repeat(60) + "\n");
               } else {
                    // Fallback to specific guidance based on error type
                    if (error_str.includes("TypeError") && error_str.includes("typeParameters.params")) {
                         consola.error("ESLint plugin bug detected");
                         consola.info("This is a known issue with @typescript-eslint/eslint-plugin");
                         consola.info("Solutions:");
                         consola.info("  1. Temporarily disable the rule: Add '@typescript-eslint/unified-signatures: off' to your ESLint config");
                         consola.info("  2. Update dependencies: Run 'npm update @typescript-eslint/eslint-plugin @typescript-eslint/parser'");
                         consola.info("  3. Skip hooks for this commit: Choose 'Skip hooks' option below");
                    } else if (error_str.includes("ESLint")) {
                         consola.error("ESLint found errors in your code.");
                         consola.info("Run 'npm run lint' or 'bun run lint' to see all errors");
                    }
               }

               const action = await consola.prompt("What would you like to do?", {
                    type: "select",
                    options: [
                         { value: "fix", label: "Fix the issues and retry commit" },
                         { value: "skip", label: "Skip hooks and commit anyway (⚠️  not recommended)" },
                         { value: "cancel", label: "Cancel commit" },
                    ],
               });

               if (action === "skip") {
                    consola.warn("⚠️  Skipping git hooks - this bypasses code quality checks!");
                    const confirm_skip = await consola.prompt("Are you sure you want to skip hooks?", {
                         type: "confirm",
                         default: false,
                    });

                    if (confirm_skip) {
                         try {
                              execSync(`git commit -m "${message}" --no-verify`);
                              consola.success("Changes committed (hooks skipped)!");
                              
                              // Get current branch for push prompt
                              const branch = execSync("git branch --show-current", { encoding: "utf-8" }).trim();
                              const should_push = await consola.prompt("Push to origin?", {
                                   type: "confirm",
                                   default: true,
                              });

                              if (should_push) {
                                   runCommandWithOutput(`git push origin ${branch}`, `Pushing to origin/${branch}...`);
                              }
                         } catch (skip_error) {
                              consola.error("Failed to commit even with --no-verify");
                              consola.error(skip_error);
                              process.exit(1);
                         }
                    } else {
                         consola.info("Commit cancelled. Please fix the issues and try again.");
                         process.exit(0);
                    }
               } else if (action === "fix") {
                    consola.info("Please fix the issues shown above and run dflow commit again.");
                    consola.info("Common fixes:");
                    consola.info("  • Run 'npm run lint' or 'bun run lint' to see all errors");
                    consola.info("  • Fix TypeScript errors");
                    consola.info("  • Fix ESLint violations");
                    process.exit(1);
               } else {
                    consola.info("Commit cancelled.");
                    process.exit(0);
               }
          } else {
               // Other commit errors
               consola.error("Failed to commit changes");
               consola.error(error_message);
               process.exit(1);
          }
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

     // Only check Linear if it's enabled
     const linear_enabled = await isLinearEnabled();
     
     if (!has_linear_pattern && linear_enabled) {
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
                    consola.info("Please run: dflow config init");
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
