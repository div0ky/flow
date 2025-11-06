import { homedir } from "os";
import { join } from "path";

import { consola } from "consola";

import type { Config, ConfigKey } from "./config";
import { configSchema, ENV_TO_CONFIG } from "./config";

/**
 * Get the path to the global config file in user home directory
 */
function getGlobalConfigPath(): string {
     return join(homedir(), ".div-flow", "config.json");
}

/**
 * Get the path to the project-local config file
 */
function getLocalConfigPath(): string {
     return join(process.cwd(), ".div-flow.json");
}

/**
 * Read config from a file path
 */
async function readConfigFile(filePath: string): Promise<Config | null> {
     try {
          const file = Bun.file(filePath);
          if (!(await file.exists())) {
               return null;
          }

          const content = await file.text();
          const parsed = JSON.parse(content) as unknown;
          return configSchema.parse(parsed);
     }
     catch (error) {
          consola.warn(`Failed to read config file at ${filePath}:`, error);
          return null;
     }
}

/**
 * Write config to a file path
 */
async function writeConfigFile(filePath: string, config: Config): Promise<void> {
     try {
          // Ensure directory exists for global config
          if (filePath.includes(".div-flow")) {
               const dir = join(filePath, "..");
               try {
                    await Bun.$`mkdir -p ${dir}`.quiet();
               } catch {
                    // Directory might already exist, ignore
               }
          }

          await Bun.write(filePath, JSON.stringify(config, null, 2) + "\n");
     }
     catch (error) {
          consola.error(`Failed to write config file at ${filePath}:`, error);
          throw error;
     }
}

/**
 * Get configuration value from environment variables
 */
function getConfigFromEnv(): Partial<Config> {
     const config: Partial<Config> = {};

     for (const [envKey, configKey] of Object.entries(ENV_TO_CONFIG)) {
          const value = process.env[envKey];
          if (value) {
               if (configKey === "linearEnabled") {
                    // Parse boolean from environment variable
                    config[configKey] = value.toLowerCase() === "true" || value === "1";
               } else {
                    config[configKey] = value;
               }
          }
     }

     return config;
}

/**
 * Get the current configuration, merging from multiple sources in priority order:
 * 1. Local config file (.div-flow.json in project root)
 * 2. Global config file (~/.div-flow/config.json)
 * 3. Environment variables
 */
export async function getConfig(): Promise<Config> {
     // Try local config first
     const localConfig = await readConfigFile(getLocalConfigPath());
     if (localConfig) {
          return localConfig;
     }

     // Try global config
     const globalConfig = await readConfigFile(getGlobalConfigPath());
     if (globalConfig) {
          return globalConfig;
     }

     // Fall back to environment variables
     return getConfigFromEnv() as Config;
}

/**
 * Get a specific configuration value
 */
export async function getConfigValue(key: ConfigKey): Promise<string | undefined> {
     const config = await getConfig();
     return config[key];
}

/**
 * Set a configuration value in the global config file
 */
export async function setConfigValue(key: ConfigKey, value: string | boolean): Promise<void> {
     const globalPath = getGlobalConfigPath();
     let config = await readConfigFile(globalPath) || ({} as Config);

     config[key] = value as any;

     await writeConfigFile(globalPath, config);
}

/**
 * Set multiple configuration values at once
 */
export async function setConfigValues(values: Partial<Config>): Promise<void> {
     const globalPath = getGlobalConfigPath();
     const existingConfig = await readConfigFile(globalPath) || ({} as Config);

     const updatedConfig: Config = {
          ...existingConfig,
          ...values,
     };

     await writeConfigFile(globalPath, updatedConfig);
}

/**
 * List all configuration values (masking sensitive values)
 */
export async function listConfig(): Promise<Config> {
     return await getConfig();
}

/**
 * Get the path to the active config file (local or global)
 */
export async function getConfigPath(): Promise<string> {
     const localPath = getLocalConfigPath();
     const localFile = Bun.file(localPath);
     if (await localFile.exists()) {
          return localPath;
     }
     return getGlobalConfigPath();
}

