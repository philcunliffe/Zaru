/**
 * Agent Generator
 *
 * Determines which agents to create from service configurations
 * based on tool permissions. Generates agent specifications for
 * dynamic worker spawning.
 */

import type { ServiceConfig, ToolPermission } from "./schema";
import type { AgentPermission, AgentMetadata, AgentCapability } from "../agents/types";

/**
 * Specification for a dynamically generated agent
 */
export interface GeneratedAgentSpec {
  /** Agent ID (e.g., "google-gmail-reader") */
  id: string;
  /** Agent display name (e.g., "Gmail Reader") */
  name: string;
  /** Agent permission type */
  permission: AgentPermission;
  /** Source service configuration */
  serviceConfig: ServiceConfig;
  /** Tool names this agent should have */
  toolNames: string[];
  /** Capabilities for orchestrator */
  capabilities: AgentCapability[];
  /** Public key (set during registration) */
  publicKey: string;
}

/**
 * Result of generating agents for a service
 */
export interface ServiceAgentSpecs {
  /** The service configuration */
  serviceConfig: ServiceConfig;
  /** Generated reader agent (if any) */
  reader?: GeneratedAgentSpec;
  /** Generated writer agent (if any) */
  writer?: GeneratedAgentSpec;
  /** Generated read/write agent (if generateReadWrite is true) */
  readWrite?: GeneratedAgentSpec;
}

/**
 * Analyze a service configuration and determine which agents to create
 *
 * @param config - Service configuration
 * @returns Agent specifications
 */
export function analyzeServiceTools(config: ServiceConfig): {
  readTools: string[];
  writeTools: string[];
  hasRead: boolean;
  hasWrite: boolean;
} {
  const readTools: string[] = [];
  const writeTools: string[] = [];

  for (const tool of config.tools) {
    if (tool.permission === "READ") {
      readTools.push(tool.name);
    } else if (tool.permission === "WRITE") {
      writeTools.push(tool.name);
    }
  }

  return {
    readTools,
    writeTools,
    hasRead: readTools.length > 0,
    hasWrite: writeTools.length > 0,
  };
}

/**
 * Generate capabilities from tool definitions
 */
function generateCapabilities(
  config: ServiceConfig,
  permission: "READ" | "WRITE" | "both"
): AgentCapability[] {
  const capabilities: AgentCapability[] = [];

  for (const tool of config.tools) {
    if (permission === "both" || tool.permission === permission) {
      // Convert tool name to capability name (remove prefix)
      const capName = tool.name.replace(/^[\w]+_/, "").replace(/_/g, "-");
      capabilities.push({
        name: capName,
        description: tool.description,
      });
    }
  }

  return capabilities;
}

/**
 * Generate agent specifications for a service configuration
 *
 * Logic (when agentTypes is specified):
 * - Generate only the specified agent types
 * - READ agent gets all READ tools
 * - WRITE agent gets all WRITE tools
 * - READ_WRITE agent gets all tools
 *
 * Logic (default, when agentTypes is not specified):
 * - If only READ tools → generate "{id}-reader" agent
 * - If only WRITE tools → generate "{id}-writer" agent
 * - If both → generate "{id}-reader", "{id}-writer", and optionally "{id}-agent" (READ_WRITE)
 *
 * @param config - Service configuration
 * @returns Agent specifications for this service
 */
export function generateAgentSpecs(config: ServiceConfig): ServiceAgentSpecs {
  const { readTools, writeTools, hasRead, hasWrite } = analyzeServiceTools(config);
  const result: ServiceAgentSpecs = { serviceConfig: config };

  // If agentTypes is explicitly specified, use that
  if (config.agentTypes && config.agentTypes.length > 0) {
    for (const agentType of config.agentTypes) {
      if (agentType === "READ") {
        result.reader = {
          id: `${config.id}-reader`,
          name: `${config.name}Reader`,
          permission: "READ",
          serviceConfig: config,
          toolNames: readTools,
          capabilities: generateCapabilities(config, "READ"),
          publicKey: "",
        };
      } else if (agentType === "WRITE") {
        result.writer = {
          id: `${config.id}-writer`,
          name: `${config.name}Writer`,
          permission: "WRITE",
          serviceConfig: config,
          toolNames: writeTools,
          capabilities: generateCapabilities(config, "WRITE"),
          publicKey: "",
        };
      } else if (agentType === "READ_WRITE") {
        result.readWrite = {
          id: `${config.id}-agent`,
          name: `${config.name}Agent`,
          permission: "READ_WRITE",
          serviceConfig: config,
          toolNames: [...readTools, ...writeTools],
          capabilities: generateCapabilities(config, "both"),
          publicKey: "",
        };
      }
    }
    return result;
  }

  // Default behavior: generate based on tool permissions
  // Generate reader agent if there are READ tools
  if (hasRead) {
    result.reader = {
      id: `${config.id}-reader`,
      name: `${config.name}Reader`,
      permission: "READ",
      serviceConfig: config,
      toolNames: readTools,
      capabilities: generateCapabilities(config, "READ"),
      publicKey: "",
    };
  }

  // Generate writer agent if there are WRITE tools
  if (hasWrite) {
    result.writer = {
      id: `${config.id}-writer`,
      name: `${config.name}Writer`,
      permission: "WRITE",
      serviceConfig: config,
      toolNames: writeTools,
      capabilities: generateCapabilities(config, "WRITE"),
      publicKey: "",
    };
  }

  // Generate READ_WRITE agent if both exist and generateReadWrite is true
  if (hasRead && hasWrite && config.generateReadWrite) {
    result.readWrite = {
      id: `${config.id}-agent`,
      name: `${config.name}Agent`,
      permission: "READ_WRITE",
      serviceConfig: config,
      toolNames: [...readTools, ...writeTools],
      capabilities: generateCapabilities(config, "both"),
      publicKey: "",
    };
  }

  return result;
}

/**
 * Generate all agent specifications from multiple service configurations
 *
 * @param configs - Array of service configurations
 * @returns All generated agent specifications
 */
export function generateAllAgentSpecs(
  configs: ServiceConfig[]
): GeneratedAgentSpec[] {
  const allSpecs: GeneratedAgentSpec[] = [];

  for (const config of configs) {
    const specs = generateAgentSpecs(config);

    if (specs.reader) {
      allSpecs.push(specs.reader);
    }
    if (specs.writer) {
      allSpecs.push(specs.writer);
    }
    if (specs.readWrite) {
      allSpecs.push(specs.readWrite);
    }
  }

  return allSpecs;
}

/**
 * Convert a GeneratedAgentSpec to AgentMetadata for registration
 */
export function specToMetadata(spec: GeneratedAgentSpec): AgentMetadata {
  return {
    id: spec.id,
    name: spec.name,
    permission: spec.permission,
    capabilities: spec.capabilities,
    publicKey: spec.publicKey,
  };
}

/**
 * Get all generated agents as metadata for registration
 */
export function getAllAgentMetadata(
  configs: ServiceConfig[]
): AgentMetadata[] {
  const specs = generateAllAgentSpecs(configs);
  return specs.map(specToMetadata);
}
