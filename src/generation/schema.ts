/**
 * Service Configuration Schema
 *
 * Zod schemas for validating JSON service configuration files.
 * These configs define tools and their permissions for dynamic agent generation.
 *
 * Services can be defined using:
 * 1. CLI execution - tools invoke CLI commands
 * 2. Filesystem operations - tools read/write files directly
 * 3. Service methods (legacy) - tools call TypeScript service class methods
 */

import { z } from "zod";

// ============================================================================
// Parameter Schema
// ============================================================================

/**
 * Supported parameter types for tool definitions
 */
export const ParameterTypeSchema = z.enum([
  "string",
  "number",
  "boolean",
  "string[]",
  "number[]",
  "object",
]);

export type ParameterType = z.infer<typeof ParameterTypeSchema>;

/**
 * A single parameter definition for a tool
 */
export const ParameterSchema = z.object({
  /** Parameter name (used in Zod schema) */
  name: z.string(),
  /** Parameter type */
  type: ParameterTypeSchema,
  /** Whether the parameter is required */
  required: z.boolean().optional().default(false),
  /** Description for the AI model */
  description: z.string(),
  /** Default value if not provided */
  default: z.unknown().optional(),
  /** Minimum value (for numbers) */
  min: z.number().optional(),
  /** Maximum value (for numbers) */
  max: z.number().optional(),
  /** Enum values (for strings) */
  enum: z.array(z.string()).optional(),
});

export type Parameter = z.infer<typeof ParameterSchema>;

// ============================================================================
// Tool Schema
// ============================================================================

/**
 * Permission type for a tool
 */
export const ToolPermissionSchema = z.enum(["READ", "WRITE"]);

export type ToolPermission = z.infer<typeof ToolPermissionSchema>;

// ============================================================================
// CLI Execution Schema
// ============================================================================

/**
 * Service-level CLI configuration
 * Defines the CLI executable and global options
 */
export const ServiceCliSchema = z.object({
  /** CLI executable (e.g., "gog", "obs") */
  executable: z.string(),
  /** Service subcommand (e.g., "gmail" for "gog gmail") */
  service: z.string().optional(),
  /** Output format (typically "json") */
  outputFormat: z.enum(["json", "jsonl", "text"]).optional().default("json"),
  /** Global flags added to all commands (e.g., ["--json"]) */
  globalFlags: z.array(z.string()).optional(),
  /** Config paths to substitute as global flags (e.g., { "account": "google.account" }) */
  globalConfig: z.record(z.string()).optional(),
});

export type ServiceCli = z.infer<typeof ServiceCliSchema>;

/**
 * Tool-level CLI configuration
 * Defines the specific command and arguments for a tool
 */
export const ToolCliSchema = z.object({
  /** Command name (e.g., "search", "get") */
  command: z.string(),
  /** Positional arguments with param interpolation (e.g., ["{query}"]) */
  args: z.array(z.string()).optional(),
  /** Flag mappings (e.g., { "max": "--max {max}" }) */
  flags: z.record(z.string()).optional(),
  /** Parameter name to pipe to stdin (e.g., "data" to pipe the data param as stdin) */
  stdin: z.string().optional(),
});

export type ToolCli = z.infer<typeof ToolCliSchema>;

// ============================================================================
// Filesystem Operation Schema
// ============================================================================

/**
 * Service-level filesystem configuration
 * Defines the base path and file extension for filesystem operations
 */
export const ServiceFilesystemSchema = z.object({
  /** Config path to resolve base directory (e.g., "obsidian.vaultPath") */
  basePath: z.string(),
  /** Default file extension (e.g., ".md") */
  extension: z.string().optional(),
});

export type ServiceFilesystem = z.infer<typeof ServiceFilesystemSchema>;

/**
 * Tool-level filesystem configuration
 * Defines the specific operation and path pattern
 */
export const ToolFilesystemSchema = z.object({
  /** Operation type */
  operation: z.enum(["read", "write", "append", "delete", "list", "search", "searchContent"]),
  /** Path pattern with param interpolation (e.g., "{notePath}") */
  path: z.string().optional(),
  /** Parameter name containing content for write/append operations */
  contentParam: z.string().optional(),
  /** Parameter name containing search query */
  queryParam: z.string().optional(),
  /** Parameter name for limit */
  limitParam: z.string().optional(),
});

export type ToolFilesystem = z.infer<typeof ToolFilesystemSchema>;

// ============================================================================
// Output Schema
// ============================================================================

/**
 * Field truncation configuration
 */
export const TruncateFieldSchema = z.object({
  /** Field path to truncate (supports nested paths like "messages.body") */
  field: z.string(),
  /** Maximum length before truncation */
  maxLength: z.number(),
  /** Suffix to add when truncated (default: "...") */
  suffix: z.string().optional().default("..."),
});

export type TruncateField = z.infer<typeof TruncateFieldSchema>;

/**
 * Output extraction/transformation configuration
 */
export const OutputSchema = z.object({
  /** JSON path to extract from output (e.g., "threads", "messages[0]") */
  extract: z.string().optional(),
  /** jq-style transformation expression */
  transform: z.string().optional(),
  /** Fields to truncate (for reducing token usage with large content) */
  truncateFields: z.array(TruncateFieldSchema).optional(),
  /** Fields to omit entirely from output */
  omitFields: z.array(z.string()).optional(),
});

export type OutputConfig = z.infer<typeof OutputSchema>;

// ============================================================================
// Tool Schema
// ============================================================================

/**
 * A single tool definition
 */
export const ToolSchema = z.object({
  /** Tool name (e.g., "gmail_searchEmails") */
  name: z.string(),
  /** Tool description for the AI model */
  description: z.string(),
  /** Permission type - determines which agent gets this tool */
  permission: ToolPermissionSchema,
  /** Service method name to call (legacy - for TypeScript service classes) */
  method: z.string().optional(),
  /** CLI execution configuration (for CLI-based tools) */
  cli: ToolCliSchema.optional(),
  /** Filesystem operation configuration (for filesystem-based tools) */
  filesystem: ToolFilesystemSchema.optional(),
  /** Output extraction/transformation */
  output: OutputSchema.optional(),
  /** Parameter definitions */
  parameters: z.array(ParameterSchema),
});

export type ToolDefinition = z.infer<typeof ToolSchema>;

// ============================================================================
// Service Schema
// ============================================================================

/**
 * Service module configuration (legacy - for TypeScript service classes)
 */
export const ServiceModuleSchema = z.object({
  /** Path to the service module (relative to src/) */
  module: z.string(),
  /** Class name to instantiate */
  class: z.string(),
  /** Function name to check if service is configured (legacy) */
  configCheck: z.string().optional(),
});

export type ServiceModule = z.infer<typeof ServiceModuleSchema>;

/**
 * Agent type for explicit agent generation control
 */
export const AgentTypeSchema = z.enum(["READ", "WRITE", "READ_WRITE"]);

export type AgentType = z.infer<typeof AgentTypeSchema>;

/**
 * Full service configuration
 */
export const ServiceConfigSchema = z.object({
  /** Unique service identifier (e.g., "google-gmail") */
  id: z.string(),
  /** Human-readable service name (e.g., "Gmail") */
  name: z.string(),
  /** Whether to also generate a READ_WRITE agent when both tool types exist (legacy, use agentTypes instead) */
  generateReadWrite: z.boolean().optional().default(false),
  /** Explicit agent types to generate. Overrides default behavior when specified.
   *  - ["READ", "WRITE"] - separate reader and writer agents (default when both tool types exist)
   *  - ["READ_WRITE"] - single agent with all tools
   *  - ["READ"] or ["WRITE"] - single agent with that permission type
   */
  agentTypes: z.array(AgentTypeSchema).optional(),
  /** Config paths that must exist for this service to be enabled (e.g., ["google.account"]) */
  requiredConfig: z.array(z.string()).optional(),
  /** Service module configuration (legacy - for TypeScript service classes) */
  service: ServiceModuleSchema.optional(),
  /** CLI configuration (for CLI-based tools) */
  cli: ServiceCliSchema.optional(),
  /** Filesystem configuration (for filesystem-based tools) */
  filesystem: ServiceFilesystemSchema.optional(),
  /** Tool definitions */
  tools: z.array(ToolSchema),
});

export type ServiceConfig = z.infer<typeof ServiceConfigSchema>;

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Validate a service config JSON
 * @param json - Raw JSON object
 * @returns Validated ServiceConfig
 * @throws ZodError if validation fails
 */
export function validateServiceConfig(json: unknown): ServiceConfig {
  return ServiceConfigSchema.parse(json);
}

/**
 * Safe validation that returns result instead of throwing
 * @param json - Raw JSON object
 * @returns Validation result with success flag
 */
export function safeValidateServiceConfig(json: unknown): {
  success: boolean;
  data?: ServiceConfig;
  error?: z.ZodError;
} {
  const result = ServiceConfigSchema.safeParse(json);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}
