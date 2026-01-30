/**
 * User Intent Security System
 *
 * Provides intent extraction, validation, and enforcement to prevent
 * malicious content from manipulating agents into performing actions
 * inconsistent with the user's original request.
 */

import { hashContent } from "../crypto";
import { getLogger } from "../services/logger";
import type {
  UserIntent,
  IntentCategory,
  IntentConfidence,
  IntentPermissions,
  IntentValidationResult,
  IntentValidationErrorCode,
  IntentValidationSeverity,
  IntentEntity,
  IntentScope,
  PlanStep,
  StepPermissions,
  IntentContext,
  ExplicitPermissions,
} from "./types";

// ============================================================================
// Configuration
// ============================================================================

/**
 * Configuration for intent validation behavior
 */
export interface IntentValidationConfig {
  /**
   * Strictness level for validation:
   * - strict: Block any operation not explicitly in intent
   * - moderate: Block unauthorized writes, warn on reads outside scope
   * - permissive: Warn only, let user decide
   */
  strictness: "strict" | "moderate" | "permissive";
}

/**
 * Default configuration - moderate strictness
 */
export const DEFAULT_INTENT_CONFIG: IntentValidationConfig = {
  strictness: "moderate",
};

/**
 * Get intent validation config from environment or use default
 */
export function getIntentValidationConfig(): IntentValidationConfig {
  const strictness = process.env.INTENT_VALIDATION_STRICTNESS;
  if (
    strictness === "strict" ||
    strictness === "moderate" ||
    strictness === "permissive"
  ) {
    return { strictness };
  }
  return DEFAULT_INTENT_CONFIG;
}

// ============================================================================
// Intent Construction
// ============================================================================

/**
 * LLM output schema for intent extraction (used with createPlan tool)
 */
export interface LLMIntentOutput {
  category: IntentCategory;
  confidence: IntentConfidence;
  summary: string;
  allowedDataSources: string[];
  allowedWriteDestinations: string[];
  explicitlyAllowed: Partial<ExplicitPermissions>;
  explicitlyForbidden: string[];
  goals: string[];
  constraints: string[];
  entities: IntentEntity[];
  scope: IntentScope;
  // NEW: Can intent be determined without seeing encrypted content?
  canExtractIntent?: boolean;
  // NEW: If not extractable, why? (shown to user when asking for clarification)
  clarificationNeeded?: string;
}

/**
 * Build a UserIntent from LLM plan output
 *
 * @param originalMessage - The user's original request
 * @param llmOutput - Intent data extracted by the LLM during plan creation
 * @returns Complete UserIntent object
 */
export function buildUserIntentFromPlan(
  originalMessage: string,
  llmOutput: LLMIntentOutput
): UserIntent {
  const messageHash = hashContent(originalMessage);

  // Fill in default values for explicitlyAllowed
  const explicitlyAllowed: ExplicitPermissions = {
    sendEmail: llmOutput.explicitlyAllowed.sendEmail ?? false,
    createDocument: llmOutput.explicitlyAllowed.createDocument ?? false,
    submitForm: llmOutput.explicitlyAllowed.submitForm ?? false,
    makePayment: llmOutput.explicitlyAllowed.makePayment ?? false,
    deleteContent: llmOutput.explicitlyAllowed.deleteContent ?? false,
    shareContent: llmOutput.explicitlyAllowed.shareContent ?? false,
  };

  const permissions: IntentPermissions = {
    allowedDataSources: llmOutput.allowedDataSources,
    allowedWriteDestinations: llmOutput.allowedWriteDestinations,
    explicitlyAllowed,
    explicitlyForbidden: llmOutput.explicitlyForbidden,
  };

  return {
    id: crypto.randomUUID(),
    originalMessage,
    messageHash,
    extractedAt: Date.now(),
    category: llmOutput.category,
    confidence: llmOutput.confidence,
    summary: llmOutput.summary,
    permissions,
    goals: llmOutput.goals,
    constraints: llmOutput.constraints,
    entities: llmOutput.entities,
    scope: llmOutput.scope,
    // Default to true if not specified (backward compatibility)
    canExtractIntent: llmOutput.canExtractIntent ?? true,
    clarificationNeeded: llmOutput.clarificationNeeded,
  };
}

/**
 * Create a minimal intent for simple requests or fallback
 */
export function createMinimalIntent(
  originalMessage: string,
  category: IntentCategory = "unknown",
  canExtractIntent: boolean = true,
  clarificationNeeded?: string
): UserIntent {
  return {
    id: crypto.randomUUID(),
    originalMessage,
    messageHash: hashContent(originalMessage),
    extractedAt: Date.now(),
    category,
    confidence: "low",
    summary: originalMessage.slice(0, 100),
    permissions: {
      allowedDataSources: [],
      allowedWriteDestinations: [],
      explicitlyAllowed: {
        sendEmail: false,
        createDocument: false,
        submitForm: false,
        makePayment: false,
        deleteContent: false,
        shareContent: false,
      },
      explicitlyForbidden: [],
    },
    goals: [],
    constraints: [],
    entities: [],
    scope: {},
    canExtractIntent,
    clarificationNeeded,
  };
}

// ============================================================================
// Intent Validation
// ============================================================================

/**
 * Error thrown when intent validation fails with blocking severity
 */
export class IntentViolationError extends Error {
  public readonly code: IntentValidationErrorCode;
  public readonly violations: Array<{
    code: IntentValidationErrorCode;
    detail: string;
  }>;

  constructor(
    message: string,
    code: IntentValidationErrorCode,
    violations: Array<{ code: IntentValidationErrorCode; detail: string }>
  ) {
    super(message);
    this.name = "IntentViolationError";
    this.code = code;
    this.violations = violations;
  }
}

/**
 * Helper to create a validation result
 */
function createValidationResult(
  allowed: boolean,
  severity: IntentValidationSeverity,
  message: string,
  violations: Array<{ code: IntentValidationErrorCode; detail: string }> = [],
  errorCode?: IntentValidationErrorCode
): IntentValidationResult {
  return {
    allowed,
    severity,
    errorCode,
    message,
    violations,
  };
}

/**
 * Check if a data source is allowed by the intent
 */
function isDataSourceAllowed(source: string, intent: UserIntent): boolean {
  // Normalize source name for comparison
  const normalizedSource = source.toLowerCase().replace(/[_-]/g, "");
  return intent.permissions.allowedDataSources.some((allowed) => {
    const normalizedAllowed = allowed.toLowerCase().replace(/[_-]/g, "");
    return (
      normalizedSource.includes(normalizedAllowed) ||
      normalizedAllowed.includes(normalizedSource)
    );
  });
}

/**
 * Check if a write destination is allowed by the intent
 */
function isWriteDestinationAllowed(dest: string, intent: UserIntent): boolean {
  const normalizedDest = dest.toLowerCase().replace(/[_-]/g, "");
  return intent.permissions.allowedWriteDestinations.some((allowed) => {
    const normalizedAllowed = allowed.toLowerCase().replace(/[_-]/g, "");
    return (
      normalizedDest.includes(normalizedAllowed) ||
      normalizedAllowed.includes(normalizedDest)
    );
  });
}

/**
 * Check if an operation is explicitly forbidden
 */
function isOperationForbidden(operation: string, intent: UserIntent): boolean {
  const normalizedOp = operation.toLowerCase();
  return intent.permissions.explicitlyForbidden.some(
    (forbidden) =>
      normalizedOp.includes(forbidden.toLowerCase()) ||
      forbidden.toLowerCase().includes(normalizedOp)
  );
}

/**
 * Map operation names to explicit permission checks
 */
function checkExplicitPermission(
  operation: string,
  intent: UserIntent
): boolean | null {
  const normalizedOp = operation.toLowerCase();
  const perms = intent.permissions.explicitlyAllowed;

  if (normalizedOp.includes("sendemail") || normalizedOp.includes("send_email"))
    return perms.sendEmail;
  if (
    normalizedOp.includes("createdoc") ||
    normalizedOp.includes("create_doc") ||
    normalizedOp.includes("createdocument")
  )
    return perms.createDocument;
  if (normalizedOp.includes("submitform") || normalizedOp.includes("submit"))
    return perms.submitForm;
  if (
    normalizedOp.includes("payment") ||
    normalizedOp.includes("pay") ||
    normalizedOp.includes("purchase")
  )
    return perms.makePayment;
  if (normalizedOp.includes("delete") || normalizedOp.includes("remove"))
    return perms.deleteContent;
  if (normalizedOp.includes("share") || normalizedOp.includes("publish"))
    return perms.shareContent;

  return null; // Operation not in explicit permission list
}

/**
 * Validate a plan step against user intent
 *
 * @param step - The plan step to validate
 * @param intent - The user's intent
 * @param config - Validation configuration
 * @returns Validation result
 */
export function validateStepAgainstIntent(
  step: PlanStep,
  intent: UserIntent,
  config: IntentValidationConfig = DEFAULT_INTENT_CONFIG
): IntentValidationResult {
  const violations: Array<{
    code: IntentValidationErrorCode;
    detail: string;
  }> = [];

  // Skip validation for certain step types
  if (step.type === "respond" || step.type === "approve") {
    return createValidationResult(true, "info", "Step type does not require intent validation");
  }

  // If intent is low confidence, be more lenient
  if (intent.confidence === "low") {
    if (config.strictness === "strict") {
      violations.push({
        code: "CONFIDENCE_TOO_LOW",
        detail: "Intent confidence is too low for strict validation mode",
      });
      return createValidationResult(
        false,
        "warn",
        "Low confidence intent - user confirmation recommended",
        violations,
        "CONFIDENCE_TOO_LOW"
      );
    }
    // For moderate/permissive, allow but log
    return createValidationResult(
      true,
      "info",
      "Intent has low confidence, proceeding with caution"
    );
  }

  // Check category compatibility for write operations
  if (
    (step.type === "route" || step.type === "delegate") &&
    step.stepPermissions?.writesTo?.length
  ) {
    if (intent.category === "read_only") {
      violations.push({
        code: "CATEGORY_MISMATCH",
        detail: `Write operation attempted but intent category is read_only`,
      });
    }
  }

  // Check data source permissions
  if (step.stepPermissions?.readsFrom) {
    for (const source of step.stepPermissions.readsFrom) {
      if (!isDataSourceAllowed(source, intent)) {
        violations.push({
          code: "UNAUTHORIZED_DATA_SOURCE",
          detail: `Reading from "${source}" not in allowed data sources: [${intent.permissions.allowedDataSources.join(", ")}]`,
        });
      }
    }
  }

  // Check write destination permissions
  if (step.stepPermissions?.writesTo) {
    for (const dest of step.stepPermissions.writesTo) {
      if (!isWriteDestinationAllowed(dest, intent)) {
        violations.push({
          code: "UNAUTHORIZED_WRITE",
          detail: `Writing to "${dest}" not in allowed destinations: [${intent.permissions.allowedWriteDestinations.join(", ")}]`,
        });
      }
    }
  }

  // Check forbidden operations
  if (step.stepPermissions?.operations) {
    for (const op of step.stepPermissions.operations) {
      if (isOperationForbidden(op, intent)) {
        violations.push({
          code: "FORBIDDEN_OPERATION",
          detail: `Operation "${op}" is explicitly forbidden`,
        });
      }

      // Check explicit permissions for sensitive operations
      const explicitCheck = checkExplicitPermission(op, intent);
      if (explicitCheck === false) {
        violations.push({
          code: "UNAUTHORIZED_WRITE",
          detail: `Operation "${op}" not explicitly allowed in intent`,
        });
      }
    }
  }

  // Determine severity based on violations and config
  if (violations.length === 0) {
    getLogger().logPermission({
      type: "step_validation",
      source: "intent",
      allowed: true,
      severity: "info",
      details: {
        stepId: step.id,
        stepType: step.type,
        targetAgentId: step.targetAgentId,
        intentCategory: intent.category,
        message: "Step validated against intent",
      },
    });
    return createValidationResult(true, "info", "Step validated against intent");
  }

  // Determine severity based on violation types and strictness
  const hasWriteViolation = violations.some(
    (v) =>
      v.code === "UNAUTHORIZED_WRITE" ||
      v.code === "FORBIDDEN_OPERATION" ||
      v.code === "CATEGORY_MISMATCH"
  );
  const hasReadViolation = violations.some(
    (v) => v.code === "UNAUTHORIZED_DATA_SOURCE"
  );

  let severity: IntentValidationSeverity;
  let allowed: boolean;

  switch (config.strictness) {
    case "strict":
      // Block any violation
      severity = "block";
      allowed = false;
      break;
    case "moderate":
      // Block writes, warn on reads
      if (hasWriteViolation) {
        severity = "block";
        allowed = false;
      } else if (hasReadViolation) {
        severity = "warn";
        allowed = false;
      } else {
        severity = "warn";
        allowed = false;
      }
      break;
    case "permissive":
      // Warn only
      severity = "warn";
      allowed = false;
      break;
  }

  const result = createValidationResult(
    allowed,
    severity,
    `Intent validation found ${violations.length} issue(s)`,
    violations,
    violations[0]?.code
  );

  getLogger().logPermission({
    type: "step_validation",
    source: "intent",
    allowed,
    severity: severity === "block" ? "block" : severity === "warn" ? "warn" : "info",
    details: {
      stepId: step.id,
      stepType: step.type,
      targetAgentId: step.targetAgentId,
      intentCategory: intent.category,
      intentConfidence: intent.confidence,
      strictness: config.strictness,
      violationCount: violations.length,
      violations: violations.map((v) => ({ code: v.code, detail: v.detail })),
      hasWriteViolation,
      hasReadViolation,
    },
  });

  return result;
}

/**
 * Validate a tool call against user intent (used in workers)
 *
 * @param toolName - Name of the tool being called
 * @param args - Arguments to the tool
 * @param intentContext - Intent context passed to the worker
 * @param config - Validation configuration
 * @returns Validation result
 */
export function validateToolAgainstIntent(
  toolName: string,
  args: Record<string, unknown>,
  intentContext: IntentContext,
  config?: IntentValidationConfig
): IntentValidationResult {
  const effectiveConfig = config ?? { strictness: intentContext.strictness };
  const intent = intentContext.intent;
  const violations: Array<{
    code: IntentValidationErrorCode;
    detail: string;
  }> = [];

  // Check if tool is forbidden
  if (isOperationForbidden(toolName, intent)) {
    violations.push({
      code: "FORBIDDEN_OPERATION",
      detail: `Tool "${toolName}" is explicitly forbidden`,
    });
    return createValidationResult(
      false,
      effectiveConfig.strictness === "permissive" ? "warn" : "block",
      `Tool "${toolName}" violates user intent`,
      violations,
      "FORBIDDEN_OPERATION"
    );
  }

  // Check explicit permission for sensitive tools
  const explicitCheck = checkExplicitPermission(toolName, intent);
  if (explicitCheck === false) {
    violations.push({
      code: "UNAUTHORIZED_WRITE",
      detail: `Tool "${toolName}" requires explicit permission not granted in intent`,
    });
  }

  // Check category compatibility for write-like tools
  const writeTools = [
    "send",
    "create",
    "update",
    "delete",
    "submit",
    "post",
    "write",
    "unlock",
    "open",
    "execute",
  ];
  const isWriteTool = writeTools.some((w) => toolName.toLowerCase().includes(w));

  if (isWriteTool && intent.category === "read_only") {
    violations.push({
      code: "CATEGORY_MISMATCH",
      detail: `Write tool "${toolName}" called but intent is read_only`,
    });
  }

  // Check task permissions if available
  const taskPerms = intentContext.taskPermissions;

  // Verify tool is within allowed operations
  if (taskPerms.operations.length > 0) {
    const toolAllowed = taskPerms.operations.some(
      (op) =>
        toolName.toLowerCase().includes(op.toLowerCase()) ||
        op.toLowerCase().includes(toolName.toLowerCase())
    );
    if (!toolAllowed && isWriteTool) {
      violations.push({
        code: "UNAUTHORIZED_WRITE",
        detail: `Tool "${toolName}" not in allowed operations for this task`,
      });
    }
  }

  if (violations.length === 0) {
    getLogger().logPermission({
      type: "tool_validation",
      source: "intent",
      allowed: true,
      severity: "info",
      details: {
        toolName,
        intentCategory: intent.category,
        strictness: effectiveConfig.strictness,
        message: `Tool "${toolName}" validated against intent`,
      },
    });
    return createValidationResult(
      true,
      "info",
      `Tool "${toolName}" validated against intent`
    );
  }

  // Determine severity
  const hasWriteViolation = violations.some(
    (v) =>
      v.code === "UNAUTHORIZED_WRITE" ||
      v.code === "FORBIDDEN_OPERATION" ||
      v.code === "CATEGORY_MISMATCH"
  );

  let severity: IntentValidationSeverity;
  let allowed: boolean;

  switch (effectiveConfig.strictness) {
    case "strict":
      severity = "block";
      allowed = false;
      break;
    case "moderate":
      severity = hasWriteViolation ? "block" : "warn";
      allowed = !hasWriteViolation;
      break;
    case "permissive":
      severity = "warn";
      allowed = true; // Permissive allows with warning
      break;
  }

  const result = createValidationResult(
    allowed,
    severity,
    `Tool "${toolName}" validation found ${violations.length} issue(s)`,
    violations,
    violations[0]?.code
  );

  getLogger().logPermission({
    type: "tool_validation",
    source: "intent",
    allowed,
    severity: severity === "block" ? "block" : severity === "warn" ? "warn" : "info",
    details: {
      toolName,
      intentCategory: intent.category,
      intentConfidence: intent.confidence,
      strictness: effectiveConfig.strictness,
      isWriteTool,
      violationCount: violations.length,
      violations: violations.map((v) => ({ code: v.code, detail: v.detail })),
      hasWriteViolation,
    },
  });

  return result;
}

/**
 * Infer step permissions from step data
 * Used when step doesn't have explicit permissions set
 */
export function inferStepPermissions(
  step: PlanStep,
  availableAgents: Array<{ id: string; permission: string }>
): StepPermissions {
  const readsFrom: string[] = [];
  const writesTo: string[] = [];
  const operations: string[] = [];

  const targetAgent = availableAgents.find((a) => a.id === step.targetAgentId);

  if (step.type === "delegate" || step.type === "gather") {
    // Determine what the agent reads from based on agent type
    if (targetAgent) {
      if (targetAgent.permission === "READ") {
        // Infer data source from agent ID
        if (step.targetAgentId?.includes("email")) {
          readsFrom.push("email");
        }
        if (step.targetAgentId?.includes("calendar")) {
          readsFrom.push("calendar");
        }
        if (step.targetAgentId?.includes("browser")) {
          readsFrom.push("web");
        }
        if (step.targetAgentId?.includes("doc")) {
          readsFrom.push("documents");
        }
      }
      if (
        targetAgent.permission === "WRITE" ||
        targetAgent.permission === "READ_WRITE"
      ) {
        // Infer write destination from agent ID
        if (step.targetAgentId?.includes("gdocs")) {
          writesTo.push("google-docs");
          operations.push("createDocument");
        }
        if (step.targetAgentId?.includes("email")) {
          writesTo.push("email-send");
          operations.push("sendEmail");
        }
        if (step.targetAgentId?.includes("browser")) {
          writesTo.push("web-form");
          operations.push("submitForm");
        }
      }
    }

    // Add task-based inference
    if (step.task) {
      const taskLower = step.task.toLowerCase();
      // Read operations can be inferred from task keywords
      if (taskLower.includes("email")) readsFrom.push("email");
      if (taskLower.includes("calendar")) readsFrom.push("calendar");

      // Write operations should only be inferred if agent has write permission
      const hasWritePermission =
        targetAgent &&
        (targetAgent.permission === "WRITE" ||
          targetAgent.permission === "READ_WRITE");

      if (hasWritePermission) {
        if (taskLower.includes("document") || taskLower.includes("doc"))
          operations.push("createDocument");
        if (taskLower.includes("send")) operations.push("sendEmail");
      }
    }
  }

  if (step.type === "route") {
    // Route to write agent - verify agent has write permission
    const hasWritePermission =
      targetAgent &&
      (targetAgent.permission === "WRITE" ||
        targetAgent.permission === "READ_WRITE");

    if (hasWritePermission) {
      if (step.targetAgentId?.includes("gdocs")) {
        writesTo.push("google-docs");
        operations.push("createDocument");
      }
      if (step.targetAgentId?.includes("email")) {
        writesTo.push("email-send");
        operations.push("sendEmail");
      }
    }
  }

  return {
    readsFrom: [...new Set(readsFrom)],
    writesTo: [...new Set(writesTo)],
    operations: [...new Set(operations)],
  };
}

/**
 * Format intent for display in security prompts
 */
export function formatIntentForPrompt(intent: UserIntent): string {
  const lines: string[] = [];

  lines.push(`## User Intent Context`);
  lines.push(`**Summary**: ${intent.summary}`);
  lines.push(`**Category**: ${intent.category}`);
  lines.push(`**Confidence**: ${intent.confidence}`);

  if (intent.permissions.allowedDataSources.length > 0) {
    lines.push(
      `**Allowed Data Sources**: ${intent.permissions.allowedDataSources.join(", ")}`
    );
  }

  if (intent.permissions.allowedWriteDestinations.length > 0) {
    lines.push(
      `**Allowed Write Destinations**: ${intent.permissions.allowedWriteDestinations.join(", ")}`
    );
  }

  if (intent.permissions.explicitlyForbidden.length > 0) {
    lines.push(
      `**Forbidden Operations**: ${intent.permissions.explicitlyForbidden.join(", ")}`
    );
  }

  if (intent.goals.length > 0) {
    lines.push(`**Goals**: ${intent.goals.join("; ")}`);
  }

  if (intent.constraints.length > 0) {
    lines.push(`**Constraints**: ${intent.constraints.join("; ")}`);
  }

  return lines.join("\n");
}

// ============================================================================
// Sub-Intent Helpers for READ_WRITE Agents
// ============================================================================

import type { AgentSubIntent } from "./types";

/**
 * Format sub-intent for display in security prompts
 *
 * @param subIntent - The agent's sub-intent
 * @returns Formatted string for inclusion in prompts
 */
export function formatSubIntentForPrompt(subIntent: AgentSubIntent): string {
  const lines: string[] = [];

  lines.push("## Agent Sub-Intent");
  lines.push(`**Task**: ${subIntent.taskDescription}`);
  lines.push(`**Summary**: ${subIntent.summary}`);
  lines.push(`**Expected Categories**: ${subIntent.expectedToolCategories.join(", ")}`);

  if (subIntent.expectedTools.length > 0) {
    lines.push(`**Expected Tools**: ${subIntent.expectedTools.join(", ")}`);
  }

  if (subIntent.forbiddenOperations.length > 0) {
    lines.push(`**Forbidden**: ${subIntent.forbiddenOperations.join(", ")}`);
  }

  if (Object.keys(subIntent.toolLimits).length > 0) {
    const limits = Object.entries(subIntent.toolLimits)
      .map(([tool, limit]) => `${tool}: ${limit}`)
      .join(", ");
    lines.push(`**Tool Limits**: ${limits}`);
  }

  if (subIntent.scope.allowedDomains?.length) {
    lines.push(`**Allowed Domains**: ${subIntent.scope.allowedDomains.join(", ")}`);
  }

  if (subIntent.scope.allowedPaths?.length) {
    lines.push(`**Allowed Paths**: ${subIntent.scope.allowedPaths.join(", ")}`);
  }

  return lines.join("\n");
}

/**
 * Validate that a sub-intent doesn't exceed orchestrator permissions.
 * Used to ensure agent-level intents stay within user-defined boundaries.
 *
 * @param subIntent - The agent's sub-intent
 * @param orchestratorIntent - The orchestrator's user intent
 * @returns Validation result with any errors found
 */
export function validateSubIntentAgainstOrchestrator(
  subIntent: AgentSubIntent,
  orchestratorIntent: UserIntent
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check category compatibility - read_only user intent shouldn't have write sub-intent
  if (orchestratorIntent.category === "read_only") {
    if (subIntent.expectedToolCategories.includes("write")) {
      errors.push(
        "Sub-intent includes write operations but user intent is read_only"
      );
    }
  }

  // Check for forbidden operations matching expected tools
  for (const forbidden of orchestratorIntent.permissions.explicitlyForbidden) {
    const normalizedForbidden = forbidden.toLowerCase();

    for (const tool of subIntent.expectedTools) {
      const normalizedTool = tool.toLowerCase();
      if (
        normalizedTool.includes(normalizedForbidden) ||
        normalizedForbidden.includes(normalizedTool)
      ) {
        errors.push(
          `Sub-intent expects tool "${tool}" which matches forbidden operation "${forbidden}"`
        );
      }
    }
  }

  // Check explicit permissions for sensitive operations
  const perms = orchestratorIntent.permissions.explicitlyAllowed;

  // If sub-intent expects form submission but user didn't allow it
  if (
    subIntent.expectedTools.some((t) =>
      t.toLowerCase().includes("submit")
    ) &&
    !perms.submitForm
  ) {
    errors.push(
      "Sub-intent expects form submission but user didn't explicitly allow submitForm"
    );
  }

  // If sub-intent expects email sending but user didn't allow it
  if (
    subIntent.expectedTools.some(
      (t) =>
        t.toLowerCase().includes("sendemail") ||
        t.toLowerCase().includes("send_email")
    ) &&
    !perms.sendEmail
  ) {
    errors.push(
      "Sub-intent expects email sending but user didn't explicitly allow sendEmail"
    );
  }

  // If sub-intent expects payment/purchase but user didn't allow it
  if (
    subIntent.expectedTools.some(
      (t) =>
        t.toLowerCase().includes("pay") ||
        t.toLowerCase().includes("purchase") ||
        t.toLowerCase().includes("buy")
    ) &&
    !perms.makePayment
  ) {
    errors.push(
      "Sub-intent expects payment but user didn't explicitly allow makePayment"
    );
  }

  // If sub-intent expects deletion but user didn't allow it
  if (
    subIntent.expectedTools.some((t) =>
      t.toLowerCase().includes("delete")
    ) &&
    !perms.deleteContent
  ) {
    errors.push(
      "Sub-intent expects deletion but user didn't explicitly allow deleteContent"
    );
  }

  const valid = errors.length === 0;

  getLogger().logPermission({
    type: "sub_intent_validation",
    source: "intent",
    allowed: valid,
    severity: valid ? "info" : "warn",
    details: {
      subIntentId: subIntent.id,
      subIntentSummary: subIntent.summary,
      orchestratorCategory: orchestratorIntent.category,
      expectedToolCategories: subIntent.expectedToolCategories,
      expectedTools: subIntent.expectedTools,
      forbiddenOperations: subIntent.forbiddenOperations,
      errorCount: errors.length,
      errors,
    },
  });

  return {
    valid,
    errors,
  };
}
