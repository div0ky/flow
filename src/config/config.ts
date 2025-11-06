import { z } from "zod/v4";

/**
 * Configuration schema for div-flow
 */
export const configSchema = z.object({
     googleAiKey: z.string().optional(),
     githubToken: z.string().optional(),
     linearApiKey: z.string().optional(),
});

export type Config = z.infer<typeof configSchema>;

/**
 * Configuration keys that can be set
 */
export type ConfigKey = keyof Config;

/**
 * Valid configuration keys
 */
export const CONFIG_KEYS: ConfigKey[] = ["googleAiKey", "githubToken", "linearApiKey"];

/**
 * Environment variable to config key mapping
 */
export const ENV_TO_CONFIG: Record<string, ConfigKey> = {
     GOOGLE_AI_KEY: "googleAiKey",
     GH_TOKEN: "githubToken",
     GITHUB_TOKEN: "githubToken",
     LINEAR_API_KEY: "linearApiKey",
};

