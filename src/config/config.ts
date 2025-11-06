import { z } from "zod/v4";

/**
 * Configuration schema for flow
 */
export const configSchema = z.object({
     googleAiKey: z.string().optional(),
     githubToken: z.string().optional(),
     linearApiKey: z.string().optional(),
     linearEnabled: z.boolean().optional().default(true),
});

export type Config = z.infer<typeof configSchema>;

/**
 * Configuration keys that can be set
 */
export type ConfigKey = keyof Config;

/**
 * Valid configuration keys
 */
export const CONFIG_KEYS: ConfigKey[] = ["googleAiKey", "githubToken", "linearApiKey", "linearEnabled"];

/**
 * Required configuration keys for the CLI to function
 */
export const REQUIRED_CONFIG_KEYS: ConfigKey[] = ["googleAiKey", "githubToken"];

/**
 * Environment variable to config key mapping
 */
export const ENV_TO_CONFIG: Record<string, ConfigKey> = {
     GOOGLE_AI_KEY: "googleAiKey",
     GH_TOKEN: "githubToken",
     GITHUB_TOKEN: "githubToken",
     LINEAR_API_KEY: "linearApiKey",
     LINEAR_ENABLED: "linearEnabled",
};

