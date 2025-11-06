import { execSync, ExecSyncOptions } from "child_process";

import { consola } from "consola";

/**
 * Clear the terminal screen
 */
export function clearTerminal(): void {
     // Clear screen and move cursor to top
     process.stdout.write("\x1b[2J\x1b[H");
}

/**
 * Clear the last N lines from terminal
 * @param lines - Number of lines to clear
 */
export function clearLines(lines: number): void {
     for (let i = 0; i < lines; i++) {
          // Move cursor up one line and clear it
          process.stdout.write("\x1b[1A\x1b[K");
     }
}

/**
 * Execute a command silently (suppresses all output)
 * @param command - Command to execute
 * @param options - Additional exec options
 * @returns true if successful, false if failed
 */
export function runCommandSilent(command: string, options?: ExecSyncOptions): boolean {
     try {
          execSync(command, {
               ...options,
               stdio: "ignore",
          });
          return true;
     } catch {
          return false;
     }
}

/**
 * Execute a command and capture its output
 * @param command - Command to execute
 * @param options - Additional exec options
 * @returns Command output as string, or null if failed
 */
export function runCommandCapture(command: string, options?: ExecSyncOptions): string | null {
     try {
          const output = execSync(command, {
               encoding: "utf-8",
               ...options,
               stdio: ["ignore", "pipe", "pipe"], // stdin: ignore, stdout: capture, stderr: capture
          });
          return typeof output === "string" ? output.trim() : output.toString().trim();
     } catch {
          return null;
     }
}

/**
 * Execute a command with controlled output
 * Shows a spinner with the message, suppresses command output, then shows success/error
 * @param command - Command to execute
 * @param message - Message to show (will show as spinner, then success message)
 * @param options - Additional exec options
 * @returns true if successful, false if failed
 */
export function runCommandWithOutput(
     command: string,
     message: string,
     options?: ExecSyncOptions,
): boolean {
     try {
          consola.start(message);
          execSync(command, {
               ...options,
               stdio: ["ignore", "pipe", "pipe"], // Capture output but don't show it
          });
          // Clean up message for success (remove trailing dots/ellipsis)
          const successMessage = message.replace(/\.\.\.$/, "").replace(/\.\.\.\s*$/, "").trim();
          consola.success(successMessage || message);
          return true;
     } catch (error) {
          // Clean up message for error
          const errorMessage = message.replace(/\.\.\.$/, "").replace(/\.\.\.\s*$/, "").trim();
          consola.error(`Failed: ${errorMessage || message}`);
          return false;
     }
}

/**
 * Execute a command with visible output (for user-facing commands)
 * Shows a message before execution, then shows the actual command output
 * @param command - Command to execute
 * @param message - Message to show before execution
 * @param options - Additional exec options
 * @returns true if successful, false if failed
 */
export function runCommandVisible(
     command: string,
     message: string,
     options?: ExecSyncOptions,
): boolean {
     try {
          if (message) {
               consola.start(message);
          }
          execSync(command, {
               ...options,
               stdio: "inherit", // Show all output
          });
          if (message) {
               consola.success(message.replace("...", ""));
          }
          return true;
     } catch (error) {
          if (message) {
               consola.error(`Failed: ${message.replace("...", "")}`);
          }
          return false;
     }
}

/**
 * Execute a command and capture output, with error handling
 * @param command - Command to execute
 * @param errorMessage - Error message to show if command fails
 * @param options - Additional exec options
 * @returns Command output as string
 * @throws Error if command fails
 */
export function runCommandCaptureOrThrow(
     command: string,
     errorMessage: string,
     options?: ExecSyncOptions,
): string {
     try {
          const output = execSync(command, {
               encoding: "utf-8",
               ...options,
               stdio: ["ignore", "pipe", "pipe"],
          });
          return typeof output === "string" ? output.trim() : output.toString().trim();
     } catch (error) {
          consola.error(errorMessage);
          throw new Error(errorMessage);
     }
}

