import { consola } from "consola";

import type { ConfigKey } from "../config/config";
import { CONFIG_KEYS } from "../config/config";
import { getConfigValue, listConfig, setConfigValue } from "../config/config-manager";

/**
 * Get a configuration value
 */
export async function handleConfigGet(key: string): Promise<void> {
     if (!CONFIG_KEYS.includes(key as ConfigKey)) {
          consola.error(`Invalid config key: ${key}`);
          consola.info(`Valid keys: ${CONFIG_KEYS.join(", ")}`);
          process.exit(1);
     }

     const value = await getConfigValue(key as ConfigKey);
     if (value) {
          console.log(value);
     } else {
          consola.warn(`Config key "${key}" is not set`);
          process.exit(1);
     }
}

/**
 * Set a configuration value
 */
export async function handleConfigSet(key: string, value: string): Promise<void> {
     if (!CONFIG_KEYS.includes(key as ConfigKey)) {
          consola.error(`Invalid config key: ${key}`);
          consola.info(`Valid keys: ${CONFIG_KEYS.join(", ")}`);
          process.exit(1);
     }

     await setConfigValue(key as ConfigKey, value);
     consola.success(`Set ${key} successfully`);
}

/**
 * List all configuration values (masking sensitive values)
 */
export async function handleConfigList(): Promise<void> {
     const config = await listConfig();

     consola.box("Configuration");

     for (const key of CONFIG_KEYS) {
          const value = config[key];
          if (value) {
               // Mask sensitive values (show first 4 and last 4 chars)
               const masked = value.length > 8
                    ? `${value.substring(0, 4)}${"*".repeat(value.length - 8)}${value.substring(value.length - 4)}`
                    : "****";
               console.log(`  ${key}: ${masked}`);
          } else {
               console.log(`  ${key}: (not set)`);
          }
     }
}

/**
 * Interactive configuration setup wizard
 */
export async function handleConfigInit(): Promise<void> {
     consola.start("Setting up div-flow configuration...");

     const config: Partial<Record<ConfigKey, string>> = {};

     // Google AI Key
     const googleAiKey = await consola.prompt("Enter your Google AI API key (optional):", {
          type: "text",
          default: "",
          required: false,
     });
     if (googleAiKey) {
          config.googleAiKey = googleAiKey;
     }

     // GitHub Token
     const githubToken = await consola.prompt("Enter your GitHub token (optional):", {
          type: "text",
          default: "",
          required: false,
     });
     if (githubToken) {
          config.githubToken = githubToken;
     }

     // Linear API Key
     const linearApiKey = await consola.prompt("Enter your Linear API key (optional):", {
          type: "text",
          default: "",
          required: false,
     });
     if (linearApiKey) {
          config.linearApiKey = linearApiKey;
     }

     if (Object.keys(config).length === 0) {
          consola.warn("No configuration values provided");
          return;
     }

     // Set all values
     for (const [key, value] of Object.entries(config)) {
          await setConfigValue(key as ConfigKey, value);
     }

     consola.success("Configuration saved successfully!");
     await handleConfigList();
}

