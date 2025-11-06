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
          if (value !== undefined && value !== null) {
               if (key === "linearEnabled") {
                    // Show boolean as true/false
                    console.log(`  ${key}: ${value ? "true" : "false"}`);
               } else if (typeof value === "string" && value.length > 0) {
                    // Mask sensitive values (show first 4 and last 4 chars)
                    const masked = value.length > 8
                         ? `${value.substring(0, 4)}${"*".repeat(value.length - 8)}${value.substring(value.length - 4)}`
                         : "****";
                    console.log(`  ${key}: ${masked}`);
               } else {
                    console.log(`  ${key}: (not set)`);
               }
          } else {
               console.log(`  ${key}: (not set)`);
          }
     }
}

/**
 * Interactive configuration modification menu
 * Allows users to select which config value to modify
 */
export async function handleConfigModify(): Promise<void> {
     consola.start("Configure flow");

     const configOptions = [
          { value: "googleAiKey", label: "Google AI API Key" },
          { value: "githubToken", label: "GitHub Token" },
          { value: "linearApiKey", label: "Linear API Key" },
          { value: "linearEnabled", label: "Enable/Disable Linear Integration" },
          { value: "back", label: "Back to main menu" },
     ];

     const selected = await consola.prompt("What would you like to configure?", {
          type: "select",
          options: configOptions,
     });

     if (selected === "back") {
          return;
     }

     if (selected === "linearEnabled") {
          // Toggle Linear enabled/disabled
          const currentConfig = await listConfig();
          const currentValue = currentConfig.linearEnabled !== false; // Default to true
          
          const newValue = await consola.prompt(`Linear integration is currently ${currentValue ? "enabled" : "disabled"}. Enable Linear integration?`, {
               type: "confirm",
               default: !currentValue, // Toggle the current value
          });

          await setConfigValue("linearEnabled", newValue);
          consola.success(`Linear integration ${newValue ? "enabled" : "disabled"}`);
     } else {
          // For string values, prompt for new value
          const currentConfig = await listConfig();
          const currentValue = currentConfig[selected as ConfigKey];
          
          let promptMessage = `Enter new value for ${selected}:`;
          if (currentValue && typeof currentValue === "string") {
               // Show masked current value
               const masked = currentValue.length > 8
                    ? `${currentValue.substring(0, 4)}${"*".repeat(currentValue.length - 8)}${currentValue.substring(currentValue.length - 4)}`
                    : "****";
               promptMessage = `Enter new value for ${selected} (current: ${masked}):`;
          }

          const newValue = await consola.prompt(promptMessage, {
               type: "text",
               default: "",
               required: true,
          });

          if (newValue && newValue.trim()) {
               await setConfigValue(selected as ConfigKey, newValue.trim());
               consola.success(`Updated ${selected} successfully`);
          } else {
               consola.warn("No value provided. Configuration not changed.");
          }
     }

     // Show updated config
     await handleConfigList();
}

/**
 * Interactive configuration setup wizard
 */
export async function handleConfigInit(): Promise<void> {
     consola.start("Setting up flow configuration...");

     const config: Partial<Record<ConfigKey, string | boolean>> = {};

     // Google AI Key (required)
     const googleAiKey = await consola.prompt("Enter your Google AI API key (required):", {
          type: "text",
          default: "",
          required: true,
     });
     if (googleAiKey && googleAiKey.trim()) {
          config.googleAiKey = googleAiKey.trim();
     } else {
          consola.error("Google AI API key is required!");
          process.exit(1);
     }

     // GitHub Token (required)
     const githubToken = await consola.prompt("Enter your GitHub token (required):", {
          type: "text",
          default: "",
          required: true,
     });
     if (githubToken && githubToken.trim()) {
          config.githubToken = githubToken.trim();
     } else {
          consola.error("GitHub token is required!");
          process.exit(1);
     }

     // Linear enable/disable
     const enableLinear = await consola.prompt("Enable Linear integration?", {
          type: "confirm",
          default: true,
     });
     config.linearEnabled = enableLinear;

     // Linear API Key (only if enabled)
     if (enableLinear) {
          const linearApiKey = await consola.prompt("Enter your Linear API key (optional):", {
               type: "text",
               default: "",
               required: false,
          });
          if (linearApiKey && linearApiKey.trim()) {
               config.linearApiKey = linearApiKey.trim();
          }
     }

     // Set all values
     for (const [key, value] of Object.entries(config)) {
          await setConfigValue(key as ConfigKey, value as string | boolean);
     }

     consola.success("Configuration saved successfully!");
     await handleConfigList();
}

