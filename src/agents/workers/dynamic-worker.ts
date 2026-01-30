/**
 * Dynamic Worker
 *
 * A generic worker that processes tasks using tools defined in JSON configuration.
 * This worker receives its configuration via the init message and generates tools
 * dynamically at runtime.
 *
 * Supports three execution modes:
 * 1. CLI-based tools - commands defined in JSON
 * 2. Filesystem-based tools - file operations defined in JSON
 * 3. Service method tools (legacy) - TypeScript service classes
 *
 * SECURITY: Follows the same security model as other workers:
 * - READ agents receive hardened security prompts
 * - WRITE agents receive encrypted input
 * - READ_WRITE agents have both capabilities
 */

import { generateText, type CoreTool } from "ai";
import { BaseAgentWorker, type TaskResult } from "./base-worker";
import type { AgentPermission } from "../types";
import type { ServiceConfig } from "../../generation/schema";
import {
  generateToolsForService,
  generateAllToolsForService,
  createExecutionContext,
  generateOutcomeSummary,
  getToolsDescription,
  type ServiceInstance,
  type ToolExecutionContext,
} from "../../generation/tool-generator";
import { createJqTool } from "../../generation/jq-tool";

// ============================================================================
// Service Registry
// ============================================================================

/**
 * Registry of service classes that can be instantiated
 * Maps module paths to service constructors
 */
type ServiceConstructor = new () => ServiceInstance;

const serviceRegistry: Map<string, ServiceConstructor> = new Map();

/**
 * Register a service class for dynamic instantiation
 *
 * @param modulePath - The module path from service config (e.g., "./services/google/gmail")
 * @param constructor - The service class constructor
 */
export function registerServiceClass(
  modulePath: string,
  constructor: ServiceConstructor
): void {
  serviceRegistry.set(modulePath, constructor);
}

/**
 * Get a service constructor from the registry
 */
function getServiceConstructor(modulePath: string): ServiceConstructor | undefined {
  return serviceRegistry.get(modulePath);
}

// ============================================================================
// Dynamic Worker Class
// ============================================================================

/**
 * Dynamic Worker
 *
 * A generic worker that:
 * 1. Receives service configuration during initialization (via init message)
 * 2. Instantiates the service class dynamically
 * 3. Generates tools from JSON definitions
 * 4. Adds the built-in jq tool for data transformation
 * 5. Processes tasks using generateText()
 */
class DynamicWorker extends BaseAgentWorker {
  private serviceConfig: ServiceConfig | null = null;
  private expectedPermission: AgentPermission = "READ";
  private toolNames: string[] = [];
  private serviceInstance: ServiceInstance | null = null;
  private tools: Record<string, CoreTool> = {};
  private executionContext: ToolExecutionContext | null = null;
  private modelId: string = "gpt-5-mini"; // Default fallback

  constructor() {
    super();
  }

  /**
   * Called during init to set up dynamic configuration
   */
  protected async onInit(): Promise<void> {
    if (!this.config?.dynamicConfig) {
      console.error("[DynamicWorker] No dynamic config provided");
      return;
    }

    // Extract dynamic config
    this.serviceConfig = this.config.dynamicConfig.serviceConfig as ServiceConfig;
    this.toolNames = this.config.dynamicConfig.toolNames;
    this.expectedPermission = this.config.dynamicConfig.expectedPermission;
    this.modelId = this.config.dynamicConfig.modelId || "gpt-5-mini";

    // Initialize tools
    await this.initializeTools();
  }

  /**
   * Initialize tools from configuration
   *
   * Supports:
   * 1. CLI-based tools - no service instance needed
   * 2. Filesystem-based tools - no service instance needed
   * 3. Service method tools (legacy) - requires service instance
   */
  private async initializeTools(): Promise<void> {
    if (!this.serviceConfig) {
      return;
    }

    try {
      // Only instantiate service class if using legacy mode (service module defined)
      // New CLI/filesystem modes don't need a service instance
      if (this.serviceConfig.service?.module) {
        const Constructor = getServiceConstructor(this.serviceConfig.service.module);
        if (Constructor) {
          this.serviceInstance = new Constructor();
        } else {
          // Service class not found - only warn if not using CLI/filesystem mode
          if (!this.serviceConfig.cli && !this.serviceConfig.filesystem) {
            console.error(
              `[DynamicWorker] Service constructor not found for module: ${this.serviceConfig.service.module}`
            );
            return;
          }
        }
      }

      // Generate tools based on permission
      // The tool generator handles CLI, filesystem, and legacy modes
      if (this.expectedPermission === "READ_WRITE") {
        this.tools = generateAllToolsForService(
          this.serviceConfig,
          this.serviceInstance,
          this.executionContext || undefined
        );
      } else if (this.expectedPermission === "READ") {
        this.tools = generateToolsForService(
          this.serviceConfig,
          "READ",
          this.serviceInstance,
          this.executionContext || undefined
        );
      } else {
        this.tools = generateToolsForService(
          this.serviceConfig,
          "WRITE",
          this.serviceInstance,
          this.executionContext || undefined
        );
      }

      // Filter to only requested tools if specified
      if (this.toolNames.length > 0) {
        const toolSet = new Set(this.toolNames);
        const filteredTools: Record<string, CoreTool> = {};
        for (const [name, tool] of Object.entries(this.tools)) {
          if (toolSet.has(name)) {
            filteredTools[name] = tool;
          }
        }
        this.tools = filteredTools;
      }

      // Add built-in jq tool
      this.tools["jq"] = createJqTool();

      console.log(
        `[DynamicWorker] Initialized ${Object.keys(this.tools).length} tools for ${this.serviceConfig.id}`
      );
    } catch (error) {
      console.error(
        `[DynamicWorker] Failed to initialize tools: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Get the expected permission for this worker
   */
  protected getExpectedPermission(): AgentPermission {
    return this.expectedPermission;
  }

  /**
   * Process a task using the dynamically generated tools
   */
  protected async processTask(
    taskDescription: string,
    inputContent: string,
    originalRequest: string
  ): Promise<TaskResult> {
    if (!this.serviceConfig || Object.keys(this.tools).length === 0) {
      return {
        content: "Worker not properly initialized with tools",
        outcomeSummary: "Initialization error",
      };
    }

    const openai = this.getOpenAI();

    // Create fresh execution context for tracking
    this.executionContext = createExecutionContext();

    // Build system prompt
    const toolsDescription = getToolsDescription(
      this.serviceConfig,
      this.expectedPermission === "READ_WRITE" ? undefined : this.expectedPermission
    );

    const basePrompt = `You are a ${this.serviceConfig.name} assistant with access to the following tools:

${toolsDescription}

Additionally, you have a "jq" tool for transforming and filtering JSON data.

Guidelines:
- Use the appropriate tools to complete the user's request
- For READ operations, retrieve and summarize information objectively
- For WRITE operations, execute the requested actions carefully
- Use the jq tool to filter or transform data when needed
- Report results clearly and concisely
- Focus on actionable information and key details`;

    // Use the security-hardened prompt for READ agents
    const systemPrompt = this.getSystemPrompt(basePrompt);

    // Process with LLM (use configured model based on permission type)
    const result = await generateText({
      model: openai(this.modelId),
      system: systemPrompt,
      prompt: `Task: ${taskDescription}\n\nContext: ${originalRequest}\n\nInput: ${inputContent}`,
      tools: this.tools,
      maxSteps: 15,
    });

    // Generate outcome summary
    const outcomeSummary = generateOutcomeSummary(
      this.executionContext,
      this.serviceConfig.name
    );

    return {
      content: result.text,
      outcomeSummary,
    };
  }
}

// ============================================================================
// Service Registration
// ============================================================================

// Import and register services
async function registerServices(): Promise<void> {
  // Register Obsidian service
  try {
    const { ObsidianService } = await import("../../services/obsidian");
    registerServiceClass("./services/obsidian", ObsidianService as unknown as ServiceConstructor);
  } catch (error) {
    console.warn(
      `[DynamicWorker] Failed to register Obsidian service: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  // Register Google services
  try {
    const { GmailService } = await import("../../services/google/gmail");
    registerServiceClass("./services/google/gmail", GmailService as unknown as ServiceConstructor);

    const { GoogleCalendarService } = await import("../../services/google/calendar");
    registerServiceClass("./services/google/calendar", GoogleCalendarService as unknown as ServiceConstructor);

    const { GoogleContactsService } = await import("../../services/google/contacts");
    registerServiceClass("./services/google/contacts", GoogleContactsService as unknown as ServiceConstructor);

    const { GoogleDriveService } = await import("../../services/google/drive");
    registerServiceClass("./services/google/drive", GoogleDriveService as unknown as ServiceConstructor);

    const { GoogleDocsService } = await import("../../services/google/docs");
    registerServiceClass("./services/google/docs", GoogleDocsService as unknown as ServiceConstructor);

    const { GoogleSheetsService } = await import("../../services/google/sheets");
    registerServiceClass("./services/google/sheets", GoogleSheetsService as unknown as ServiceConstructor);

    const { GoogleKeepService } = await import("../../services/google/keep");
    registerServiceClass("./services/google/keep", GoogleKeepService as unknown as ServiceConstructor);

    const { GoogleChatService } = await import("../../services/google/chat");
    registerServiceClass("./services/google/chat", GoogleChatService as unknown as ServiceConstructor);
  } catch (error) {
    console.warn(
      `[DynamicWorker] Failed to register Google services: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

// Register services when module loads
registerServices();

// ============================================================================
// Worker Initialization
// ============================================================================

// Initialize the worker
new DynamicWorker();

export { DynamicWorker };
