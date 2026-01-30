/**
 * Dynamic Agent Generation System
 *
 * Main entry point for the JSON-driven agent generation system.
 * Loads service configurations and generates agent specifications.
 */

import { loadServiceConfigs, registerConfigCheck, getServicePaths } from "./loader";
import {
  generateAllAgentSpecs,
  specToMetadata,
  type GeneratedAgentSpec,
} from "./agent-generator";
import type { ServiceConfig } from "./schema";
import type { AgentMetadata } from "../agents/types";

// ============================================================================
// Re-exports
// ============================================================================

export {
  validateServiceConfig,
  type ServiceConfig,
  type ToolDefinition,
  type ServiceCli,
  type ToolCli,
  type ServiceFilesystem,
  type ToolFilesystem,
  type OutputConfig,
} from "./schema";
export { generateZodSchema, applyParameterDefaults } from "./zod-generator";
export { createJqTool, evaluateJq } from "./jq-tool";
export {
  generateTool,
  generateToolsForService,
  generateAllToolsForService,
  createExecutionContext,
  generateOutcomeSummary,
  getToolsDescription,
  type ToolExecutionContext,
} from "./tool-generator";
export {
  generateAgentSpecs,
  generateAllAgentSpecs,
  specToMetadata,
  type GeneratedAgentSpec,
  type ServiceAgentSpecs,
} from "./agent-generator";
export {
  loadServiceConfigs,
  getServiceConfig,
  registerConfigCheck,
  isServiceConfigured,
  ensureUserServicesDir,
  getServicePaths,
} from "./loader";
export {
  executeCliCommand,
  buildCommandLine,
  interpolate,
  getConfigValue,
  hasConfigValue,
  extractPath,
  processOutput,
} from "./cli-executor";
export {
  executeFilesystemOperation,
  resolveBasePath,
  validatePath,
  type FilesystemResult,
  type FileInfo,
  type FileWithContent,
  type SearchResult,
} from "./filesystem-executor";

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Result from loading and generating agents
 */
export interface LoadAndGenerateResult {
  /** All generated agent specifications */
  agentSpecs: GeneratedAgentSpec[];
  /** Service configurations that were loaded */
  serviceConfigs: ServiceConfig[];
  /** Agent metadata ready for registration */
  agentMetadata: AgentMetadata[];
}

/**
 * Options for loading and generating agents
 */
export interface LoadAndGenerateOptions {
  /** Skip config checks and load all services */
  skipConfigCheck?: boolean;
  /** Only load specific service ids */
  filterIds?: string[];
  /** Verbose logging */
  verbose?: boolean;
}

/**
 * Load service configurations and generate all agents
 *
 * This is the main entry point for the generation system.
 * It:
 * 1. Loads all JSON configs from bundled and user directories
 * 2. Merges user overrides
 * 3. Filters out unconfigured services
 * 4. Generates agent specifications (reader, writer, read_write)
 * 5. Returns everything needed for registration
 *
 * @param options - Loading and generation options
 * @returns Generated agent specs and metadata
 */
export async function loadAndGenerateAgents(
  options?: LoadAndGenerateOptions
): Promise<LoadAndGenerateResult> {
  const verbose = options?.verbose ?? false;

  if (verbose) {
    const paths = getServicePaths();
    console.log(`[Generation] Loading configs from:`);
    console.log(`  Bundled: ${paths.bundled}`);
    console.log(`  User: ${paths.user}`);
  }

  // Load service configurations
  const serviceConfigs = loadServiceConfigs({
    skipConfigCheck: options?.skipConfigCheck,
    filterIds: options?.filterIds,
  });

  if (verbose) {
    console.log(`[Generation] Loaded ${serviceConfigs.length} service configs`);
    for (const config of serviceConfigs) {
      console.log(`  - ${config.id}: ${config.tools.length} tools`);
    }
  }

  // Generate agent specifications
  const agentSpecs = generateAllAgentSpecs(serviceConfigs);

  if (verbose) {
    console.log(`[Generation] Generated ${agentSpecs.length} agent specs:`);
    for (const spec of agentSpecs) {
      console.log(`  - ${spec.id} (${spec.permission}): ${spec.toolNames.length} tools`);
    }
  }

  // Convert to metadata for registration
  const agentMetadata = agentSpecs.map(specToMetadata);

  return {
    agentSpecs,
    serviceConfigs,
    agentMetadata,
  };
}

/**
 * Initialize config checks for known services
 *
 * This is now largely a no-op since config checks are declarative.
 * Legacy function-based checks are loaded for backward compatibility only.
 *
 * @deprecated Prefer using the declarative `requiredConfig` array in service configs
 */
export async function initConfigChecks(): Promise<void> {
  // Legacy support: Import Google services config checks
  // These are only needed for services still using the old `service.configCheck` approach
  try {
    const { isGoogleConfigured } = await import("../services/google/base");
    const { isGmailConfigured } = await import("../services/google/gmail");

    // Register config checks (legacy support)
    registerConfigCheck("isGoogleConfigured", isGoogleConfigured);
    registerConfigCheck("isGmailConfigured", isGmailConfigured);

    // All Google services use the same config check
    registerConfigCheck("isCalendarConfigured", isGoogleConfigured);
    registerConfigCheck("isContactsConfigured", isGoogleConfigured);
    registerConfigCheck("isDriveConfigured", isGoogleConfigured);
    registerConfigCheck("isDocsConfigured", isGoogleConfigured);
    registerConfigCheck("isSheetsConfigured", isGoogleConfigured);
    registerConfigCheck("isKeepConfigured", isGoogleConfigured);
    registerConfigCheck("isChatConfigured", isGoogleConfigured);
  } catch {
    // Google services module may not exist - this is fine for new declarative configs
  }

  // Legacy support: Import Obsidian config check
  try {
    const { isObsidianConfigured } = await import("../services/obsidian");
    registerConfigCheck("isObsidianConfigured", isObsidianConfigured);
  } catch {
    // Obsidian module may not exist - this is fine for new declarative configs
  }
}

/**
 * Convenience function to get just the agent metadata
 * (without full specs or configs)
 */
export async function getGeneratedAgentMetadata(
  options?: LoadAndGenerateOptions
): Promise<AgentMetadata[]> {
  const result = await loadAndGenerateAgents(options);
  return result.agentMetadata;
}

/**
 * Get agent spec by ID
 */
export async function getAgentSpec(
  agentId: string,
  options?: LoadAndGenerateOptions
): Promise<GeneratedAgentSpec | undefined> {
  const result = await loadAndGenerateAgents(options);
  return result.agentSpecs.find((spec) => spec.id === agentId);
}
