/**
 * Tool Generator
 *
 * Generates Vercel AI SDK tool() calls from JSON tool definitions.
 * Supports three execution modes:
 * 1. CLI execution - tools invoke CLI commands
 * 2. Filesystem operations - tools read/write files directly
 * 3. Service methods (legacy) - tools call TypeScript service class methods
 */

import { tool, type CoreTool } from "ai";
import { generateZodSchema, applyParameterDefaults } from "./zod-generator";
import type { ToolDefinition, ServiceConfig } from "./schema";
import { executeCliCommand } from "./cli-executor";
import { executeFilesystemOperation } from "./filesystem-executor";

/**
 * A service instance that has methods matching the tool definitions
 */
export type ServiceInstance = Record<string, (...args: unknown[]) => Promise<unknown>>;

/**
 * Context for counting items processed (for outcome summaries)
 */
export interface ToolExecutionContext {
  itemCounts: Record<string, number>;
  hasActionItems: boolean;
  hasUnread: boolean;
}

/**
 * Create a default execution context
 */
export function createExecutionContext(): ToolExecutionContext {
  return {
    itemCounts: {},
    hasActionItems: false,
    hasUnread: false,
  };
}

/**
 * Generate an outcome summary from the execution context
 */
export function generateOutcomeSummary(
  context: ToolExecutionContext,
  serviceName: string
): string {
  const summaryParts: string[] = [];

  for (const [key, count] of Object.entries(context.itemCounts)) {
    if (count > 0) {
      summaryParts.push(`${count} ${key}`);
    }
  }

  let summary = summaryParts.length > 0
    ? `Processed ${summaryParts.join(", ")}`
    : `${serviceName} task completed`;

  if (context.hasActionItems) {
    summary += " with action items";
  }
  if (context.hasUnread) {
    summary += " (includes unread)";
  }

  return summary;
}

/**
 * Generate a single tool from a tool definition
 *
 * Supports three execution modes:
 * 1. CLI execution - if toolDef.cli and serviceConfig.cli are defined
 * 2. Filesystem operations - if toolDef.filesystem and serviceConfig.filesystem are defined
 * 3. Service methods (legacy) - if toolDef.method and serviceInstance are provided
 *
 * @param toolDef - The tool definition from JSON
 * @param serviceConfig - The service configuration
 * @param serviceInstance - Optional instantiated service class (for legacy mode)
 * @param context - Optional execution context for tracking
 * @returns A Vercel AI SDK tool
 */
export function generateTool(
  toolDef: ToolDefinition,
  serviceConfig: ServiceConfig,
  serviceInstance?: ServiceInstance | null,
  context?: ToolExecutionContext
): CoreTool {
  // Generate Zod schema for parameters
  const parametersSchema = generateZodSchema(toolDef.parameters);

  // Determine execution mode
  const useCliMode = toolDef.cli && serviceConfig.cli;
  const useFilesystemMode = toolDef.filesystem && serviceConfig.filesystem;
  const useLegacyMode = toolDef.method && serviceInstance;

  // Validate that at least one execution mode is available
  if (!useCliMode && !useFilesystemMode && !useLegacyMode) {
    throw new Error(
      `Tool "${toolDef.name}" has no valid execution mode. Define cli, filesystem, or method.`
    );
  }

  return tool({
    description: toolDef.description,
    parameters: parametersSchema,
    execute: async (params: Record<string, unknown>) => {
      try {
        // Apply defaults for null/undefined values (OpenAI strict mode sends null for optional params)
        const processedParams = applyParameterDefaults(params, toolDef.parameters);

        let result: unknown;

        if (useCliMode) {
          // CLI execution mode
          result = await executeCliCommand(
            serviceConfig.cli!,
            toolDef.cli!,
            processedParams,
            toolDef.output
          );
        } else if (useFilesystemMode) {
          // Filesystem execution mode
          result = await executeFilesystemOperation(
            serviceConfig.filesystem!,
            toolDef.filesystem!,
            processedParams
          );
        } else if (useLegacyMode) {
          // Legacy service method mode
          result = await executeLegacyMethod(toolDef, serviceInstance!, processedParams);
        }

        // Update context if provided
        if (context && result) {
          updateContextFromResult(context, toolDef.name, result);
        }

        return result;
      } catch (error) {
        // Wrap errors with tool context
        throw new Error(
          `Tool "${toolDef.name}" failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    },
  });
}

/**
 * Execute a tool using the legacy service method approach
 */
async function executeLegacyMethod(
  toolDef: ToolDefinition,
  serviceInstance: ServiceInstance,
  params: Record<string, unknown>
): Promise<unknown> {
  const method = serviceInstance[toolDef.method!];
  if (typeof method !== "function") {
    throw new Error(
      `Service method "${toolDef.method}" not found for tool "${toolDef.name}"`
    );
  }

  // Build arguments for the service method
  //
  // Convention: Service methods follow this pattern:
  //   method(requiredArg1, requiredArg2, ..., options?: { optionalParams })
  //
  // We extract required parameters as positional args,
  // and bundle optional parameters into an options object.

  const requiredParams = toolDef.parameters.filter((p) => p.required);
  const optionalParams = toolDef.parameters.filter((p) => !p.required);

  // Build positional arguments from required params
  const args: unknown[] = requiredParams.map((p) => params[p.name]);

  // Build options object from optional params if any have values
  if (optionalParams.length > 0) {
    const options: Record<string, unknown> = {};
    let hasOptions = false;
    for (const p of optionalParams) {
      if (params[p.name] !== undefined) {
        options[p.name] = params[p.name];
        hasOptions = true;
      }
    }
    if (hasOptions) {
      args.push(options);
    }
  }

  return method.apply(serviceInstance, args);
}

/**
 * Generate all tools for a service configuration
 *
 * @param config - Service configuration with tool definitions
 * @param permission - Filter tools by permission ("READ" or "WRITE")
 * @param serviceInstance - Optional instantiated service class (for legacy mode)
 * @param context - Optional execution context for tracking
 * @returns Record of tool name to tool
 */
export function generateToolsForService(
  config: ServiceConfig,
  permission: "READ" | "WRITE",
  serviceInstance?: ServiceInstance | null,
  context?: ToolExecutionContext
): Record<string, CoreTool> {
  const tools: Record<string, CoreTool> = {};

  for (const toolDef of config.tools) {
    if (toolDef.permission === permission) {
      tools[toolDef.name] = generateTool(toolDef, config, serviceInstance, context);
    }
  }

  return tools;
}

/**
 * Generate all tools for a READ_WRITE agent (gets both READ and WRITE tools)
 *
 * @param config - Service configuration with tool definitions
 * @param serviceInstance - Optional instantiated service class (for legacy mode)
 * @param context - Optional execution context for tracking
 * @returns Record of tool name to tool
 */
export function generateAllToolsForService(
  config: ServiceConfig,
  serviceInstance?: ServiceInstance | null,
  context?: ToolExecutionContext
): Record<string, CoreTool> {
  const tools: Record<string, CoreTool> = {};

  for (const toolDef of config.tools) {
    tools[toolDef.name] = generateTool(toolDef, config, serviceInstance, context);
  }

  return tools;
}

/**
 * Update execution context based on tool results
 * This helps build outcome summaries
 */
function updateContextFromResult(
  context: ToolExecutionContext,
  toolName: string,
  result: unknown
): void {
  if (!result || typeof result !== "object") {
    return;
  }

  // Count items in array results
  if (Array.isArray(result)) {
    // Determine the type of items based on tool name
    const itemType = inferItemType(toolName);
    context.itemCounts[itemType] = (context.itemCounts[itemType] || 0) + result.length;

    // Check for unread/action items in results
    for (const item of result) {
      if (typeof item === "object" && item !== null) {
        const obj = item as Record<string, unknown>;
        if (obj.isRead === false) {
          context.hasUnread = true;
        }
        // Simple action item detection
        const text = JSON.stringify(obj).toLowerCase();
        if (/action|todo|urgent|asap|deadline/.test(text)) {
          context.hasActionItems = true;
        }
      }
    }
  }

  // Handle single object results
  if (!Array.isArray(result)) {
    const obj = result as Record<string, unknown>;
    const itemType = inferItemType(toolName);
    context.itemCounts[itemType] = (context.itemCounts[itemType] || 0) + 1;

    if (obj.isRead === false) {
      context.hasUnread = true;
    }
  }
}

/**
 * Infer the item type from a tool name for counting
 */
function inferItemType(toolName: string): string {
  const lowerName = toolName.toLowerCase();

  if (lowerName.includes("email") || lowerName.includes("gmail")) {
    return "emails";
  }
  if (lowerName.includes("thread")) {
    return "threads";
  }
  if (lowerName.includes("event") || lowerName.includes("calendar")) {
    return "events";
  }
  if (lowerName.includes("contact")) {
    return "contacts";
  }
  if (lowerName.includes("file") || lowerName.includes("drive")) {
    return "files";
  }
  if (lowerName.includes("folder")) {
    return "folders";
  }
  if (lowerName.includes("doc")) {
    return "documents";
  }
  if (lowerName.includes("sheet") || lowerName.includes("spreadsheet")) {
    return "spreadsheets";
  }
  if (lowerName.includes("note") || lowerName.includes("keep")) {
    return "notes";
  }
  if (lowerName.includes("message") || lowerName.includes("chat")) {
    return "messages";
  }
  if (lowerName.includes("space")) {
    return "spaces";
  }
  if (lowerName.includes("label")) {
    return "labels";
  }

  return "items";
}

/**
 * Get a description of available tools for system prompts
 */
export function getToolsDescription(
  config: ServiceConfig,
  permission?: "READ" | "WRITE"
): string {
  const tools = permission
    ? config.tools.filter((t) => t.permission === permission)
    : config.tools;

  const lines: string[] = [];

  for (const tool of tools) {
    lines.push(`- ${tool.name}: ${tool.description}`);

    // Add parameter info
    if (tool.parameters.length > 0) {
      const paramList = tool.parameters
        .map((p) => `${p.name}${p.required ? " (required)" : ""}`)
        .join(", ");
      lines.push(`  Parameters: ${paramList}`);
    }
  }

  return lines.join("\n");
}
