import { consola } from "consola";

import { REQUIRED_CONFIG_KEYS, type Config, type ConfigKey } from "./config";
import { getConfig } from "./config-manager";

/**
 * Validate that required configuration is set
 * @returns true if all required config is set, false otherwise
 */
export async function validateRequiredConfig(): Promise<boolean> {
     const config = await getConfig();
     const missing: string[] = [];

     for (const key of REQUIRED_CONFIG_KEYS) {
          const value = config[key];
          if (!value || (typeof value === "string" && value.trim() === "")) {
               missing.push(key);
          }
     }

     if (missing.length > 0) {
          return false;
     }

     return true;
}

/**
 * Get missing required config keys
 * @returns Array of missing config key names
 */
export async function getMissingConfigKeys(): Promise<string[]> {
     const config = await getConfig();
     const missing: string[] = [];

     for (const key of REQUIRED_CONFIG_KEYS) {
          const value = config[key];
          if (!value || (typeof value === "string" && value.trim() === "")) {
               missing.push(key);
          }
     }

     return missing;
}

/**
 * Check if Linear is enabled
 */
export async function isLinearEnabled(): Promise<boolean> {
     const config = await getConfig();
     return config.linearEnabled !== false; // Default to true if not set
}

