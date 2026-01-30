/**
 * Service Configuration Loader
 *
 * Discovers, loads, and merges service configurations from both
 * bundled (config/services/) and user (~/.zaru/services/) locations.
 * User configurations override bundled ones by matching id.
 *
 * Config checking is now declarative via the `requiredConfig` array in
 * service configurations, rather than requiring function-based checks.
 */

import { existsSync, readdirSync, readFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";
import { validateServiceConfig, type ServiceConfig } from "./schema";
import { getConfigValue, hasConfigValue } from "./cli-executor";

// ============================================================================
// Configuration Paths
// ============================================================================

/** User's service configuration directory */
const USER_SERVICES_DIR = join(homedir(), ".zaru", "services");

/** Get the directory of this file */
function getCurrentDir(): string {
  // Works in both ESM and Bun
  if (typeof import.meta.url !== "undefined") {
    return dirname(fileURLToPath(import.meta.url));
  }
  // Fallback for CommonJS
  return __dirname;
}

/** Bundled service configurations (relative to project root) */
function getBundledServicesDir(): string {
  // Find the config/services directory relative to this file
  // This file is at src/generation/loader.ts
  // Config is at config/services/
  const currentDir = getCurrentDir();
  const srcDir = dirname(currentDir); // src/
  const projectRoot = dirname(srcDir); // project root
  return join(projectRoot, "config", "services");
}

// ============================================================================
// Service Config Checks
// ============================================================================

/**
 * Registry of config check functions (legacy support)
 * Maps function names to their implementations
 */
type ConfigCheckFn = () => boolean;

const configCheckRegistry: Record<string, ConfigCheckFn> = {};

/**
 * Register a config check function (legacy support)
 *
 * @param name - Function name (matches service.configCheck in JSON)
 * @param fn - Function that returns true if service is configured
 */
export function registerConfigCheck(name: string, fn: ConfigCheckFn): void {
  configCheckRegistry[name] = fn;
}

/**
 * Check if a service is configured
 *
 * Uses the new declarative `requiredConfig` array if present.
 * Falls back to legacy function-based checks for backward compatibility.
 *
 * @param config - Service configuration
 * @returns true if service is configured (or no check is defined)
 */
export function isServiceConfigured(config: ServiceConfig): boolean {
  // New declarative approach: check requiredConfig array
  if (config.requiredConfig && config.requiredConfig.length > 0) {
    for (const configPath of config.requiredConfig) {
      if (!hasConfigValue(configPath)) {
        return false;
      }

      // For filesystem-based services, also check if the path exists
      if (config.filesystem && configPath === config.filesystem.basePath) {
        const pathValue = getConfigValue(configPath);
        if (typeof pathValue === "string" && !existsSync(pathValue)) {
          return false;
        }
      }
    }
    return true;
  }

  // Legacy approach: use function-based config check
  if (config.service?.configCheck) {
    const checkFn = configCheckRegistry[config.service.configCheck];
    if (!checkFn) {
      console.warn(
        `[Loader] Config check function "${config.service.configCheck}" not found for service "${config.id}"`
      );
      return false;
    }
    return checkFn();
  }

  // No config check defined - assume configured
  return true;
}

// ============================================================================
// Loading Functions
// ============================================================================

/**
 * Load a single JSON config file
 *
 * @param filePath - Path to JSON file
 * @returns Validated service config or null if invalid
 */
function loadConfigFile(filePath: string): ServiceConfig | null {
  try {
    const content = readFileSync(filePath, "utf-8");
    const json = JSON.parse(content);
    return validateServiceConfig(json);
  } catch (error) {
    console.warn(
      `[Loader] Failed to load config from ${filePath}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return null;
  }
}

/**
 * Load all configs from a directory
 *
 * @param dir - Directory path
 * @returns Map of service id to config
 */
function loadConfigsFromDir(dir: string): Map<string, ServiceConfig> {
  const configs = new Map<string, ServiceConfig>();

  if (!existsSync(dir)) {
    return configs;
  }

  try {
    const files = readdirSync(dir);

    for (const file of files) {
      if (!file.endsWith(".json")) {
        continue;
      }

      const filePath = join(dir, file);
      const config = loadConfigFile(filePath);

      if (config) {
        configs.set(config.id, config);
      }
    }
  } catch (error) {
    console.warn(
      `[Loader] Failed to read directory ${dir}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  return configs;
}

/**
 * Load all service configurations
 *
 * Loads from both bundled and user directories, with user configs
 * overriding bundled ones by matching id.
 *
 * @param options - Loading options
 * @returns Array of merged service configurations
 */
export function loadServiceConfigs(options?: {
  /** Skip config checks and load all services */
  skipConfigCheck?: boolean;
  /** Only load specific service ids */
  filterIds?: string[];
}): ServiceConfig[] {
  const bundledDir = getBundledServicesDir();

  // Load bundled configs first
  const bundledConfigs = loadConfigsFromDir(bundledDir);

  // Load user configs (override bundled)
  const userConfigs = loadConfigsFromDir(USER_SERVICES_DIR);

  // Merge: user configs override bundled
  const mergedConfigs = new Map<string, ServiceConfig>(bundledConfigs);
  for (const [id, config] of userConfigs) {
    mergedConfigs.set(id, config);
  }

  // Convert to array
  let configs = Array.from(mergedConfigs.values());

  // Filter by ids if specified
  if (options?.filterIds && options.filterIds.length > 0) {
    const filterSet = new Set(options.filterIds);
    configs = configs.filter((c) => filterSet.has(c.id));
  }

  // Filter out services that aren't configured
  if (!options?.skipConfigCheck) {
    configs = configs.filter((config) => {
      const configured = isServiceConfigured(config);
      if (!configured) {
        console.info(
          `[Loader] Skipping service "${config.id}" - not configured`
        );
      }
      return configured;
    });
  }

  return configs;
}

/**
 * Get a single service configuration by id
 *
 * @param id - Service id
 * @returns Service config or undefined if not found
 */
export function getServiceConfig(id: string): ServiceConfig | undefined {
  const configs = loadServiceConfigs({ filterIds: [id], skipConfigCheck: true });
  return configs[0];
}

/**
 * Ensure user services directory exists
 */
export function ensureUserServicesDir(): void {
  if (!existsSync(USER_SERVICES_DIR)) {
    mkdirSync(USER_SERVICES_DIR, { recursive: true });
  }
}

/**
 * Get paths to service directories for debugging
 */
export function getServicePaths(): { bundled: string; user: string } {
  return {
    bundled: getBundledServicesDir(),
    user: USER_SERVICES_DIR,
  };
}

// ============================================================================
// Default Config Check Registrations
// ============================================================================

// These will be populated when the Google services module is imported
// The module should call registerConfigCheck() to register its check functions
