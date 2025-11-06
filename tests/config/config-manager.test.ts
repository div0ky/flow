import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import * as configManager from "../../src/config/config-manager";
import type { Config } from "../../src/config/config";

describe("Config Manager", () => {
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

     describe("getConfig", () => {
          it("should read from local config file if it exists", async () => {
               const localConfig: Config = {
                    googleAiKey: "local-key",
                    githubToken: "local-token",
               };

               await Bun.write(".div-flow.json", JSON.stringify(localConfig));

               const config = await configManager.getConfig();
               expect(config.googleAiKey).toBe("local-key");
               expect(config.githubToken).toBe("local-token");
          });

          it("should read from global config if local doesn't exist", async () => {
               const globalConfig: Config = {
                    googleAiKey: "global-key",
               };

               const globalPath = join(homedir(), ".div-flow", "config.json");
               await Bun.$`mkdir -p ${join(homedir(), ".div-flow")}`.quiet();
               await Bun.write(globalPath, JSON.stringify(globalConfig));

               const config = await configManager.getConfig();
               expect(config.googleAiKey).toBe("global-key");

               // Cleanup
               await rm(join(homedir(), ".div-flow"), { recursive: true, force: true });
          });

          it("should fall back to environment variables", async () => {
               process.env.GOOGLE_AI_KEY = "env-key";
               process.env.GH_TOKEN = "env-token";

               const config = await configManager.getConfig();
               expect(config.googleAiKey).toBe("env-key");
               expect(config.githubToken).toBe("env-token");
          });

          it("should prioritize local config over global and env", async () => {
               const localConfig: Config = {
                    googleAiKey: "local-key",
               };
               await Bun.write(".div-flow.json", JSON.stringify(localConfig));

               process.env.GOOGLE_AI_KEY = "env-key";

               const config = await configManager.getConfig();
               expect(config.googleAiKey).toBe("local-key");
          });
     });

     describe("setConfigValue", () => {
          it("should set a config value in global config", async () => {
               await configManager.setConfigValue("googleAiKey", "test-key");

               const globalPath = join(homedir(), ".div-flow", "config.json");
               const file = Bun.file(globalPath);
               expect(await file.exists()).toBe(true);

               const content = await file.text();
               const config = JSON.parse(content);
               expect(config.googleAiKey).toBe("test-key");

               // Cleanup
               await rm(join(homedir(), ".div-flow"), { recursive: true, force: true });
          });

          it("should set boolean config values", async () => {
               await configManager.setConfigValue("linearEnabled", false);

               const globalPath = join(homedir(), ".div-flow", "config.json");
               const file = Bun.file(globalPath);
               const content = await file.text();
               const config = JSON.parse(content);
               expect(config.linearEnabled).toBe(false);

               // Cleanup
               await rm(join(homedir(), ".div-flow"), { recursive: true, force: true });
          });

          it("should update existing config without overwriting other values", async () => {
               const globalPath = join(homedir(), ".div-flow", "config.json");
               await Bun.$`mkdir -p ${join(homedir(), ".div-flow")}`.quiet();
               await Bun.write(
                    globalPath,
                    JSON.stringify({ googleAiKey: "existing-key", githubToken: "existing-token" }),
               );

               await configManager.setConfigValue("linearApiKey", "new-key");

               const file = Bun.file(globalPath);
               const content = await file.text();
               const config = JSON.parse(content);
               expect(config.googleAiKey).toBe("existing-key");
               expect(config.githubToken).toBe("existing-token");
               expect(config.linearApiKey).toBe("new-key");

               // Cleanup
               await rm(join(homedir(), ".div-flow"), { recursive: true, force: true });
          });
     });

     describe("setConfigValues", () => {
          it("should set multiple config values at once", async () => {
               await configManager.setConfigValues({
                    googleAiKey: "key1",
                    githubToken: "token1",
                    linearApiKey: "key2",
               });

               const globalPath = join(homedir(), ".div-flow", "config.json");
               const file = Bun.file(globalPath);
               const content = await file.text();
               const config = JSON.parse(content);

               expect(config.googleAiKey).toBe("key1");
               expect(config.githubToken).toBe("token1");
               expect(config.linearApiKey).toBe("key2");

               // Cleanup
               await rm(join(homedir(), ".div-flow"), { recursive: true, force: true });
          });
     });

     describe("getConfigValue", () => {
          it("should get a specific config value", async () => {
               await Bun.write(
                    ".div-flow.json",
                    JSON.stringify({ googleAiKey: "test-key", githubToken: "test-token" }),
               );

               const key = await configManager.getConfigValue("googleAiKey");
               expect(key).toBe("test-key");
          });

          it("should return undefined for missing key", async () => {
               await Bun.write(".div-flow.json", JSON.stringify({ googleAiKey: "test-key" }));

               const token = await configManager.getConfigValue("githubToken");
               expect(token).toBeUndefined();
          });
     });

     describe("getConfigFromEnv", () => {
          it("should parse LINEAR_ENABLED as boolean", async () => {
               process.env.LINEAR_ENABLED = "false";

               const config = await configManager.getConfig();
               expect(config.linearEnabled).toBe(false);
          });

          it("should parse LINEAR_ENABLED='true' as boolean true", async () => {
               process.env.LINEAR_ENABLED = "true";

               const config = await configManager.getConfig();
               expect(config.linearEnabled).toBe(true);
          });

          it("should parse LINEAR_ENABLED='1' as boolean true", async () => {
               process.env.LINEAR_ENABLED = "1";

               const config = await configManager.getConfig();
               expect(config.linearEnabled).toBe(true);
          });
     });

     describe("getConfigPath", () => {
          it("should return local config path if it exists", async () => {
               await Bun.write(".div-flow.json", JSON.stringify({}));

               const path = await configManager.getConfigPath();
               expect(path).toContain(".div-flow.json");
               expect(path).not.toContain(homedir());
          });

          it("should return global config path if local doesn't exist", async () => {
               const path = await configManager.getConfigPath();
               expect(path).toContain(homedir());
               expect(path).toContain(".div-flow");
          });
     });

     describe("setConfigValues with linearEnabled", () => {
          it("should set linearEnabled boolean value", async () => {
               await configManager.setConfigValues({
                    linearEnabled: false,
               });

               const globalPath = join(homedir(), ".div-flow", "config.json");
               const file = Bun.file(globalPath);
               const content = await file.text();
               const config = JSON.parse(content);

               expect(config.linearEnabled).toBe(false);

               // Cleanup
               await rm(join(homedir(), ".div-flow"), { recursive: true, force: true });
          });
     });
});

