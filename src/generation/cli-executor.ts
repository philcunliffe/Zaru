/**
 * CLI Executor
 *
 * Executes CLI commands based on JSON configuration.
 * Handles argument interpolation, config value substitution, and output parsing.
 */

import { spawn } from "child_process";
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { ServiceCli, ToolCli, OutputConfig } from "./schema";

// ============================================================================
// Configuration
// ============================================================================

const CONFIG_FILE = join(homedir(), ".zaru", "config.json");

/**
 * Load the Zaru configuration file
 */
function loadConfig(): Record<string, unknown> {
  if (!existsSync(CONFIG_FILE)) {
    return {};
  }
  try {
    const content = readFileSync(CONFIG_FILE, "utf-8");
    return JSON.parse(content);
  } catch {
    return {};
  }
}

/**
 * Get a value from the config file using dot notation
 * @param path - Dot-notation path (e.g., "google.account")
 * @returns The value at the path, or undefined if not found
 */
export function getConfigValue(path: string): unknown {
  const config = loadConfig();
  const parts = path.split(".");
  let current: unknown = config;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Check if a config path exists and has a truthy value
 */
export function hasConfigValue(path: string): boolean {
  const value = getConfigValue(path);
  return value !== null && value !== undefined && value !== "";
}

// ============================================================================
// Interpolation
// ============================================================================

/**
 * Interpolate parameter values into a template string
 * Replaces {paramName} with the corresponding parameter value
 *
 * @param template - Template string with {paramName} placeholders
 * @param params - Parameter values
 * @returns Interpolated string
 */
export function interpolate(template: string, params: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (match, paramName) => {
    const value = params[paramName];
    if (value === undefined || value === null) {
      return match; // Keep placeholder if no value
    }
    if (Array.isArray(value)) {
      return value.join(",");
    }
    return String(value);
  });
}

/**
 * Check if a template has any unresolved placeholders
 */
function hasUnresolvedPlaceholders(str: string): boolean {
  return /\{\w+\}/.test(str);
}

// ============================================================================
// Command Building
// ============================================================================

/**
 * Build the command line arguments from service and tool configuration
 *
 * @param serviceCli - Service-level CLI configuration
 * @param toolCli - Tool-level CLI configuration
 * @param params - Parameter values from the tool call
 * @returns Array of command line arguments
 */
export function buildCommandLine(
  serviceCli: ServiceCli,
  toolCli: ToolCli,
  params: Record<string, unknown>
): string[] {
  const args: string[] = [];

  // Add service subcommand if specified
  if (serviceCli.service) {
    args.push(serviceCli.service);
  }

  // Add the command (before global flags, as most CLIs expect: cmd <subcommand> [flags])
  args.push(toolCli.command);

  // Add global flags
  if (serviceCli.globalFlags) {
    args.push(...serviceCli.globalFlags);
  }

  // Add global config values as flags
  if (serviceCli.globalConfig) {
    for (const [flagName, configPath] of Object.entries(serviceCli.globalConfig)) {
      const value = getConfigValue(configPath);
      if (value !== undefined && value !== null) {
        args.push(`--${flagName}`, String(value));
      }
    }
  }

  // Add positional arguments
  if (toolCli.args) {
    for (const arg of toolCli.args) {
      const interpolated = interpolate(arg, params);
      // Only add if the placeholder was resolved
      if (!hasUnresolvedPlaceholders(interpolated)) {
        args.push(interpolated);
      }
    }
  }

  // Add flags
  if (toolCli.flags) {
    for (const [paramName, flagTemplate] of Object.entries(toolCli.flags)) {
      const value = params[paramName];
      if (value !== undefined && value !== null) {
        const interpolated = interpolate(flagTemplate, params);
        // Parse the flag template to extract flag name and value
        const parts = interpolated.split(/\s+/);
        args.push(...parts);
      }
    }
  }

  return args;
}

// ============================================================================
// Output Extraction
// ============================================================================

/**
 * Extract a value from an object using a simple path notation
 * Supports dot notation and array indexing: "threads", "messages[0]", "data.items"
 *
 * @param data - The source data
 * @param path - The extraction path
 * @returns The extracted value
 */
export function extractPath(data: unknown, path: string): unknown {
  if (!path) {
    return data;
  }

  // Split path into segments, handling array notation
  const segments = path.match(/[^.[\]]+|\[\d+\]/g) || [];
  let current: unknown = data;

  for (const segment of segments) {
    if (current === null || current === undefined) {
      return undefined;
    }

    if (segment.startsWith("[") && segment.endsWith("]")) {
      // Array index
      const index = parseInt(segment.slice(1, -1), 10);
      if (Array.isArray(current)) {
        current = current[index];
      } else {
        return undefined;
      }
    } else {
      // Object property
      if (typeof current === "object") {
        current = (current as Record<string, unknown>)[segment];
      } else {
        return undefined;
      }
    }
  }

  return current;
}

/**
 * Truncate a string field to a maximum length
 */
function truncateString(value: string, maxLength: number, suffix: string = "..."): string {
  if (value.length <= maxLength) {
    return value;
  }
  return value.slice(0, maxLength) + suffix;
}

/**
 * Apply truncation to a field in an object (recursively handles arrays and nested objects)
 *
 * @param data - The data to process
 * @param fieldPath - Dot-notation path to the field (e.g., "body", "messages.body")
 * @param maxLength - Maximum length before truncation
 * @param suffix - Suffix to add when truncated
 */
function applyTruncation(
  data: unknown,
  fieldPath: string,
  maxLength: number,
  suffix: string
): unknown {
  if (data === null || data === undefined) {
    return data;
  }

  // Handle arrays - apply truncation to each element
  if (Array.isArray(data)) {
    return data.map((item) => applyTruncation(item, fieldPath, maxLength, suffix));
  }

  // Handle objects
  if (typeof data === "object") {
    const obj = data as Record<string, unknown>;
    const parts = fieldPath.split(".");
    const firstPart = parts[0];
    const restPath = parts.slice(1).join(".");

    // Check if this is a direct field match
    if (parts.length === 1 && firstPart in obj) {
      const value = obj[firstPart];
      if (typeof value === "string") {
        return {
          ...obj,
          [firstPart]: truncateString(value, maxLength, suffix),
        };
      }
      // If it's an array or object, recurse into it
      if (Array.isArray(value) || typeof value === "object") {
        return {
          ...obj,
          [firstPart]: applyTruncation(value, fieldPath, maxLength, suffix),
        };
      }
    }

    // Handle nested path
    if (parts.length > 1 && firstPart in obj) {
      return {
        ...obj,
        [firstPart]: applyTruncation(obj[firstPart], restPath, maxLength, suffix),
      };
    }

    return data;
  }

  return data;
}

/**
 * Remove a field from an object (recursively handles arrays and nested objects)
 *
 * @param data - The data to process
 * @param fieldPath - Dot-notation path to the field to omit
 */
function applyOmission(data: unknown, fieldPath: string): unknown {
  if (data === null || data === undefined) {
    return data;
  }

  // Handle arrays - apply omission to each element
  if (Array.isArray(data)) {
    return data.map((item) => applyOmission(item, fieldPath));
  }

  // Handle objects
  if (typeof data === "object") {
    const obj = data as Record<string, unknown>;
    const parts = fieldPath.split(".");
    const firstPart = parts[0];
    const restPath = parts.slice(1).join(".");

    // Check if this is a direct field match
    if (parts.length === 1 && firstPart in obj) {
      const { [firstPart]: _, ...rest } = obj;
      return rest;
    }

    // Handle nested path
    if (parts.length > 1 && firstPart in obj) {
      return {
        ...obj,
        [firstPart]: applyOmission(obj[firstPart], restPath),
      };
    }

    return data;
  }

  return data;
}

/**
 * Process the output according to the output configuration
 *
 * @param data - Raw output data
 * @param outputConfig - Output extraction/transformation configuration
 * @returns Processed output
 */
export function processOutput(data: unknown, outputConfig?: OutputConfig): unknown {
  if (!outputConfig) {
    return data;
  }

  let result = data;

  // Extract specific path if specified
  if (outputConfig.extract) {
    result = extractPath(result, outputConfig.extract);
  }

  // Apply field truncation
  if (outputConfig.truncateFields) {
    for (const truncateConfig of outputConfig.truncateFields) {
      result = applyTruncation(
        result,
        truncateConfig.field,
        truncateConfig.maxLength,
        truncateConfig.suffix || "..."
      );
    }
  }

  // Apply field omission
  if (outputConfig.omitFields) {
    for (const fieldPath of outputConfig.omitFields) {
      result = applyOmission(result, fieldPath);
    }
  }

  // Note: transform is handled separately via the jq tool if needed
  // We don't duplicate jq functionality here

  return result;
}

// ============================================================================
// Command Execution
// ============================================================================

/**
 * Execute a CLI command and return the parsed output
 *
 * @param serviceCli - Service-level CLI configuration
 * @param toolCli - Tool-level CLI configuration
 * @param params - Parameter values from the tool call
 * @param outputConfig - Optional output extraction configuration
 * @returns The command output (parsed as JSON if outputFormat is "json")
 */
export async function executeCliCommand(
  serviceCli: ServiceCli,
  toolCli: ToolCli,
  params: Record<string, unknown>,
  outputConfig?: OutputConfig
): Promise<unknown> {
  const args = buildCommandLine(serviceCli, toolCli, params);
  const executable = serviceCli.executable;
  const outputFormat = serviceCli.outputFormat || "json";

  // Get stdin data if specified
  let stdinData: string | undefined;
  if (toolCli.stdin) {
    const stdinValue = params[toolCli.stdin];
    if (stdinValue !== undefined && stdinValue !== null) {
      // Convert to string - if it's an object/array, JSON stringify it
      if (typeof stdinValue === "string") {
        stdinData = stdinValue;
      } else {
        stdinData = JSON.stringify(stdinValue);
      }
    }
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(executable, args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `CLI command failed (exit ${code}): ${stderr || stdout}\nCommand: ${executable} ${args.join(" ")}`
          )
        );
        return;
      }

      try {
        let result: unknown;

        if (outputFormat === "json") {
          result = JSON.parse(stdout);
        } else if (outputFormat === "jsonl") {
          // Parse newline-delimited JSON (each line is a separate JSON object)
          const lines = stdout.trim().split("\n").filter((line) => line.trim());
          result = lines.map((line) => JSON.parse(line));
        } else {
          result = stdout;
        }

        // Process output extraction
        result = processOutput(result, outputConfig);

        resolve(result);
      } catch (parseError) {
        reject(
          new Error(
            `Failed to parse CLI output: ${parseError instanceof Error ? parseError.message : String(parseError)}\nOutput: ${stdout}`
          )
        );
      }
    });

    proc.on("error", (error) => {
      reject(
        new Error(
          `Failed to execute CLI: ${error.message}\nCommand: ${executable} ${args.join(" ")}`
        )
      );
    });

    // Write stdin data if provided
    if (stdinData !== undefined) {
      proc.stdin.write(stdinData);
      proc.stdin.end();
    } else {
      proc.stdin.end();
    }
  });
}
