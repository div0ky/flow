import { consola } from "consola";

import { runCommandCapture, runCommandSilent, runCommandWithOutput } from "./command";
import { branchExists, branchExistsLocal, branchExistsRemote, isDevelopBehindMain } from "../workflows/git";

/**
 * Ensure required branches exist (main, develop, staging)
 * Offers to create them if they don't exist
 */
export async function ensureRequiredBranches(): Promise<void> {
     const requiredBranches = ["main", "develop", "staging"];
     const missingBranches: string[] = [];

     // Check which branches are missing (only check locally - we'll create them locally)
     for (const branch of requiredBranches) {
          if (!branchExistsLocal(branch)) {
               missingBranches.push(branch);
          }
     }

     if (missingBranches.length === 0) {
          return; // All branches exist
     }

     consola.warn(`Missing required branches: ${missingBranches.join(", ")}`);
     const shouldCreate = await consola.prompt("Would you like to create the missing branches?", {
          type: "confirm",
          default: true,
     });

    if (!shouldCreate) {
         consola.error("flow requires main, develop, and staging branches to work properly.");
         consola.info("Please create these branches manually or run dflow again and accept the branch creation prompt.");
         process.exit(1);
    }

     // Get current branch to return to it later
     const currentBranchOutput = runCommandCapture("git branch --show-current");
     const currentBranch = currentBranchOutput || "main";

     // Check if we have any commits
     const hasCommits = runCommandSilent("git rev-parse --verify HEAD");

     if (!hasCommits) {
          consola.warn("No commits found. Branches can only be created after at least one commit.");
          consola.info("Please create an initial commit first, then run dflow again.");
          return;
     }

     // Create missing branches
     for (const branch of missingBranches) {
          if (branch === "main") {
               // Main should be created from current branch
               if (!branchExistsLocal("main")) {
                    runCommandWithOutput(`git checkout -b main`, `Creating main branch...`);
                    // If there's a remote main, track it (with timeout to avoid hanging)
                    try {
                         if (branchExistsRemote("main")) {
                              runCommandWithOutput(`git branch --set-upstream-to=origin/main main`, "Setting upstream...");
                         }
                    } catch {
                         // Ignore remote check failures - branch will be created locally
                    }
               }
          } else if (branch === "develop") {
               // Develop should be created from main
               if (!branchExistsLocal("develop")) {
                    if (branchExistsLocal("main")) {
                         runCommandWithOutput(`git checkout main`, "Switching to main...");
                         runCommandWithOutput(`git checkout -b develop`, `Creating develop branch...`);
                    } else {
                         // If main doesn't exist locally, create develop from current
                         runCommandWithOutput(`git checkout -b develop`, `Creating develop branch...`);
                    }
                    // If there's a remote develop, track it (with timeout to avoid hanging)
                    try {
                         if (branchExistsRemote("develop")) {
                              runCommandWithOutput(`git branch --set-upstream-to=origin/develop develop`, "Setting upstream...");
                         }
                    } catch {
                         // Ignore remote check failures - branch will be created locally
                    }
               }
          } else if (branch === "staging") {
               // Staging should be created from develop
               if (!branchExistsLocal("staging")) {
                    if (branchExistsLocal("develop")) {
                         runCommandWithOutput(`git checkout develop`, "Switching to develop...");
                         runCommandWithOutput(`git checkout -b staging`, `Creating staging branch...`);
                    } else if (branchExistsLocal("main")) {
                         runCommandWithOutput(`git checkout main`, "Switching to main...");
                         runCommandWithOutput(`git checkout -b staging`, `Creating staging branch...`);
                    } else {
                         runCommandWithOutput(`git checkout -b staging`, `Creating staging branch...`);
                    }
                    // If there's a remote staging, track it (with timeout to avoid hanging)
                    try {
                         if (branchExistsRemote("staging")) {
                              runCommandWithOutput(`git branch --set-upstream-to=origin/staging staging`, "Setting upstream...");
                         }
                    } catch {
                         // Ignore remote check failures - branch will be created locally
                    }
               }
          }
     }

     // Return to original branch
     if (currentBranch && branchExistsLocal(currentBranch)) {
          runCommandWithOutput(`git checkout ${currentBranch}`, `Returning to ${currentBranch}...`);
     } else {
          // If original branch doesn't exist, go to main or develop
          if (branchExistsLocal("main")) {
               runCommandWithOutput(`git checkout main`, "Switching to main...");
          } else if (branchExistsLocal("develop")) {
               runCommandWithOutput(`git checkout develop`, "Switching to develop...");
          }
     }

     consola.success("Required branches created!");
}

/**
 * Check if develop is behind main and offer to catch it up
 */
export async function ensureDevelopIsUpToDate(): Promise<boolean> {
     // Only check if both branches exist
     if (!branchExists("main") || !branchExists("develop")) {
          return true; // Skip check if branches don't exist
     }

     const behind = isDevelopBehindMain();
     
     if (behind === null) {
          // Can't determine, skip check
          return true;
     }

     if (behind === 0) {
          // Develop is up to date
          return true;
     }

     consola.warn(`Develop is ${behind} commit(s) behind main`);
     const shouldCatchUp = await consola.prompt("Would you like to update develop with the latest from main?", {
          type: "confirm",
          default: true,
     });

     if (!shouldCatchUp) {
          consola.info("Skipping develop update. You may want to update it later.");
          return false;
     }

     const currentBranchOutput = runCommandCapture("git branch --show-current");
     const currentBranch = currentBranchOutput || "main";
     
     // Switch to develop and merge main
     runCommandWithOutput("git checkout develop", "Switching to develop...");
     runCommandWithOutput("git fetch origin main", "Fetching latest main...");
     runCommandWithOutput("git merge origin/main", "Merging main into develop...");
     
     // Return to original branch
     if (currentBranch && branchExistsLocal(currentBranch)) {
          runCommandWithOutput(`git checkout ${currentBranch}`, `Returning to ${currentBranch}...`);
     }

     consola.success("Develop is now up to date with main!");
     return true;
}

