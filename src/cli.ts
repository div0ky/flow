#!/usr/bin/env bun

/**
 * div-flow CLI
 * 
 * A CLI tool for managing git workflows with AI-powered commit messages and PR generation.
 * Requires Bun runtime.
 */

import { consola } from "consola";

import { handleConfigGet, handleConfigInit, handleConfigList, handleConfigSet } from "./commands/config";
import { getConfig } from "./config/config-manager";
import { clearTerminal, runCommandWithOutput } from "./utils/command";
import { ensureDevelopIsUpToDate, ensureRequiredBranches } from "./utils/setup";
import { getBranchType, getCurrentBranch, isGitRepository } from "./workflows/git";
import { commitWorkflow } from "./workflows/commit-workflow";
import { finishFeature, startFeature } from "./workflows/feature-workflow";
import { finishHotfix, startHotfix } from "./workflows/hotfix-workflow";
import { finishRelease, stageRelease, startRelease } from "./workflows/release-workflow";

// Track if we're exiting gracefully
let isExiting = false;

/**
 * Gracefully handle CTRL+C (SIGINT)
 */
function setupGracefulExit(): void {
     const handleExit = (signal: string) => {
          if (isExiting) {
               // Force exit if already exiting
               process.exit(1);
          }
          
          isExiting = true;
          console.log(""); // New line after ^C
          consola.warn(`\nProcess interrupted by user (${signal})`);
          consola.info("Exiting gracefully...");
          
          // Give a moment for cleanup, then exit
          setTimeout(() => {
               process.exit(0);
          }, 100);
     };

     // Handle SIGINT (CTRL+C)
     process.on("SIGINT", () => handleExit("SIGINT"));
     
     // Handle SIGTERM (for completeness)
     process.on("SIGTERM", () => handleExit("SIGTERM"));
     
     // Handle uncaught exceptions
     process.on("uncaughtException", (error) => {
          if (!isExiting) {
               consola.error("Uncaught exception:", error);
               process.exit(1);
          }
     });
     
     // Handle unhandled promise rejections
     process.on("unhandledRejection", (reason) => {
          if (!isExiting) {
               consola.error("Unhandled promise rejection:", reason);
               process.exit(1);
          }
     });
}

// Set up graceful exit handlers immediately
setupGracefulExit();

async function main(): Promise<void> {
     // Don't start if we're already exiting
     if (isExiting) {
          return;
     }

     const args = process.argv.slice(2);

     // If no arguments provided, show interactive menu
     if (args.length === 0) {
          clearTerminal();
          consola.start("Welcome to div-flow!");

          // Check if we're in a git repository
          if (!isGitRepository()) {
               consola.warn("Not in a git repository");
               const shouldInit = await consola.prompt("Would you like to initialize a git repository?", {
                    type: "confirm",
                    default: true,
               });

               if (shouldInit) {
                    clearTerminal();
                    const success = runCommandWithOutput("git init", "Initializing git repository...");
                    if (!success) {
                         process.exit(1);
                    }
                    
                    // Ask if they want to create an initial commit
                    const shouldCommit = await consola.prompt("Create an initial commit?", {
                         type: "confirm",
                         default: false,
                    });

                    if (shouldCommit) {
                         clearTerminal();
                         const addSuccess = runCommandWithOutput("git add .", "Staging files...");
                         if (addSuccess) {
                              const commitSuccess = runCommandWithOutput(
                                   'git commit -m "Initial commit"',
                                   "Creating initial commit...",
                              );
                              if (!commitSuccess) {
                                   consola.warn("No files to commit or commit cancelled");
                              }
                         }
                    }

                    // Ensure required branches exist
                    clearTerminal();
                    await ensureRequiredBranches();
                    
                    // Clear and show menu again after init
                    clearTerminal();
               } else {
                    consola.info("div-flow requires a git repository to work. Exiting.");
                    process.exit(0);
               }
          }

          // Ensure required branches exist (check on every launch)
          await ensureRequiredBranches();

          // Get current branch and determine context
          let currentBranch: string;
          let branchType: ReturnType<typeof getBranchType>;
          try {
               currentBranch = getCurrentBranch();
               branchType = getBranchType(currentBranch);
               consola.info(`Current branch: ${currentBranch} (${branchType})`);
          } catch {
               // Error getting branch (shouldn't happen if we just initialized)
               currentBranch = "unknown";
               branchType = "unknown";
               consola.warn("Unable to detect branch");
          }

          // Build menu options based on current branch context
          const menuOptions: Array<{ value: string; label: string }> = [
               { value: "commit", label: "Commit changes" },
          ];

          // Feature branch options
          if (branchType === "feature") {
               menuOptions.push({ value: "feature-finish", label: "Finish feature" });
          } else if (branchType === "main" || branchType === "develop") {
               menuOptions.push({ value: "feature-start", label: "Start feature" });
          }

          // Release branch options
          if (branchType === "release") {
               menuOptions.push({ value: "release-stage", label: "Stage release" });
               menuOptions.push({ value: "release-finish", label: "Finish release" });
          } else if (branchType === "main" || branchType === "develop") {
               menuOptions.push({ value: "release-start", label: "Start release" });
          }

          // Hotfix branch options
          if (branchType === "hotfix") {
               menuOptions.push({ value: "hotfix-finish", label: "Finish hotfix" });
          } else if (branchType === "main") {
               menuOptions.push({ value: "hotfix-start", label: "Start hotfix" });
          }

          // Configuration options
          menuOptions.push(
               { value: "config-init", label: "Configure div-flow" },
               { value: "config-list", label: "View configuration" },
               { value: "exit", label: "Exit" },
          );

          const action = await consola.prompt("What would you like to do?", {
               type: "select",
               options: menuOptions,
          });

          // Clear terminal before executing action
          clearTerminal();

          // Map interactive menu selections to command handlers
          switch (action) {
               case "commit":
                    await commitWorkflow();
                    break;
               case "feature-start":
                    await startFeature();
                    break;
               case "feature-finish": {
                    const config = await getConfig();
                    const ghToken = config.githubToken;
                    if (!ghToken) {
                         consola.error("GitHub token not configured. Run: div-flow config init");
                         process.exit(1);
                    }
                    await finishFeature(ghToken);
                    break;
               }
               case "release-start":
                    await startRelease();
                    break;
               case "release-stage":
                    await stageRelease();
                    break;
               case "release-finish": {
                    const config = await getConfig();
                    const ghToken = config.githubToken;
                    if (!ghToken) {
                         consola.error("GitHub token not configured. Run: div-flow config init");
                         process.exit(1);
                    }
                    await finishRelease(ghToken);
                    break;
               }
               case "hotfix-start":
                    await startHotfix();
                    break;
               case "hotfix-finish": {
                    const config = await getConfig();
                    const ghToken = config.githubToken;
                    if (!ghToken) {
                         consola.error("GitHub token not configured. Run: div-flow config init");
                         process.exit(1);
                    }
                    await finishHotfix(ghToken);
                    break;
               }
               case "config-init":
                    await handleConfigInit();
                    break;
               case "config-list":
                    await handleConfigList();
                    break;
               case "exit":
                    consola.info("Exiting div-flow. Goodbye!");
                    process.exit(0);
          }
          return;
     }

     const [command, ...rest] = args;

     try {
          switch (command) {
               case "config": {
                    const [subcommand, ...configArgs] = rest;
                    switch (subcommand) {
                         case "get":
                              if (configArgs.length === 0) {
                                   consola.error("Config key required");
                                   process.exit(1);
                              }
                              await handleConfigGet(configArgs[0] as string);
                              break;
                         case "set":
                              if (configArgs.length < 2) {
                                   consola.error("Config key and value required");
                                   process.exit(1);
                              }
                              await handleConfigSet(configArgs[0] as string, configArgs[1] as string);
                              break;
                         case "list":
                              await handleConfigList();
                              break;
                         case "init":
                              await handleConfigInit();
                              break;
                         default:
                              consola.error(`Unknown config command: ${subcommand}`);
                              process.exit(1);
                    }
                    break;
               }
               case "commit":
                    await commitWorkflow();
                    break;
               case "feature": {
                    const [subcommand] = rest;
                    switch (subcommand) {
                         case "start":
                              await startFeature();
                              break;
                         case "finish": {
                              const config = await getConfig();
                              const ghToken = config.githubToken;
                              if (!ghToken) {
                                   consola.error("GitHub token not configured. Run: div-flow config init");
                                   process.exit(1);
                              }
                              await finishFeature(ghToken);
                              break;
                         }
                         default:
                              consola.error(`Unknown feature command: ${subcommand}`);
                              consola.info("Use: div-flow feature start|finish");
                              process.exit(1);
                    }
                    break;
               }
               case "release": {
                    const [subcommand] = rest;
                    switch (subcommand) {
                         case "start":
                              await startRelease();
                              break;
                         case "stage":
                              await stageRelease();
                              break;
                         case "finish": {
                              const config = await getConfig();
                              const ghToken = config.githubToken;
                              if (!ghToken) {
                                   consola.error("GitHub token not configured. Run: div-flow config init");
                                   process.exit(1);
                              }
                              await finishRelease(ghToken);
                              break;
                         }
                         default:
                              consola.error(`Unknown release command: ${subcommand}`);
                              consola.info("Use: div-flow release start|stage|finish");
                              process.exit(1);
                    }
                    break;
               }
               case "hotfix": {
                    const [subcommand] = rest;
                    switch (subcommand) {
                         case "start":
                              await startHotfix();
                              break;
                         case "finish": {
                              const config = await getConfig();
                              const ghToken = config.githubToken;
                              if (!ghToken) {
                                   consola.error("GitHub token not configured. Run: div-flow config init");
                                   process.exit(1);
                              }
                              await finishHotfix(ghToken);
                              break;
                         }
                         default:
                              consola.error(`Unknown hotfix command: ${subcommand}`);
                              consola.info("Use: div-flow hotfix start|finish");
                              process.exit(1);
                    }
                    break;
               }
               default:
                    consola.error(`Unknown command: ${command}`);
                    process.exit(1);
          }
     }
     catch (error) {
          if (isExiting) {
               // Don't show error if we're already exiting gracefully
               return;
          }
          consola.error("An error occurred:", error);
          process.exit(1);
     }
}

main().catch((error) => {
     if (isExiting) {
          // Don't show error if we're already exiting gracefully
          return;
     }
     consola.error("An unexpected error occurred:", error);
     process.exit(1);
});

