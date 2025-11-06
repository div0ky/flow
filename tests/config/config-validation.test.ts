import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import * as configValidation from "../../src/config/config-validation";
import * as configManager from "../../src/config/config-manager";
import type { Config } from "../../src/config/config";

describe("Config Validation", () => {
     let testDir: string;
     let originalCwd: string;
     let originalEnv: NodeJS.ProcessEnv;

     beforeEach(async () => {
          originalCwd = process.cwd();
          originalEnv = { ...process.env };
          testDir = await mkdtemp(join("/tmp", "div-flow-test-"));
          process.chdir(testDir);
     });

     afterEach(async () => {
          process.chdir(originalCwd);
          process.env = originalEnv;
          await rm(testDir, { recursive: true, force: true });
     });

     describe("validateRequiredConfig", () => {
          it("should return true when all required config is set", async () => {
               await configManager.setConfigValues({
                    googleAiKey: "test-ai-key",
                    githubToken: "test-github-token",
               });

               const isValid = await configValidation.validateRequiredConfig();
               expect(isValid).toBe(true);

               // Cleanup
               await rm(join(homedir(), ".div-flow"), { recursive: true, force: true });
          });

          it("should return false when googleAiKey is missing", async () => {
               await configManager.setConfigValues({
                    githubToken: "test-github-token",
               });

               const isValid = await configValidation.validateRequiredConfig();
               expect(isValid).toBe(false);

               // Cleanup
               await rm(join(homedir(), ".div-flow"), { recursive: true, force: true });
          });

          it("should return false when githubToken is missing", async () => {
               await configManager.setConfigValues({
                    googleAiKey: "test-ai-key",
               });

               const isValid = await configValidation.validateRequiredConfig();
               expect(isValid).toBe(false);

               // Cleanup
               await rm(join(homedir(), ".div-flow"), { recursive: true, force: true });
          });

          it("should return false when both required keys are missing", async () => {
               // Clear environment variables
               delete process.env.GOOGLE_AI_KEY;
               delete process.env.GH_TOKEN;
               delete process.env.GITHUB_TOKEN;

               // Clear config files
               const globalPath = join(homedir(), ".div-flow", "config.json");
               try {
                    await rm(globalPath, { force: true });
               } catch {
                    // File might not exist, ignore
               }

               const isValid = await configValidation.validateRequiredConfig();
               expect(isValid).toBe(false);
          });

          it("should return false when config values are empty strings", async () => {
               await configManager.setConfigValues({
                    googleAiKey: "",
                    githubToken: "   ",
               });

               const isValid = await configValidation.validateRequiredConfig();
               expect(isValid).toBe(false);

               // Cleanup
               await rm(join(homedir(), ".div-flow"), { recursive: true, force: true });
          });

          it("should check environment variables as fallback", async () => {
               process.env.GOOGLE_AI_KEY = "env-ai-key";
               process.env.GH_TOKEN = "env-github-token";

               const isValid = await configValidation.validateRequiredConfig();
               expect(isValid).toBe(true);
          });
     });

     describe("getMissingConfigKeys", () => {
          it("should return empty array when all required config is set", async () => {
               await configManager.setConfigValues({
                    googleAiKey: "test-ai-key",
                    githubToken: "test-github-token",
               });

               const missing = await configValidation.getMissingConfigKeys();
               expect(missing).toEqual([]);

               // Cleanup
               await rm(join(homedir(), ".div-flow"), { recursive: true, force: true });
          });

          it("should return missing keys when config is incomplete", async () => {
               await configManager.setConfigValues({
                    googleAiKey: "test-ai-key",
               });

               const missing = await configValidation.getMissingConfigKeys();
               expect(missing).toContain("githubToken");
               expect(missing).not.toContain("googleAiKey");

               // Cleanup
               await rm(join(homedir(), ".div-flow"), { recursive: true, force: true });
          });

          it("should return all required keys when none are set", async () => {
               // Clear environment variables that might be set
               delete process.env.GOOGLE_AI_KEY;
               delete process.env.GH_TOKEN;
               delete process.env.GITHUB_TOKEN;

               // Clear any config files
               const globalPath = join(homedir(), ".div-flow", "config.json");
               try {
                    await rm(globalPath, { force: true });
               } catch {
                    // File might not exist, ignore
               }
               try {
                    await rm(".div-flow.json", { force: true });
               } catch {
                    // File might not exist, ignore
               }

               const missing = await configValidation.getMissingConfigKeys();
               expect(missing).toContain("googleAiKey");
               expect(missing).toContain("githubToken");
          });
     });

     describe("isLinearEnabled", () => {
          it("should return true by default when not set", async () => {
               // Clear any existing config
               const globalPath = join(homedir(), ".div-flow", "config.json");
               try {
                    await rm(globalPath, { force: true });
               } catch {
                    // File might not exist, ignore
               }

               const enabled = await configValidation.isLinearEnabled();
               expect(enabled).toBe(true);
          });

          it("should return true when explicitly set to true", async () => {
               await configManager.setConfigValues({
                    linearEnabled: true,
               });

               const enabled = await configValidation.isLinearEnabled();
               expect(enabled).toBe(true);

               // Cleanup
               await rm(join(homedir(), ".div-flow"), { recursive: true, force: true });
          });

          it("should return false when explicitly set to false", async () => {
               await configManager.setConfigValues({
                    linearEnabled: false,
               });

               const enabled = await configValidation.isLinearEnabled();
               expect(enabled).toBe(false);

               // Cleanup
               await rm(join(homedir(), ".div-flow"), { recursive: true, force: true });
          });

          it("should read from environment variable", async () => {
               process.env.LINEAR_ENABLED = "false";

               const enabled = await configValidation.isLinearEnabled();
               expect(enabled).toBe(false);
          });

          it("should handle environment variable as '1' for true", async () => {
               process.env.LINEAR_ENABLED = "1";

               const enabled = await configValidation.isLinearEnabled();
               expect(enabled).toBe(true);
          });
     });
});

