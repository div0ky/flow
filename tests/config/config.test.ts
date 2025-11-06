import { describe, it, expect } from "bun:test";
import { REQUIRED_CONFIG_KEYS, CONFIG_KEYS, configSchema } from "../../src/config/config";

describe("Config Schema", () => {
     describe("REQUIRED_CONFIG_KEYS", () => {
          it("should contain googleAiKey and githubToken", () => {
               expect(REQUIRED_CONFIG_KEYS).toContain("googleAiKey");
               expect(REQUIRED_CONFIG_KEYS).toContain("githubToken");
          });

          it("should not contain linearApiKey or linearEnabled", () => {
               expect(REQUIRED_CONFIG_KEYS).not.toContain("linearApiKey");
               expect(REQUIRED_CONFIG_KEYS).not.toContain("linearEnabled");
          });
     });

     describe("CONFIG_KEYS", () => {
          it("should contain all config keys including linearEnabled", () => {
               expect(CONFIG_KEYS).toContain("googleAiKey");
               expect(CONFIG_KEYS).toContain("githubToken");
               expect(CONFIG_KEYS).toContain("linearApiKey");
               expect(CONFIG_KEYS).toContain("linearEnabled");
          });
     });

     describe("configSchema", () => {
          it("should validate config with linearEnabled boolean", () => {
               const validConfig = {
                    googleAiKey: "test-key",
                    githubToken: "test-token",
                    linearEnabled: true,
               };

               const result = configSchema.safeParse(validConfig);
               expect(result.success).toBe(true);
               if (result.success) {
                    expect(result.data.linearEnabled).toBe(true);
               }
          });

          it("should validate config with linearEnabled false", () => {
               const validConfig = {
                    googleAiKey: "test-key",
                    githubToken: "test-token",
                    linearEnabled: false,
               };

               const result = configSchema.safeParse(validConfig);
               expect(result.success).toBe(true);
               if (result.success) {
                    expect(result.data.linearEnabled).toBe(false);
               }
          });

          it("should default linearEnabled to true when not provided", () => {
               const configWithoutLinear = {
                    googleAiKey: "test-key",
                    githubToken: "test-token",
               };

               const result = configSchema.safeParse(configWithoutLinear);
               expect(result.success).toBe(true);
               if (result.success) {
                    expect(result.data.linearEnabled).toBe(true);
               }
          });

          it("should allow all optional fields to be missing", () => {
               const minimalConfig = {};

               const result = configSchema.safeParse(minimalConfig);
               expect(result.success).toBe(true);
          });
     });
});

