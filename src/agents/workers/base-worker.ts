/**
 * Base Worker Template
 *
 * Provides the foundation for isolated agent workers with strict permission enforcement.
 * Workers run in separate Bun Worker threads for process isolation.
 */

// Declare worker globals for TypeScript
declare const self: Worker & {
  close(): void;
};

import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import {
  createSealedBox,
  openSealedBox,
  createIntegrityProof,
  createMultiRecipientSealedBoxes,
} from "../../crypto";
import type { SealedBox } from "../../crypto";
import type {
  AgentPermission,
  EncryptedPackage,
  WorkerInitMessage,
  WorkerTaskMessage,
  WorkerResultMessage,
  WorkerErrorMessage,
  WorkerEscalationMessage,
  WorkerEscalationResponseMessage,
  AnyWorkerMessage,
  EscalationResolution,
  IntentContext,
} from "../types";
import {
  getHardenedSystemPrompt,
  requiresSecurityHardening,
  getIntentAwareSecurityPrompt,
} from "../security-prompts";
import {
  validateToolAgainstIntent,
  IntentViolationError,
} from "../intent";
import type { ReadWriteSecurityController } from "../read-write-security";
import { getLogger } from "../../services/logger";

/**
 * Worker configuration received during initialization
 */
export interface WorkerConfig {
  agentId: string;
  agentName: string;
  permission: AgentPermission;
  secretKey: string;
  recipientPublicKeys: Record<string, string>;
  openaiApiKey?: string;
  /** Dynamic config for JSON-defined workers (optional) */
  dynamicConfig?: {
    serviceConfig: unknown;
    toolNames: string[];
    expectedPermission: AgentPermission;
    /** Model ID to use (from LLM config based on permission) */
    modelId?: string;
  };
}

/**
 * Response from an escalation request
 */
export interface EscalationResponse {
  resolution: EscalationResolution;
  content?: string;
  respondedBy: "user" | "orchestrator";
  denialReason?: string;
}

/**
 * Result from processing a task
 */
export interface TaskResult {
  // The actual content (gets encrypted)
  content: string;
  // Brief summary for orchestrator (stays unencrypted)
  // Should report metadata (counts, titles) not sensitive content
  // Good: "Found 5 emails with action items"
  // Bad: "Found email from John about salary negotiation"
  outcomeSummary: string;
}

/**
 * Pending escalation tracker
 */
interface PendingEscalation {
  resolve: (response: EscalationResponse) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

/**
 * Abstract base class for agent workers
 *
 * Subclasses must implement the processTask method to define
 * their specific behavior.
 */
export abstract class BaseAgentWorker {
  protected config: WorkerConfig | null = null;
  protected initialized = false;
  private pendingEscalations: Map<string, PendingEscalation> = new Map();
  private currentTaskId: string | null = null;
  // Intent context for the current task (security validation)
  protected currentIntentContext: IntentContext | null = null;
  // Security controller for READ_WRITE agents (optional)
  protected securityController: ReadWriteSecurityController | null = null;

  constructor() {
    this.setupMessageHandler();
  }

  /**
   * Set up the message handler for the worker
   */
  private setupMessageHandler(): void {
    self.onmessage = async (event: MessageEvent<AnyWorkerMessage>) => {
      const message = event.data;

      try {
        switch (message.type) {
          case "init":
            await this.handleInit(message);
            break;
          case "task":
            await this.handleTask(message);
            break;
          case "shutdown":
            this.handleShutdown();
            break;
          case "escalation_response":
            this.handleEscalationResponse(message as WorkerEscalationResponseMessage);
            break;
          default:
            this.sendError("UNKNOWN_MESSAGE", `Unknown message type: ${(message as AnyWorkerMessage).type}`);
        }
      } catch (error) {
        this.sendError(
          "HANDLER_ERROR",
          error instanceof Error ? error.message : "Unknown error"
        );
      }
    };
  }

  /**
   * Handle initialization message
   */
  private async handleInit(message: WorkerInitMessage): Promise<void> {
    this.config = {
      agentId: message.config.agentId,
      agentName: message.config.agentName,
      permission: message.config.permission,
      secretKey: message.config.secretKey,
      recipientPublicKeys: message.config.recipientPublicKeys,
      openaiApiKey: process.env.OPENAI_API_KEY,
      dynamicConfig: message.config.dynamicConfig,
    };

    // Call subclass initialization hook (for dynamic workers)
    await this.onInit();

    // Validate permission
    this.validatePermission();

    this.initialized = true;

    // Send acknowledgment
    self.postMessage({
      type: "result",
      id: message.id,
      timestamp: Date.now(),
      result: {
        success: true,
      },
    } satisfies WorkerResultMessage);
  }

  /**
   * Handle task message
   */
  private async handleTask(message: WorkerTaskMessage): Promise<void> {
    if (!this.initialized || !this.config) {
      this.sendError("NOT_INITIALIZED", "Worker not initialized");
      return;
    }

    // Track current task for escalation context
    this.currentTaskId = message.id;

    // Store intent context for validation during task execution
    this.currentIntentContext = message.task.intentContext || null;

    try {
      // Process the task based on permission type
      let inputContent: string;

      if (this.config.permission === "READ") {
        // READ agents receive plain text input
        if (typeof message.task.input !== "string") {
          throw new Error("READ agent expected string input");
        }
        inputContent = message.task.input;
      } else if (this.config.permission === "READ_WRITE") {
        // READ_WRITE agents can receive either plain text or encrypted packages
        if (typeof message.task.input === "string") {
          // Direct delegation - plain text input
          inputContent = message.task.input;
        } else {
          // Routed package - decrypt sealed box
          const pkg = message.task.input;
          const sealedBox = pkg.sealedBoxes[this.config.agentId];
          if (!sealedBox) {
            throw new Error("No sealed box for this agent in package");
          }
          inputContent = openSealedBox(sealedBox, this.config.secretKey);
        }
      } else {
        // WRITE agents receive encrypted packages
        if (typeof message.task.input === "string") {
          throw new Error("WRITE agent expected encrypted package input");
        }
        // Decrypt the sealed box for this agent
        const pkg = message.task.input;
        const sealedBox = pkg.sealedBoxes[this.config.agentId];
        if (!sealedBox) {
          throw new Error("No sealed box for this agent in package");
        }
        inputContent = openSealedBox(sealedBox, this.config.secretKey);
      }

      // Process the task (implemented by subclass)
      const result = await this.processTask(
        message.task.description,
        inputContent,
        message.task.originalRequest
      );

      // Create encrypted package for output
      const pkg = this.createOutputPackage(
        result.content,
        message.task.originalRequest,
        message.task.requestHash,
        message.task.outputRecipients
      );

      // Send result with outcome summary
      self.postMessage({
        type: "result",
        id: message.id,
        timestamp: Date.now(),
        result: {
          success: true,
          package: pkg,
          outcomeSummary: result.outcomeSummary,
        },
      } satisfies WorkerResultMessage);
    } catch (error) {
      this.sendError(
        "TASK_ERROR",
        error instanceof Error ? error.message : "Task processing failed"
      );
    }
  }

  /**
   * Handle shutdown message
   */
  private handleShutdown(): void {
    // Cleanup if needed
    self.close();
  }

  /**
   * Validate that the worker's permission is correctly configured
   */
  private validatePermission(): void {
    if (!this.config) return;

    const expectedPermission = this.getExpectedPermission();
    if (this.config.permission !== expectedPermission) {
      getLogger().logPermission({
        type: "permission_check",
        source: "base-worker",
        agentId: this.config.agentId,
        allowed: false,
        severity: "block",
        details: {
          reason: "permission_mismatch",
          expectedPermission,
          actualPermission: this.config.permission,
          agentName: this.config.agentName,
        },
      });
      throw new Error(
        `Permission mismatch: worker expects ${expectedPermission}, got ${this.config.permission}`
      );
    }

    getLogger().logPermission({
      type: "permission_check",
      source: "base-worker",
      agentId: this.config.agentId,
      allowed: true,
      severity: "info",
      details: {
        reason: "permission_validated",
        permission: this.config.permission,
        agentName: this.config.agentName,
      },
    });
  }

  /**
   * Create an encrypted output package
   */
  protected createOutputPackage(
    content: string,
    originalRequest: string,
    requestHash: string,
    recipientIds: string[]
  ): EncryptedPackage {
    if (!this.config) {
      throw new Error("Worker not initialized");
    }

    // Ensure orchestrator is always included as a recipient
    // This allows orchestrator to decrypt after intent verification
    const allRecipientIds = [...recipientIds];
    if (!allRecipientIds.includes("orchestrator")) {
      allRecipientIds.push("orchestrator");
    }

    // Create sealed boxes for each recipient
    const sealedBoxes: Record<string, SealedBox> = {};
    for (const recipientId of allRecipientIds) {
      const publicKey = this.config.recipientPublicKeys[recipientId];
      if (publicKey) {
        sealedBoxes[recipientId] = createSealedBox(content, publicKey);
      }
    }

    // Create integrity proof
    const integrityProof = createIntegrityProof(
      originalRequest,
      content,
      this.config.agentId,
      this.config.secretKey
    );

    return {
      id: crypto.randomUUID(),
      sourceAgentId: this.config.agentId,
      sealedBoxes,
      integrityProof,
      requestHash,
      createdAt: Date.now(),
    };
  }

  /**
   * Send an error message
   */
  protected sendError(code: string, message: string, details?: unknown): void {
    self.postMessage({
      type: "error",
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      error: {
        code,
        message,
        details,
      },
    } satisfies WorkerErrorMessage);
  }

  /**
   * Request escalation to the orchestrator
   *
   * Use this when the worker needs information or decisions that weren't
   * part of the original task. The user will see the request text and can:
   * - Approve: Forward to orchestrator
   * - Deny: Reject the request
   * - Respond directly: Provide the answer immediately
   *
   * @param requestText - The message to send (user sees and approves this exact text)
   * @param reason - Brief context for why this escalation is needed
   * @param options - Optional configuration (timeout defaults to 5 minutes)
   * @returns Promise resolving to the escalation response
   */
  protected async requestEscalation(
    requestText: string,
    reason: string,
    options?: { timeout?: number }
  ): Promise<EscalationResponse> {
    if (!this.initialized || !this.config) {
      throw new Error("Worker not initialized");
    }

    const escalationId = crypto.randomUUID();
    const timeout = options?.timeout ?? 5 * 60 * 1000; // 5 minutes default

    return new Promise<EscalationResponse>((resolve, reject) => {
      // Set up timeout
      const timeoutId = setTimeout(() => {
        const pending = this.pendingEscalations.get(escalationId);
        if (pending) {
          this.pendingEscalations.delete(escalationId);
          resolve({
            resolution: "timeout",
            respondedBy: "user",
          });
        }
      }, timeout);

      // Track the pending escalation
      this.pendingEscalations.set(escalationId, {
        resolve,
        reject,
        timeoutId,
      });

      // Send escalation message to parent
      const message: WorkerEscalationMessage = {
        type: "escalation",
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        escalation: {
          escalationId,
          requestText,
          reason,
          originalTaskId: this.currentTaskId || "",
        },
      };

      self.postMessage(message);
    });
  }

  /**
   * Handle escalation response from parent
   */
  private handleEscalationResponse(message: WorkerEscalationResponseMessage): void {
    const { escalationId, resolution, content, respondedBy, denialReason } = message.response;
    const pending = this.pendingEscalations.get(escalationId);

    if (pending) {
      clearTimeout(pending.timeoutId);
      this.pendingEscalations.delete(escalationId);

      pending.resolve({
        resolution,
        content,
        respondedBy,
        denialReason,
      });
    }
  }

  /**
   * Get the OpenAI provider for LLM calls
   */
  protected getOpenAI() {
    if (!this.config?.openaiApiKey) {
      throw new Error("OpenAI API key not configured");
    }
    return createOpenAI({
      apiKey: this.config.openaiApiKey,
    });
  }

  /**
   * Validate a tool call against the current intent context.
   * Call this before executing any tool that may have security implications.
   *
   * For READ_WRITE agents with a security controller, this provides two-layer validation:
   * 1. Security controller validation (sub-intent + orchestrator intent)
   * 2. Fallback to direct intent context validation
   *
   * @param toolName - Name of the tool being called
   * @param args - Arguments to the tool
   * @returns true if allowed, throws IntentViolationError if blocked
   */
  protected validateToolCall(
    toolName: string,
    args: Record<string, unknown>
  ): boolean {
    // Layer 1: Use security controller if available (READ_WRITE agents)
    if (this.securityController) {
      const result = this.securityController.validateToolCall(toolName, args);

      if (!result.allowed && result.severity === "block") {
        getLogger().logPermission({
          type: "tool_validation",
          source: "base-worker",
          agentId: this.config?.agentId,
          allowed: false,
          severity: "block",
          details: {
            layer: "security_controller",
            toolName,
            errorCode: result.errorCode,
            message: result.message,
            violations: result.violations,
          },
        });
        throw new IntentViolationError(
          `Tool "${toolName}" blocked by security controller: ${result.message}`,
          result.errorCode || "UNAUTHORIZED_WRITE",
          result.violations
        );
      }

      // Log warnings
      if (!result.allowed && result.severity === "warn") {
        console.warn(`[Security Controller Warning] Tool ${toolName}: ${result.message}`);
        getLogger().logPermission({
          type: "security_warning",
          source: "base-worker",
          agentId: this.config?.agentId,
          allowed: true,
          severity: "warn",
          details: {
            layer: "security_controller",
            toolName,
            message: result.message,
            violations: result.violations,
          },
        });
      }

      // Security controller handles both sub-intent and orchestrator validation
      return result.allowed || result.severity !== "block";
    }

    // Layer 2: Fallback to direct intent context validation (non-READ_WRITE agents)
    if (!this.currentIntentContext) {
      return true;
    }

    const result = validateToolAgainstIntent(
      toolName,
      args,
      this.currentIntentContext
    );

    if (!result.allowed && result.severity === "block") {
      getLogger().logPermission({
        type: "tool_validation",
        source: "base-worker",
        agentId: this.config?.agentId,
        allowed: false,
        severity: "block",
        details: {
          layer: "intent_context",
          toolName,
          errorCode: result.errorCode,
          message: result.message,
          violations: result.violations,
        },
      });
      throw new IntentViolationError(
        `Tool "${toolName}" blocked by intent validation: ${result.message}`,
        result.errorCode || "UNAUTHORIZED_WRITE",
        result.violations
      );
    }

    // Log warnings
    if (!result.allowed && result.severity === "warn") {
      console.warn(`[Intent Warning] Tool ${toolName}: ${result.message}`);
      getLogger().logPermission({
        type: "security_warning",
        source: "base-worker",
        agentId: this.config?.agentId,
        allowed: true,
        severity: "warn",
        details: {
          layer: "intent_context",
          toolName,
          message: result.message,
          violations: result.violations,
        },
      });
    }

    return result.allowed || result.severity !== "block";
  }

  /**
   * Get the current intent context (if any)
   */
  protected getIntentContext(): IntentContext | null {
    return this.currentIntentContext;
  }

  /**
   * Set the security controller for READ_WRITE agents.
   * The security controller provides two-layer validation:
   * 1. Orchestrator's intent (user-level permissions)
   * 2. Agent's sub-intent (task-level scope)
   *
   * @param controller - The ReadWriteSecurityController instance
   */
  protected setSecurityController(controller: ReadWriteSecurityController): void {
    this.securityController = controller;
  }

  /**
   * Get the security controller (if any)
   */
  protected getSecurityController(): ReadWriteSecurityController | null {
    return this.securityController;
  }

  /**
   * Get the system prompt for this worker, with security hardening if needed.
   * READ agents automatically receive hardened prompts (all content is treated as dangerous).
   * If intent context is available, it's included in the security prompt.
   *
   * @param basePrompt - The agent's base system prompt
   * @returns The system prompt, with security directives prepended for READ agents
   */
  protected getSystemPrompt(basePrompt: string): string {
    if (!this.config) {
      return basePrompt;
    }
    if (requiresSecurityHardening(this.config.permission)) {
      // Use intent-aware prompt if intent context is available
      if (this.currentIntentContext) {
        return getIntentAwareSecurityPrompt(basePrompt, this.currentIntentContext.intent);
      }
      return getHardenedSystemPrompt(basePrompt);
    }
    return basePrompt;
  }

  /**
   * Initialization hook for subclasses
   * Called during handleInit before permission validation
   * Dynamic workers use this to set up tools from config
   */
  protected async onInit(): Promise<void> {
    // Default implementation does nothing
    // Subclasses can override to perform custom initialization
  }

  /**
   * Get the expected permission for this worker type
   * Subclasses must implement this
   */
  protected abstract getExpectedPermission(): AgentPermission;

  /**
   * Process a task and return the result
   * Subclasses must implement this
   *
   * @param taskDescription - Description of the task to perform
   * @param inputContent - Input content (plain text for READ, decrypted for WRITE)
   * @param originalRequest - The original user request (for context)
   * @returns TaskResult with content (encrypted) and outcomeSummary (stays unencrypted)
   */
  protected abstract processTask(
    taskDescription: string,
    inputContent: string,
    originalRequest: string
  ): Promise<TaskResult>;
}

/**
 * Helper to create a worker script that initializes an agent worker
 */
export function createWorkerScript(workerClass: string): string {
  return `
    import { ${workerClass} } from "./src/agents/workers/${workerClass.toLowerCase().replace("worker", "-worker")}.ts";
    new ${workerClass}();
  `;
}
