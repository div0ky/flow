import { execSync } from "child_process";

import { GoogleGenAI } from "@google/genai";
import { consola } from "consola";
import { z } from "zod/v4";

import { getConfig } from "../config/config-manager";
import { detectLinearIssue } from "./linear";

// Singleton GoogleGenAI instance
let aiInstance: GoogleGenAI | null = null;

const getAI = async (): Promise<GoogleGenAI> => {
     if (!aiInstance) {
          const config = await getConfig();
          const api_key = config.googleAiKey;
          if (!api_key) {
               throw new Error("Google AI key not configured. Run: dflow config init");
          }
          aiInstance = new GoogleGenAI({
               apiKey: api_key,
          });
     }
     return aiInstance;
};

export const commit_type = z.enum([
     "feat", "fix", "chore", "docs", "improve", "change", "hotfix",
]);

const commit_type_descriptions = {
     feat: "A new feature",
     fix: "A bug fix",
     chore: "Maintenance, refactoring, tooling",
     docs: "Documentation changes",
     improve: "Improvements to existing features",
     change: "Changes to existing functionality",
     hotfix: "Urgent fixes",
} as const;

const commit_message_schema = z.object({
     type: commit_type,
     scope: z.string().optional(),
     description: z.string().min(1),
});

const pr_content_schema = z.object({
     title: z.string().min(1).max(72),
     description: z.string().min(1),
     linear_comment: z.string().optional(),
});

const linear_content_schema = z.object({
     title: z.string().min(1).max(200),
     description: z.string().min(1),
     priority: z.number().min(0).max(4).default(3),
     estimate: z.number().min(0).max(6).optional(),
     suggested_label: z.enum(["Bug", "Feature", "Improvement", "Chore", "L10", "Research"]).optional(),
});

const linear_update_comment_schema = z.object({
     comment: z.string().min(1).max(500),
});

export type CommitMessage = z.infer<typeof commit_message_schema>;
export type PRContent = z.infer<typeof pr_content_schema>;
export type LinearContent = z.infer<typeof linear_content_schema>;
export type LinearUpdateComment = z.infer<typeof linear_update_comment_schema>;

// Helper function to parse git diff stats
const parseDiffStats = (diff_summary: string) => {
     const lines = diff_summary.trim().split("\n");
     const stats_line = lines[lines.length - 1];

     // Extract file count
     const file_match = stats_line.match(/(\d+) files? changed/);
     const file_count = file_match ? parseInt(file_match[1]) : 0;

     // Extract insertions and deletions
     const insertions_match = stats_line.match(/(\d+) insertions?/);
     const deletions_match = stats_line.match(/(\d+) deletions?/);
     const insertions = insertions_match ? parseInt(insertions_match[1]) : 0;
     const deletions = deletions_match ? parseInt(deletions_match[1]) : 0;

     return { file_count: file_count, insertions: insertions, deletions: deletions };
};

// Helper function to create animated progress with timer and thinking state
const createProgressAnimation = (message: string, show_thinking = false) => {
     const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
     let frame_index = 0;
     const start_time = Date.now();

     const interval = setInterval(() => {
          const elapsed = Math.floor((Date.now() - start_time) / 1000);
          const thinking_indicator = show_thinking ? " 🧠 thinking..." : "";
          process.stdout.write(`\r${frames[frame_index]} ${message} (${elapsed}s)${thinking_indicator}`);
          frame_index = (frame_index + 1) % frames.length;
     }, 100);

     return () => {
          clearInterval(interval);
          const final_elapsed = Math.floor((Date.now() - start_time) / 1000);
          process.stdout.write(`\r`);
          return final_elapsed;
     };
};

// Helper function to track thinking and buffer streaming content for better display
let thinking_count = 0;
let streaming_dots = 0;
const handleStreamingContent = (_content: string, is_thinking = false) => {
     if (is_thinking) {
          // Just count thinking occurrences, don't display content to reduce spam
          thinking_count++;
          if (thinking_count === 1) {
               process.stdout.write("🧠 AI is thinking...\n");
          }
     } else {
          // Instead of showing raw JSON, show progress dots
          streaming_dots++;
          if (streaming_dots % 10 === 0) {
               process.stdout.write(".");
          }
     }
};

/**
 * Generate a structured commit message. When a user description is provided, we bias heavily
 * toward the user's intent while still validating against the actual diff for accuracy.
 * This mirrors the PR flow where optional context improves AI output quality.
 */
export const generateCommitMessage = async (user_description?: string): Promise<CommitMessage | null> => {
     consola.start("Analyzing staged changes...");
     const diff_summary = execSync("git diff --cached --stat", { encoding: "utf-8" });
     const diff_content = execSync("git diff --cached", { encoding: "utf-8" });

     // Parse and display statistics
     const stats = parseDiffStats(diff_summary);
     consola.info(`📊 Changes: ${stats.file_count} files, +${stats.insertions} -${stats.deletions} lines`);

     // Estimate content size for progress indication
     const content_size = diff_content.length;
     const estimated_time = Math.max(2, Math.min(10, Math.ceil(content_size / 5000)));
     consola.info(`⏱️  Estimated processing time: ~${estimated_time}s`);

     const user_context = user_description && user_description.trim()
          ? `\n\nUser's description of changes (heavily prioritize this for intent):\n${user_description}`
          : "";

     const user_content = `Analyze this git diff and generate a structured commit message. Prefer the user's description for intent, and use the diff as grounding/context to ensure correctness.

Commit types with their meanings:
${Object.entries(commit_type_descriptions).map(([type, desc]) => `- ${type}: ${desc}`).join("\n")}

Summary of changes:
${diff_summary}

Detailed changes (first 2000 chars):
${diff_content.substring(0, 2000)}
${user_context}

Respond with JSON containing:
- type: one of [${Object.keys(commit_type_descriptions).join(", ")}]
- scope: optional scope without parentheses (e.g. "call-center", "auth", "ui")
- description: brief description (max 50 chars, must be a complete, succinct sentence or phrase, do not end with an incomplete word or conjunction, and do not cut off mid-word. If needed, rephrase to fit.)`;

     const OutputSchema = z.preprocess((data) => {
          if (typeof data === "string") {
               try {
                    return JSON.parse(data);
               }
               catch (e) {
                    consola.error("Failed to parse Gemini response string:", data, e);
                    throw new Error("Invalid JSON response from AI");
               }
          }
          return data;
     },
     commit_message_schema,
     );

     try {
          consola.start("Initializing AI service...");
          const ai = await getAI();

          consola.start("🤖 Generating commit message with AI...");
          const stop_animation = createProgressAnimation("Analyzing changes and generating structured commit message", true);

          // Try streaming first, with fallback to non-streaming
          try {
               thinking_count = 0; // Reset thinking counter for this operation
               streaming_dots = 0; // Reset streaming dots counter
               let accumulated_response = "";
               let is_thinking_phase = true;

               consola.info("📡 Streaming AI response...");

               const stream = await ai.models.generateContentStream({
                    config: {
                         responseMimeType: "application/json",
                         responseSchema: z.toJSONSchema(OutputSchema),
                         systemInstruction: [
                              "You are a helpful assistant that generates structured commit messages.",
                              "Heavily weight the user's description for intent; use the diff as factual context.",
                              "Choose the most appropriate type based on the changes.",
                              "Keep descriptions concise and clear.",
                              "If there is a clear scope/area of the codebase being changed, include it in the scope field (without parentheses).",
                              "The description should be just the action/change without scope or type prefix.",
                         ],
                         temperature: 0.3,
                         thinkingConfig: {
                              thinkingBudget: 1024,
                         },
                    },
                    contents: user_content,
                    model: "gemini-2.5-flash",
               });

               let final_elapsed = 0;
               for await (const chunk of stream) {
                    if (chunk.candidates?.[0]?.content?.parts) {
                         for (const part of chunk.candidates[0].content.parts) {
                              if (part.text) {
                                   // Display actual response content
                                   if (is_thinking_phase) {
                                        // First content, stop animation and switch to response phase
                                        is_thinking_phase = false;
                                        final_elapsed = stop_animation();
                                        process.stdout.write("\r\x1b[K💬 Generating response...\n");
                                   }
                                   accumulated_response += part.text;
                                   handleStreamingContent(part.text, false);
                              }
                         }
                    }
               }

               // If animation wasn't stopped during streaming, stop it now
               if (is_thinking_phase) {
                    final_elapsed = stop_animation();
               }
               process.stdout.write("\n");
               consola.info(`⏱️  Total processing time: ${final_elapsed}s`);
               if (thinking_count > 0) {
                    consola.info(`🧠 AI performed ${thinking_count} thinking operations`);
               }

               consola.start("Validating AI response...");
               const content = OutputSchema.parse(accumulated_response);

               consola.success(`✅ Generated commit`);
               return content;
          } catch (streaming_error) {
               // Fallback to non-streaming
               consola.warn("⚠️  Streaming failed, falling back to standard generation...");
               consola.error("Streaming error:", streaming_error);

               const gemini_result = await ai.models.generateContent({
                    config: {
                         responseMimeType: "application/json",
                         responseSchema: z.toJSONSchema(OutputSchema),
                         systemInstruction: [
                              "You are a helpful assistant that generates structured commit messages.",
                              "Heavily weight the user's description for intent; use the diff as factual context.",
                              "Choose the most appropriate type based on the changes.",
                              "Keep descriptions concise and clear.",
                              "If there is a clear scope/area of the codebase being changed, include it in the scope field (without parentheses).",
                              "The description should be just the action/change without scope or type prefix.",
                         ],
                         temperature: 0.3,
                         thinkingConfig: { thinkingBudget: 1024 },
                    },
                    contents: user_content,
                    model: "gemini-2.5-flash",
               });

               const final_elapsed = stop_animation();
               consola.info(`⏱️  Total processing time: ${final_elapsed}s`);

               consola.start("Validating AI response...");
               const response_text = gemini_result.text;
               const content = OutputSchema.parse(response_text);

               consola.success(`✅ Generated commit`);
               return content;
          }
     } catch (error) {
          consola.error("Failed to generate commit message:", error);
          return null;
     }
};

/**
 * Generate PR title and description focused strictly on WHAT changed.
 * We avoid explaining the WHY here to keep PR bodies concise and actionable.
 */
export const generatePRContent = async (current_branch: string, base_branch: string, user_description?: string): Promise<PRContent | null> => {
     consola.start("Analyzing branch changes...");
     const diff_summary = execSync(`git diff origin/${base_branch}..HEAD --stat`, { encoding: "utf-8" });
     const diff_content = execSync(`git diff origin/${base_branch}..HEAD`, { encoding: "utf-8" });
     const commit_messages = execSync(`git log origin/${base_branch}..HEAD --pretty=format:"- %s"`, { encoding: "utf-8" });
     const commit_count = execSync(`git rev-list --count origin/${base_branch}..HEAD`, { encoding: "utf-8" }).trim();

     // Parse and display statistics
     const stats = parseDiffStats(diff_summary);
     consola.info(`📊 PR Changes: ${commit_count} commits, ${stats.file_count} files, +${stats.insertions} -${stats.deletions} lines`);

     // Estimate content size for progress indication
     const content_size = diff_content.length + commit_messages.length;
     const estimated_time = Math.max(3, Math.min(15, Math.ceil(content_size / 3000)));
     consola.info(`⏱️  Estimated processing time: ~${estimated_time}s`);

     const user_context = user_description && user_description.trim() ? `\n\nUser's description of changes:\n${user_description}` : "";

     // Check if this branch follows Linear pattern for additional context
     const linear_issue_id = detectLinearIssue(current_branch);
     const linear_context = linear_issue_id
          ? `\n\nThis branch is linked to Linear issue ${linear_issue_id}. Please also generate a brief, first-person comment that I can add to the Linear issue (as if I'm commenting on my own issue). The comment should be concise and mention that I created a PR and what the key changes are.`
          : "";

     const user_content = `Based on the following changes, generate a concise PR title (MAXIMUM 70 characters - be conservative!) and a detailed PR description. Focus ONLY on WHAT changed. Do NOT explain the WHY. The description should include:
- A clear summary of what changed
- Key impacted areas/components/files
- Any user-visible changes or API surface changes
- Any migration steps or follow-ups required

Branch: ${current_branch}
Commits: ${commit_count}
Commit messages:
${commit_messages}${user_context}${linear_context}

Files changed summary:
${diff_summary}

Detailed changes (first 3000 chars):
${diff_content.substring(0, 3000)}

Format your response as JSON with 'title', 'description'${linear_issue_id ? ", and 'linear_comment'" : ""} fields. The description should use markdown formatting.

CRITICAL: The 'title' field must be 70 characters or fewer. Count each character carefully. If unsure, make it shorter.`;

     const OutputSchema = z.preprocess((data) => {
          if (typeof data === "string") {
               try {
                    return JSON.parse(data);
               }
               catch (e) {
                    consola.error("Failed to parse Gemini response string:", data, e);
                    throw new Error("Invalid JSON response from AI");
               }
          }
          return data;
     },
     pr_content_schema,
     );

     try {
          consola.start("Initializing AI service...");
          const ai = await getAI();

          consola.start("🤖 Generating PR content with AI...");
          const stop_animation = createProgressAnimation("Analyzing commits and generating PR title & description", true);

          // Try streaming first, with fallback to non-streaming
          try {
               thinking_count = 0; // Reset thinking counter for this operation
               streaming_dots = 0; // Reset streaming dots counter
               let accumulated_response = "";
               let is_thinking_phase = true;

               consola.info("📡 Streaming AI response...");

               const stream = await ai.models.generateContentStream({
                    config: {
                         responseMimeType: "application/json",
                         responseSchema: z.toJSONSchema(OutputSchema),
                         systemInstruction: [
                              "You are a helpful assistant that generates clear, informative pull request titles and descriptions.",
                              "Focus the PR description strictly on WHAT changed; do not explain WHY.",
                              "Use markdown in the description for better formatting.",
                              "CRITICAL: PR titles must be EXACTLY 72 characters or fewer. Count every character including spaces. If unsure, make it shorter. Use abbreviations like 'feat', 'fix', 'refactor' to save space.",
                              "Make descriptions informative and reviewer-friendly.",
                         ],
                         temperature: 0.3,
                         thinkingConfig: {
                              thinkingBudget: 4096,
                         },
                    },
                    contents: user_content,
                    model: "gemini-2.5-flash",
               });

               let final_elapsed = 0;
               for await (const chunk of stream) {
                    if (chunk.candidates?.[0]?.content?.parts) {
                         for (const part of chunk.candidates[0].content.parts) {
                              if (part.text) {
                                   // Display actual response content
                                   if (is_thinking_phase) {
                                        // First content, stop animation and switch to response phase
                                        is_thinking_phase = false;
                                        final_elapsed = stop_animation();
                                        process.stdout.write("\r\x1b[K💬 Generating response...\n");
                                   }
                                   accumulated_response += part.text;
                                   handleStreamingContent(part.text, false);
                              }
                         }
                    }
               }

               // If animation wasn't stopped during streaming, stop it now
               if (is_thinking_phase) {
                    final_elapsed = stop_animation();
               }
               process.stdout.write("\n");
               consola.info(`⏱️  Total processing time: ${final_elapsed}s`);
               if (thinking_count > 0) {
                    consola.info(`🧠 AI performed ${thinking_count} thinking operations`);
               }

               consola.start("Validating AI response...");
               let content: PRContent;
               try {
                    content = OutputSchema.parse(accumulated_response);
               } catch (validation_error) {
                    consola.error("❌ Validation failed - AI response doesn't match expected schema");

                    // Check if it's a title length issue
                    if (validation_error.message.includes("expected string to have < 72 characters")) {
                         consola.warn("Title too long - consider regenerating with stricter constraints");
                    }

                    throw new Error(`Response validation failed: ${validation_error.message}`);
               }

               consola.success(`✅ Generated PR`);
               return content;
          } catch (streaming_error) {
               // Fallback to non-streaming
               consola.warn("⚠️  Streaming failed, falling back to standard generation...");
               consola.error("Streaming error:", streaming_error);

               const gemini_result = await ai.models.generateContent({
                    config: {
                         responseMimeType: "application/json",
                         responseSchema: z.toJSONSchema(OutputSchema),
                         systemInstruction: [
                              "You are a helpful assistant that generates clear, informative pull request titles and descriptions.",
                              "Focus the PR description strictly on WHAT changed; do not explain WHY.",
                              "Use markdown in the description for better formatting.",
                              "CRITICAL: PR titles must be EXACTLY 72 characters or fewer. Count every character including spaces. If unsure, make it shorter. Use abbreviations like 'feat', 'fix', 'refactor' to save space.",
                              "Make descriptions informative and reviewer-friendly.",
                         ],
                         temperature: 0.3,
                         thinkingConfig: { thinkingBudget: 4096 },
                    },
                    contents: user_content,
                    model: "gemini-2.5-flash",
               });

               const final_elapsed = stop_animation();
               consola.info(`⏱️  Total processing time: ${final_elapsed}s`);

               consola.start("Validating AI response...");
               const response_text = gemini_result.text;
               const content = OutputSchema.parse(response_text);

               consola.success(`✅ Generated PR`);
               return content;
          }
     } catch (error) {
          consola.error("Failed to generate PR content:", error);
          return null;
     }
};

/**
 * Generate Linear issue title and description from git diff.
 * Focused on business-friendly language for project management context.
 */
export const generateLinearContent = async (user_description?: string): Promise<LinearContent | null> => {
     consola.start("Analyzing staged changes for Linear issue...");
     const diff_summary = execSync("git diff --cached --stat", { encoding: "utf-8" });
     const diff_content = execSync("git diff --cached", { encoding: "utf-8" });

     // Parse and display statistics
     const stats = parseDiffStats(diff_summary);
     consola.info(`📊 Changes: ${stats.file_count} files, +${stats.insertions} -${stats.deletions} lines`);

     // Estimate content size for progress indication
     const content_size = diff_content.length;
     const estimated_time = Math.max(2, Math.min(8, Math.ceil(content_size / 6000)));
     consola.info(`⏱️  Estimated processing time: ~${estimated_time}s`);

     const user_context = user_description && user_description.trim()
          ? `\n\nDeveloper's description of what this work accomplishes (HEAVILY PRIORITIZE THIS FOR THE TITLE AND DESCRIPTION):\n${user_description}`
          : "";

     const user_content = `Generate a Linear issue title, description, and metadata based on the developer's intent and code changes. PRIORITIZE the developer's description for understanding what this work is about.

${user_context}

Supporting technical context:
Summary of changes:
${diff_summary}

Detailed changes (first 2000 chars):
${diff_content.substring(0, 2000)}

Instructions:
- Use the developer's description as the PRIMARY source for the title and description
- Base the title directly on what the developer said they are doing
- Keep the description factual and concise - describe ONLY what was actually implemented based on the code changes
- Do not speculate about benefits, future impact, or business value beyond what's evident
- Do not add marketing language or ramble about productivity gains
- Stick to facts: what was built, what it does, based on the developer's input and code changes

For metadata analysis:
- Priority: Default to 3 (Medium) unless code indicates urgency (bugs, fixes, blocking issues = 2 High, critical bugs = 1 Urgent)
- Estimate: Analyze complexity and scope - 0=No estimate, 1=-, 2=XS, 3=S, 4=M, 5=L, 6=XL. Consider: lines changed, files affected, complexity of logic
- Label: Pick the single most appropriate from ["Bug", "Feature", "Improvement", "Chore", "L10", "Research"]:
  * Bug: fixes, error handling, debugging
  * Feature: new functionality, user-facing additions
  * Improvement: refactoring, optimization, enhancement to existing features
  * Chore: tooling, dependencies, maintenance, build system
  * L10: localization, internationalization
  * Research: investigation, exploration, proof of concept

Respond with JSON containing:
- title: Direct, factual title based on developer's description (max 200 chars)
- description: Concise, factual description of what was implemented (2-3 sentences max)
- priority: Number 0-4 (default 3 for Medium)
- estimate: Number 0-6 based on complexity analysis (optional)
- suggested_label: One of the specified labels (optional)`;

     const OutputSchema = z.preprocess((data) => {
          if (typeof data === "string") {
               try {
                    return JSON.parse(data);
               }
               catch (e) {
                    consola.error("Failed to parse Gemini response string:", data, e);
                    throw new Error("Invalid JSON response from AI");
               }
          }
          return data;
     },
     linear_content_schema,
     );

     try {
          consola.start("Initializing AI service...");
          const ai = await getAI();

          consola.start("🤖 Generating Linear issue content with AI...");
          const stop_animation = createProgressAnimation("Analyzing changes and generating Linear issue content", true);

          // Try streaming first, with fallback to non-streaming
          try {
               thinking_count = 0;
               streaming_dots = 0;
               let accumulated_response = "";
               let is_thinking_phase = true;

               consola.info("📡 Streaming AI response...");

               const stream = await ai.models.generateContentStream({
                    config: {
                         responseMimeType: "application/json",
                         responseSchema: z.toJSONSchema(OutputSchema),
                         systemInstruction: [
                              "You are a helpful assistant that generates factual Linear issue titles and descriptions.",
                              "Be concise and stick to facts based on the developer's input and code changes.",
                              "Do not speculate about business benefits or add marketing language.",
                              "Describe what was actually implemented, not potential future value.",
                              "Keep descriptions short and factual - no rambling dissertations.",
                         ],
                         temperature: 0.3,
                         thinkingConfig: {
                              thinkingBudget: 1024,
                         },
                    },
                    contents: user_content,
                    model: "gemini-2.5-flash",
               });

               let final_elapsed = 0;
               for await (const chunk of stream) {
                    if (chunk.candidates?.[0]?.content?.parts) {
                         for (const part of chunk.candidates[0].content.parts) {
                              if (part.text) {
                                   if (is_thinking_phase) {
                                        is_thinking_phase = false;
                                        final_elapsed = stop_animation();
                                        process.stdout.write("\r\x1b[K💬 Generating response...\n");
                                   }
                                   accumulated_response += part.text;
                                   handleStreamingContent(part.text, false);
                              }
                         }
                    }
               }

               if (is_thinking_phase) {
                    final_elapsed = stop_animation();
               }
               process.stdout.write("\n");
               consola.info(`⏱️  Total processing time: ${final_elapsed}s`);
               if (thinking_count > 0) {
                    consola.info(`🧠 AI performed ${thinking_count} thinking operations`);
               }

               consola.start("Validating AI response...");
               const content = OutputSchema.parse(accumulated_response);

               consola.success(`✅ Generated Linear issue content`);
               return content;
          } catch (streaming_error) {
               // Fallback to non-streaming
               consola.warn("⚠️  Streaming failed, falling back to standard generation...");
               consola.error("Streaming error:", streaming_error);

               const gemini_result = await ai.models.generateContent({
                    config: {
                         responseMimeType: "application/json",
                         responseSchema: z.toJSONSchema(OutputSchema),
                         systemInstruction: [
                              "You are a helpful assistant that generates factual Linear issue titles and descriptions.",
                              "Be concise and stick to facts based on the developer's input and code changes.",
                              "Do not speculate about business benefits or add marketing language.",
                              "Describe what was actually implemented, not potential future value.",
                              "Keep descriptions short and factual - no rambling dissertations.",
                         ],
                         temperature: 0.3,
                         thinkingConfig: { thinkingBudget: 5000 },
                    },
                    contents: user_content,
                    model: "gemini-2.5-flash",
               });

               const final_elapsed = stop_animation();
               consola.info(`⏱️  Total processing time: ${final_elapsed}s`);

               consola.start("Validating AI response...");
               const response_text = gemini_result.text;
               const content = OutputSchema.parse(response_text);

               consola.success(`✅ Generated Linear issue content`);
               return content;
          }
     } catch (error) {
          consola.error("Failed to generate Linear issue content:", error);
          return null;
     }
};

/**
 * Generates a user-friendly explanation of an error message
 * @param error_message - The raw error message from ESLint, TypeScript, or other tools
 * @returns User-friendly explanation or null if failed
 */
export const explainError = async (error_message: string): Promise<string | null> => {
     try {
          const ai = await getAI();

          const user_content = `You are helping a developer fix a pre-commit hook error. Analyze this error message and provide SPECIFIC, ACTIONABLE guidance.

Error message:
${error_message.substring(0, 2000)}

Provide a concise explanation (2-4 sentences max) that:
1. Identifies the SPECIFIC problem (e.g., "ESLint plugin bug in unified-signatures rule")
2. Explains WHY it's happening (e.g., "The plugin is trying to iterate over typeParameters.params which doesn't exist in this TypeScript version")
3. Gives EXACT steps to fix it (e.g., "Add '@typescript-eslint/unified-signatures: off' to your .eslintrc.js, or update @typescript-eslint/eslint-plugin to version X")

Be specific and actionable. Don't be generic. If it's a known bug, mention it. If there's a specific file/line, reference it.`;

          consola.start("🤖 Analyzing error with AI...");

          const result = await ai.models.generateContent({
               config: {
                    systemInstruction: [
                         "You are a helpful coding assistant that explains technical errors in plain language.",
                         "Focus on clarity and actionable solutions.",
                         "Be concise but thorough.",
                         "If the error is from ESLint, TypeScript, or other linting tools, explain what rule was violated and how to fix it.",
                    ],
                    temperature: 0.2,
                    maxOutputTokens: 800,
               },
               contents: user_content,
               model: "gemini-2.5-flash",
          });

          // Extract text from response - handle different response structures
          let explanation = "";
          
          // Try direct text property first
          if (result.text) {
               explanation = result.text;
          } 
          // Try candidates structure (like streaming responses)
          else if (result.candidates?.[0]?.content?.parts) {
               const parts = result.candidates[0].content.parts;
               for (const part of parts) {
                    if (part.text) {
                         explanation += part.text;
                    }
               }
          }
          // Try response property
          else if ((result as any).response?.text) {
               explanation = (result as any).response.text;
          }
          // If it's already a string
          else if (typeof result === "string") {
               explanation = result;
          }

          return explanation.trim() || null;
     } catch (error) {
          // Silently fail - don't show error details to user
          return null;
     }
};
export const generateLinearUpdateComment = async (
     _current_branch: string,
     _base_branch: string,
     user_description?: string,
): Promise<string | null> => {
     try {
          consola.start("Analyzing recent PR changes...");

          // Get recent commits (last 3) to focus on what just changed
          const recent_commits = execSync(`git log -3 --pretty=format:"- %s" HEAD`, { encoding: "utf-8" });
          const recent_diff = execSync(`git diff HEAD~3..HEAD --stat`, { encoding: "utf-8" });

          const user_context = user_description && user_description.trim()
               ? `\n\nUser's description of this update:\n${user_description}`
               : "";

          const user_content = `Based on the recent changes to this PR, generate a brief, casual first-person comment that I can add to a Linear issue. The comment should:
- Sound natural and conversational (like I'm updating teammates)
- Focus ONLY on what changed recently (not the entire PR)
- Be concise (1-2 sentences max)
- Use first person ("I updated...", "I fixed...", "I added...")
- NOT include links or automation disclaimers (those will be added separately)

Recent commits on this branch:
${recent_commits}${user_context}

Recent changes summary:
${recent_diff}

Generate ONLY the comment text, nothing else. Make it sound like a natural update from a developer.`;

          const OutputSchema = z.preprocess((data) => {
               if (typeof data === "string") {
                    try {
                         return JSON.parse(data);
                    } catch {
                         // If it's not JSON, treat it as plain text
                         return { comment: data.trim() };
                    }
               }
               return data;
          }, linear_update_comment_schema);

          consola.start("🤖 Generating Linear update comment...");
          const ai = getAI();

          const gemini_result = await ai.models.generateContent({
               config: {
                    responseMimeType: "application/json",
                    responseSchema: z.toJSONSchema(OutputSchema),
                    systemInstruction: [
                         "Generate brief, natural-sounding first-person comments for Linear issues.",
                         "Focus on recent changes only, not the entire PR history.",
                         "Sound casual and conversational like a teammate update.",
                         "Be concise - 1-2 sentences maximum.",
                         "Use action words: updated, fixed, added, improved, etc.",
                    ],
                    temperature: 0.4,
               },
               contents: user_content,
               model: "gemini-2.5-flash",
          });

          const response_text = gemini_result.text;
          const parsed = OutputSchema.parse(response_text);
          const comment = parsed.comment;

          consola.success("✅ Generated Linear update comment");
          return comment;
     } catch (error) {
          consola.error("Failed to generate Linear update comment:", error);
          return null;
     }
};
