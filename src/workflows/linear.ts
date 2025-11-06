import { execSync } from "child_process";

import { LinearClient } from "@linear/sdk";
import { consola } from "consola";

export interface LinearIssue {
     id: string;
     identifier: string;
     title: string;
     description?: string;
     url: string;
}

export interface LinearContent {
     title: string;
     description: string;
}

/**
 * Detects if the current branch follows the Linear issue pattern
 * Pattern: username/dev-###-description or similar
 * @param branch - The branch name to check
 * @returns Linear issue identifier (e.g., "DEV-444") or null if not found
 */
export const detectLinearIssue = (branch: string): string | null => {
     // Pattern matches: username/dev-444-description -> DEV-444
     const linear_pattern = /\/([a-zA-Z]+-\d+)-/;
     const match = branch.match(linear_pattern);

     if (match) {
          // Convert dev-444 to DEV-444
          const [, issue_part] = match;
          const upper_issue = issue_part.toUpperCase();
          return upper_issue;
     }

     return null;
};

/**
 * Checks if branch name follows Linear pattern but extracts any issue ID present
 * @param branch - The branch name to check
 * @returns true if it follows pattern, false if it's a "quick" branch
 */
export const hasLinearPattern = (branch: string): boolean => {
     return detectLinearIssue(branch) !== null;
};

/**
 * Cleans up a PR title for Linear by removing conventional commit prefixes
 * @param pr_title - The PR title (e.g., "feat(auth): Add user authentication")
 * @returns Clean title suitable for Linear (e.g., "Add user authentication")
 */
export const cleanTitleForLinear = (pr_title: string): string => {
     // Remove conventional commit prefixes like "feat(scope): ", "fix: ", "chore(ui): ", etc.
     const conventional_pattern = /^(feat|fix|docs|style|refactor|test|chore|perf|ci|build|revert)(\([^)]+\))?: /i;
     return pr_title.replace(conventional_pattern, "");
};

/**
 * Creates a Linear issue using the Linear API
 * @param title - Issue title
 * @param description - Issue description
 * @param api_key - Linear API key
 * @param options - Optional parameters for priority, estimate, and labels
 * @returns Created Linear issue or null if failed
 */
export const createLinearIssue = async (
     title: string,
     description: string,
     api_key: string,
     options?: {
          priority?: number;
          estimate?: number;
          labelIds?: string[];
     },
): Promise<LinearIssue | null> => {
     try {
          consola.start("Creating Linear issue...");

          const linear = new LinearClient({
               apiKey: api_key,
          });

          // Get all teams and find the DEV team
          const teams = await linear.teams();
          const dev_team = teams.nodes.find((t) =>
               t.key.toLowerCase() === "dev"
               || t.name.toLowerCase().includes("dev")
               || t.key.toLowerCase() === "development",
          );

          if (!dev_team) {
               consola.error("DEV team not found in Linear");
               consola.info("Available teams:", teams.nodes.map((t) => `${t.name} (${t.key})`).join(", "));
               return null;
          }

          // Create the issue with optional metadata
          const create_issue_input: {
               teamId: string;
               title: string;
               description: string;
               priority?: number;
               estimate?: number;
               labelIds?: string[];
          } = {
               teamId: dev_team.id,
               title: title,
               description: description,
          };

          // Add optional fields if provided
          if (options?.priority !== undefined) {
               create_issue_input.priority = options.priority;
          }
          if (options?.estimate !== undefined && options.estimate > 0) {
               create_issue_input.estimate = options.estimate;
          }
          if (options?.labelIds && options.labelIds.length > 0) {
               create_issue_input.labelIds = options.labelIds;
          }

          const issue_response = await linear.createIssue(create_issue_input);

          const issue = await issue_response.issue;

          if (!issue) {
               consola.error("Failed to create Linear issue");
               return null;
          }

          consola.success(`✅ Created Linear issue: ${issue.identifier}`);

          return {
               id: issue.id,
               identifier: issue.identifier,
               title: issue.title,
               description: issue.description || "",
               url: issue.url,
          };
     } catch (error) {
          consola.error("Failed to create Linear issue:", error);
          return null;
     }
};

/**
 * Prompts user to confirm or modify AI-suggested Linear issue metadata
 * @param ai_suggestions - AI-generated suggestions for priority, estimate, and label
 * @param api_key - Linear API key for fetching available labels
 * @returns User-confirmed options or null if cancelled
 */
export const confirmLinearMetadata = async (
     ai_suggestions: {
          priority: number;
          estimate?: number;
          suggested_label?: string;
     },
     api_key: string,
): Promise<{ priority: number; estimate?: number; labelIds?: string[] } | null> => {
     // Priority options mapping
     const priority_names = ["No priority", "Urgent", "High", "Medium", "Low"];
     const estimate_names = ["No estimate", "-", "XS", "S", "M", "L", "XL"];

     consola.box(`AI Suggestions:\n✓ Priority: ${priority_names[ai_suggestions.priority]}\n${ai_suggestions.estimate ? `✓ Estimate: ${estimate_names[ai_suggestions.estimate]}` : "✓ Estimate: Not set"}\n${ai_suggestions.suggested_label ? `✓ Label: ${ai_suggestions.suggested_label}` : "✓ Label: Not set"}`);

     const accept_all = await consola.prompt("Accept all AI suggestions?", {
          type: "confirm",
          default: true,
     });

     let final_priority = ai_suggestions.priority;
     let final_estimate = ai_suggestions.estimate;
     let final_label_ids: string[] | undefined;

     if (!accept_all) {
          // Let user modify individual suggestions
          const modify_choice = await consola.prompt("What would you like to change?", {
               type: "select",
               options: [
                    { value: "priority", label: "Priority" },
                    { value: "estimate", label: "Estimate" },
                    { value: "label", label: "Label" },
                    { value: "all", label: "All fields" },
                    { value: "cancel", label: "Cancel issue creation" },
               ],
          });

          if (modify_choice === "cancel") {
               return null;
          }

          if (modify_choice === "priority" || modify_choice === "all") {
               final_priority = await consola.prompt("Select priority:", {
                    type: "select",
                    options: priority_names.map((name, index) => ({
                         value: index,
                         label: `${name} (${index})`,
                    })),
                    default: ai_suggestions.priority,
               });
          }

          if (modify_choice === "estimate" || modify_choice === "all") {
               final_estimate = await consola.prompt("Select estimate:", {
                    type: "select",
                    options: estimate_names.map((name, index) => ({
                         value: index,
                         label: `${name} (${index})`,
                    })),
                    default: ai_suggestions.estimate || 0,
               });
               if (final_estimate === 0) final_estimate = undefined;
          }

          if (modify_choice === "label" || modify_choice === "all") {
               // Fetch available labels from Linear
               const available_labels = await fetchLinearLabels(api_key);
               if (available_labels) {
                    const label_choice = await consola.prompt("Select label:", {
                         type: "select",
                         options: [
                              { value: "none", label: "No label" },
                              ...available_labels.map((label) => ({
                                   value: label.id,
                                   label: label.name,
                              })),
                         ],
                         default: available_labels.find((l) => l.name === ai_suggestions.suggested_label)?.id || "none",
                    });

                    if (label_choice !== "none") {
                         final_label_ids = [label_choice];
                    }
               }
          }
     } else {
          // User accepted all suggestions, need to get label ID if suggested
          if (ai_suggestions.suggested_label) {
               const available_labels = await fetchLinearLabels(api_key);
               if (available_labels) {
                    const matching_label = available_labels.find((l) => l.name === ai_suggestions.suggested_label);
                    if (matching_label) {
                         final_label_ids = [matching_label.id];
                    }
               }
          }
     }

     return {
          priority: final_priority,
          estimate: final_estimate,
          labelIds: final_label_ids,
     };
};

/**
 * Fetches available labels from Linear API
 * @param api_key - Linear API key
 * @returns Array of label objects with id, name, and color or null if failed
 */
export const fetchLinearLabels = async (api_key: string): Promise<Array<{ id: string; name: string; color: string }> | null> => {
     try {
          consola.start("Fetching available labels from Linear...");

          const linear = new LinearClient({
               apiKey: api_key,
          });

          const labels = await linear.issueLabels();
          const label_list = labels.nodes.map((label) => ({
               id: label.id,
               name: label.name,
               color: label.color,
          }));

          consola.success(`✅ Found ${label_list.length} available labels`);
          return label_list;
     } catch (error) {
          consola.error("Failed to fetch Linear labels:", error);
          return null;
     }
};

/**
 * Updates an existing Linear issue
 * @param issue_identifier - The Linear issue identifier (e.g., "DEV-444")
 * @param title - New title
 * @param description - New description
 * @param api_key - Linear API key
 * @returns Success boolean
 */
export const updateLinearIssue = async (
     issue_identifier: string,
     title: string,
     description: string,
     api_key: string,
): Promise<boolean> => {
     try {
          consola.start(`Updating Linear issue ${issue_identifier}...`);

          const linear = new LinearClient({
               apiKey: api_key,
          });

          // Find the issue by identifier - Linear uses number for filtering, not identifier
          const issues = await linear.issues({
               filter: {
                    number: { eq: parseInt(issue_identifier.split("-")[1]) },
               },
          });

          const issue = issues.nodes[0];
          if (!issue) {
               consola.error(`Linear issue ${issue_identifier} not found`);
               return false;
          }

          // Update the issue
          await linear.updateIssue(issue.id, {
               title: title,
               description: description,
          });

          consola.success(`✅ Updated Linear issue: ${issue_identifier}`);
          return true;
     } catch (error) {
          consola.error(`Failed to update Linear issue ${issue_identifier}:`, error);
          return false;
     }
};

/**
 * Links a Linear issue to a PR with appropriate action (comment for new, update for existing)
 * @param issue_identifier - The Linear issue identifier (e.g., "DEV-444")
 * @param pr_title - Clean PR title (without conventional commit prefixes)
 * @param pr_url - URL to the pull request
 * @param api_key - Linear API key
 * @param is_update - Whether this is a PR update (true) or new PR (false)
 * @param custom_comment - Optional custom comment instead of default
 * @returns Success boolean
 */
export const linkLinearIssueToPR = async (
     issue_identifier: string,
     pr_title: string,
     pr_url: string,
     api_key: string,
     is_update: boolean = false,
     custom_comment?: string,
): Promise<boolean> => {
     try {
          const action = is_update ? "Updating" : "Linking";
          consola.start(`${action} Linear issue ${issue_identifier} to PR...`);

          const linear = new LinearClient({
               apiKey: api_key,
          });

          // Find the issue by identifier - Linear uses number for filtering, not identifier
          const issues = await linear.issues({
               filter: {
                    number: { eq: parseInt(issue_identifier.split("-")[1]) },
               },
          });

          const issue = issues.nodes[0];
          if (!issue) {
               consola.error(`Linear issue ${issue_identifier} not found`);
               return false;
          }

          // Always update the issue title to match the PR (clean version)
          await linear.updateIssue(issue.id, {
               title: pr_title,
          });

          // Add comment for both new PRs and updates (but with different logic)
          if (!is_update) {
               // For new PRs, check if we already have a comment to avoid duplicates
               const existing_comments = await linear.comments({
                    filter: {
                         issue: { id: { eq: issue.id } },
                    },
               });

               const pr_already_commented = existing_comments.nodes.some((comment) =>
                    comment.body.includes(pr_url),
               );

               if (!pr_already_commented) {
                    // Use custom comment if provided, otherwise fallback to default
                    const comment_body = custom_comment
                         ? `${custom_comment} [Link to PR](${pr_url})\n\n_Automated via flow-automator_`
                         : `I created a PR for this: [${pr_title}](${pr_url})\n\n_Automated via flow-automator_`;

                    // Add comment to the issue
                    await linear.createComment({
                         issueId: issue.id,
                         body: comment_body,
                    });
               }
          } else if (custom_comment) {
               // For updates, always add a comment if we have custom content
               const comment_body = `${custom_comment} [Link to PR](${pr_url})\n\n_Automated via flow-automator_`;

               // Add comment to the issue
               await linear.createComment({
                    issueId: issue.id,
                    body: comment_body,
               });
          }

          const message = is_update ? "updated" : "linked to PR";
          consola.success(`✅ Linear issue ${issue_identifier} ${message}`);
          return true;
     } catch (error) {
          consola.error(`Failed to link Linear issue ${issue_identifier} to PR:`, error);
          return false;
     }
};

/**
 * Generates a new branch name following Linear pattern
 * @param issue_identifier - The Linear issue identifier (e.g., "DEV-444")
 * @param current_branch - Current branch name to extract username and description from
 * @returns New branch name (e.g., "aaron/dev-444-original-description")
 */
export const generateLinearBranchName = (
     issue_identifier: string,
     current_branch: string,
): string => {
     // Extract username (everything before first slash)
     const username_match = current_branch.match(/^([^/]+)\//);
     const username = username_match ? username_match[1] : "feature";

     // Extract description part (everything after last slash, clean it up)
     const description_part = current_branch.split("/").pop() || "work";
     const clean_description = description_part
          .replace(/[^a-zA-Z0-9-]/g, "-") // Replace special chars with dashes
          .replace(/-+/g, "-") // Replace multiple dashes with single
          .replace(/^-|-$/g, ""); // Remove leading/trailing dashes

     const linear_part = issue_identifier.toLowerCase(); // dev-444

     return `${username}/${linear_part}-${clean_description}`;
};

/**
 * Renames current branch to follow Linear pattern and updates remote
 * @param new_branch_name - The new branch name
 * @param current_branch - Current branch name
 * @returns Success boolean
 */
export const renameBranchToLinearPattern = (
     new_branch_name: string,
     current_branch: string,
): boolean => {
     try {
          consola.start(`Renaming branch to ${new_branch_name}...`);

          // Rename local branch
          execSync(`git branch -m ${new_branch_name}`);

          // Check if remote branch exists
          try {
               execSync(`git ls-remote --exit-code --heads origin ${current_branch}`, { stdio: "ignore" });
               // Remote exists, delete it and push new one
               execSync(`git push origin --delete ${current_branch}`);
               execSync(`git push -u origin ${new_branch_name}`);
          } catch {
               // Remote doesn't exist, just push new branch
               execSync(`git push -u origin ${new_branch_name}`);
          }

          consola.success("✅ Branch renamed and pushed successfully!");
          return true;
     } catch (error) {
          consola.error("Failed to rename branch:", error);
          return false;
     }
};
