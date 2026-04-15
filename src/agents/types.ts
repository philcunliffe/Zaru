/**
 * Shared Agent Types and Interfaces
 *
 * Defines the core types used across the agent system including
 * permissions, encrypted packages, plans, and message formats.
 */

import type { SealedBox } from "../crypto/sealed-box";
import type { IntegrityProof } from "../crypto/integrity";

/**
 * Agent permission types - enforces "Rule of Two"
 * READ: Can read content (all content treated as potentially dangerous), produces encrypted output
 * WRITE: Can only modify external state, receives encrypted input
 * READ_WRITE: Can do both (e.g., browser agent that reads pages and submits forms)
 */
export type AgentPermission = "READ" | "WRITE" | "READ_WRITE";

/**
 * Agent capability declarations
 */
export interface AgentCapability {
  name: string;
  description: string;
}

/**
 * Agent metadata
 */
export interface AgentMetadata {
  id: string;
  name: string;
  permission: AgentPermission;
  capabilities: AgentCapability[];
  publicKey: string;
}

/**
 * Encrypted package format for agent-to-agent communication
 * The orchestrator passes these without being able to read the content
 */
export interface EncryptedPackage {
  // Unique identifier for this package
  id: string;
  // Source agent ID
  sourceAgentId: string;
  // Target agent IDs -> sealed boxes
  sealedBoxes: Record<string, SealedBox>;
  // Integrity proof for user verification
  integrityProof: IntegrityProof;
  // Original request hash (for verification routing)
  requestHash: string;
  // Timestamp
  createdAt: number;
}

/**
 * Plan step types
 */
export type PlanStepType =
  | "delegate" // Delegate to a sub-agent
  | "route" // Route encrypted package to next agent
  | "approve" // Request user approval
  | "respond" // Return response to user
  | "gather" // Gather info from agent and add to context
  | "unknown"; // Placeholder - resolved after gather

/**
 * A single step in an execution plan
 */
export interface PlanStep {
  id: string;
  type: PlanStepType;
  // Target agent ID (for delegate/route/gather)
  targetAgentId?: string;
  // Task description (for delegate/gather)
  task?: string;
  // Input package ID (for route)
  inputPackageId?: string | null;
  // Whether this step requires user approval
  requiresApproval: boolean;
  // Dependencies (step IDs that must complete first)
  dependsOn: string[];
  // For "unknown" steps - what needs to be determined
  unknownReason?: string | null;
  // Permissions required by this step (for intent validation)
  stepPermissions?: StepPermissions;
}

/**
 * Execution plan created by orchestrator
 */
export interface ExecutionPlan {
  id: string;
  // Original user request
  originalRequest: string;
  // Hash of original request (for integrity verification)
  requestHash: string;
  // Ordered steps to execute
  steps: PlanStep[];
  // Current step index
  currentStepIndex: number;
  // Status
  status: "pending" | "executing" | "waiting_approval" | "completed" | "failed";
  // Created timestamp
  createdAt: number;
  // Re-plan counter to prevent infinite loops
  replanCount: number;
  // User intent extracted from the original request (security layer)
  userIntent?: UserIntent;
}

/**
 * Message types for worker communication
 */
export type WorkerMessageType =
  | "init" // Initialize worker with config
  | "task" // Execute a task
  | "result" // Task result
  | "error" // Error occurred
  | "shutdown" // Shutdown worker
  | "escalation" // Worker requests help from orchestrator
  | "escalation_response"; // Response to escalation request

/**
 * Base worker message structure
 */
export interface WorkerMessage {
  type: WorkerMessageType;
  id: string;
  timestamp: number;
}

/**
 * Dynamic worker configuration for JSON-defined agents
 */
export interface DynamicWorkerConfig {
  /** Service configuration from JSON */
  serviceConfig: unknown; // ServiceConfig from generation/schema
  /** Tool names this worker should use */
  toolNames: string[];
  /** Expected permission for this worker */
  expectedPermission: AgentPermission;
  /** Model ID to use for this worker (from LLM config) */
  modelId?: string;
}

/**
 * Worker initialization message
 */
export interface WorkerInitMessage extends WorkerMessage {
  type: "init";
  config: {
    agentId: string;
    agentName: string;
    permission: AgentPermission;
    secretKey: string;
    recipientPublicKeys: Record<string, string>;
    /** Dynamic worker config (only for dynamic workers) */
    dynamicConfig?: DynamicWorkerConfig;
  };
}

/**
 * Task message for workers
 */
export interface WorkerTaskMessage extends WorkerMessage {
  type: "task";
  task: {
    // Task description
    description: string;
    // Original user request (for integrity proofs)
    originalRequest: string;
    // Request hash
    requestHash: string;
    // Input data (for READ agents: task parameters, for WRITE agents: encrypted package)
    input: string | EncryptedPackage;
    // Target recipients for encrypted output
    outputRecipients: string[];
    // Intent context for security validation (optional for backward compatibility)
    intentContext?: IntentContext;
  };
}

/**
 * Task result from workers
 */
export interface WorkerResultMessage extends WorkerMessage {
  type: "result";
  result: {
    success: boolean;
    // Encrypted package (if successful)
    package?: EncryptedPackage;
    // Error message (if failed)
    error?: string;
    // Brief summary of what the agent accomplished (no sensitive content)
    // e.g., "Found 5 emails with action items"
    outcomeSummary?: string;
  };
}

/**
 * Error message from workers
 */
export interface WorkerErrorMessage extends WorkerMessage {
  type: "error";
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Shutdown message for workers
 */
export interface WorkerShutdownMessage extends WorkerMessage {
  type: "shutdown";
}

/**
 * Resolution type for escalation requests
 */
export type EscalationResolution =
  | "approved" // Forwarded to orchestrator
  | "denied" // User rejected
  | "direct_response" // User answered directly
  | "timeout"; // Timed out

/**
 * Escalation message from worker to orchestrator
 */
export interface WorkerEscalationMessage extends WorkerMessage {
  type: "escalation";
  escalation: {
    escalationId: string;
    requestText: string; // The message agent wants to send (needs user approval)
    reason: string; // Brief context for why this escalation is needed
    originalTaskId: string;
  };
}

/**
 * Response to worker escalation
 */
export interface WorkerEscalationResponseMessage extends WorkerMessage {
  type: "escalation_response";
  response: {
    escalationId: string;
    resolution: EscalationResolution;
    content?: string;
    respondedBy: "user" | "orchestrator";
    denialReason?: string;
  };
}

/**
 * Escalation approval request (for UI)
 */
export interface EscalationApprovalRequest {
  id: string;
  escalation: WorkerEscalationMessage["escalation"];
  sourceAgentId: string;
  sourceAgentName: string;
  createdAt: number;
}

/**
 * Escalation approval response (from UI)
 */
export interface EscalationApprovalResponse {
  requestId: string;
  outcome: "approve" | "deny" | "direct_response";
  directResponse?: string;
  denialReason?: string;
  respondedAt: number;
}

/**
 * Union type for all worker messages
 */
export type AnyWorkerMessage =
  | WorkerInitMessage
  | WorkerTaskMessage
  | WorkerResultMessage
  | WorkerErrorMessage
  | WorkerShutdownMessage
  | WorkerEscalationMessage
  | WorkerEscalationResponseMessage;

/**
 * User approval request
 */
export interface ApprovalRequest {
  id: string;
  // Description of the action
  description: string;
  // Content preview (decrypted for user display)
  contentPreview: string;
  // Source agent
  sourceAgentId: string;
  // Target agent
  targetAgentId: string;
  // Associated plan step
  planStepId: string;
  // Timestamp
  createdAt: number;
}

/**
 * User approval response
 */
export interface ApprovalResponse {
  requestId: string;
  approved: boolean;
  // Optional modification to the content
  modifiedContent?: string;
  // Timestamp
  respondedAt: number;
}

/**
 * Chat message for CLI interface
 */
export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  // Associated plan (if any)
  planId?: string;
  // Encrypted content for user (if any)
  encryptedForUser?: SealedBox;
  // Integrity proof (if any)
  integrityProof?: IntegrityProof;
}

/**
 * Agent registry entry
 */
export interface RegisteredAgent {
  metadata: AgentMetadata;
  // Worker instance (if spawned)
  worker?: Worker;
  // Worker status
  status: "idle" | "busy" | "error" | "shutdown";
}

// ============================================================================
// User Intent Security System Types
// ============================================================================

/**
 * Intent category derived from user's original message
 */
export type IntentCategory =
  | "read_only" // Only reading/viewing data
  | "read_and_write" // Reading then writing (e.g., summarize emails and save to doc)
  | "write_only" // Only writing/creating (rare - usually needs input)
  | "mixed" // Complex multi-step with various operations
  | "unknown"; // Cannot determine intent category

/**
 * Confidence level in the extracted intent
 */
export type IntentConfidence = "high" | "medium" | "low";

/**
 * Explicit permission flags for sensitive operations
 */
export interface ExplicitPermissions {
  sendEmail: boolean;
  createDocument: boolean;
  submitForm: boolean;
  makePayment: boolean;
  deleteContent: boolean;
  shareContent: boolean;
  modifyCalendar: boolean;
}

/**
 * Permissions extracted from user intent
 */
export interface IntentPermissions {
  // Data sources allowed to read from
  allowedDataSources: string[];
  // Destinations allowed to write to
  allowedWriteDestinations: string[];
  // Explicit operation permissions
  explicitlyAllowed: ExplicitPermissions;
  // Operations explicitly forbidden by user
  explicitlyForbidden: string[];
}

/**
 * Entity mentioned in the user's request
 */
export interface IntentEntity {
  type: "person" | "organization" | "topic" | "time" | "location" | "other";
  value: string;
  context: string;
}

/**
 * Scope constraints from the user's request
 */
export interface IntentScope {
  // Time-based constraints (e.g., "from last week", "today's emails")
  temporal?: string;
  // Quantity constraints (e.g., "top 5", "all")
  quantity?: string;
}

/**
 * User intent extracted from the original message
 */
export interface UserIntent {
  // Unique identifier for this intent
  id: string;
  // The original user message
  originalMessage: string;
  // Hash of the original message for integrity verification
  messageHash: string;
  // Timestamp when intent was extracted
  extractedAt: number;
  // Category of the intent
  category: IntentCategory;
  // Confidence in the extraction
  confidence: IntentConfidence;
  // Human-readable summary of what user wants
  summary: string;
  // Extracted permissions
  permissions: IntentPermissions;
  // Goals the user wants to achieve
  goals: string[];
  // Constraints from the user's request
  constraints: string[];
  // Entities mentioned in the request
  entities: IntentEntity[];
  // Scope constraints
  scope: IntentScope;
  // NEW: Can intent be determined without seeing encrypted content?
  canExtractIntent: boolean;
  // NEW: If not extractable, why? (shown to user when asking for clarification)
  clarificationNeeded?: string;
}

/**
 * Intent validation error codes
 */
export type IntentValidationErrorCode =
  | "UNAUTHORIZED_WRITE" // Attempting write operation not in intent
  | "UNAUTHORIZED_DATA_SOURCE" // Reading from source not in intent
  | "SCOPE_VIOLATION" // Exceeding scope defined in intent
  | "FORBIDDEN_OPERATION" // Operation explicitly forbidden by user
  | "CATEGORY_MISMATCH" // Action doesn't match intent category
  | "ENTITY_MISMATCH" // Operating on entities not mentioned in intent
  | "CONFIDENCE_TOO_LOW"; // Intent confidence too low for operation

/**
 * Severity of an intent validation issue
 */
export type IntentValidationSeverity = "block" | "warn" | "info";

/**
 * Result of validating an action against user intent
 */
export interface IntentValidationResult {
  // Whether the action is allowed
  allowed: boolean;
  // Severity if not allowed (or if warning)
  severity: IntentValidationSeverity;
  // Error code if validation failed
  errorCode?: IntentValidationErrorCode;
  // Human-readable explanation
  message: string;
  // Specific violations found
  violations: Array<{
    code: IntentValidationErrorCode;
    detail: string;
  }>;
}

/**
 * Permissions required by a plan step
 */
export interface StepPermissions {
  // Data sources this step will read from
  readsFrom: string[];
  // Destinations this step will write to
  writesTo: string[];
  // Specific operations this step will perform
  operations: string[];
}

/**
 * Intent context passed to workers
 */
export interface IntentContext {
  // The user's intent (for reference)
  intent: UserIntent;
  // Permissions specific to this worker's task
  taskPermissions: StepPermissions;
  // Validation strictness level
  strictness: "strict" | "moderate" | "permissive";
}

/**
 * Generate a unique ID
 */
export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Request from orchestrator to view decrypted content
 */
export interface DecryptedContentRequest {
  id: string;
  packageId: string;
  reason: string;
  sourceAgentId: string;
  createdAt: number;
}

/**
 * Response to decrypted content request
 */
export interface DecryptedContentResponse {
  requestId: string;
  granted: boolean;
  content?: string;
  verified?: boolean;
  respondedAt: number;
}

/**
 * Approved context item for persistent orchestrator context
 * Content that has been decrypted and approved by the user for planning
 */
export interface ApprovedContextItem {
  id: string;
  packageId: string;
  content: string;
  sourceAgentId: string;
  verified: boolean;
  approvedAt: number;
  summary?: string;
}

// ============================================================================
// READ_WRITE Agent Security Types
// ============================================================================

/**
 * Tool category for READ_WRITE agents.
 * Used to categorize expected operations based on task description.
 */
export type ToolCategory = "navigate" | "read" | "write" | "input" | "other";

/**
 * Sub-intent extracted by a READ_WRITE agent from its task description.
 * This is extracted BEFORE the agent sees any potentially malicious content.
 */
export interface AgentSubIntent {
  /** Unique identifier for this sub-intent */
  id: string;
  /** The task description this sub-intent was extracted from */
  taskDescription: string;
  /** Human-readable summary of what the task should accomplish */
  summary: string;
  /** Expected categories of tools that should be used */
  expectedToolCategories: ToolCategory[];
  /** Specific tools expected to be used */
  expectedTools: string[];
  /** Operations that should NOT be performed */
  forbiddenOperations: string[];
  /** Maximum number of times each tool can be called */
  toolLimits: Array<{ tool: string; maxCalls: number }>;
  /** Scope constraints for this task */
  scope: {
    /** Allowed domains for navigation (browser agent) */
    allowedDomains?: string[];
    /** Allowed form actions (browser agent) */
    allowedFormActions?: string[];
    /** Allowed file paths (obsidian agent) */
    allowedPaths?: string[];
  };
  /** Timestamp when sub-intent was extracted */
  extractedAt: number;
}

/**
 * A single step in an agent's mini-plan.
 * Mini-plans are simpler than orchestrator plans and focus on tool sequences.
 */
export interface MiniPlanStep {
  /** Unique identifier for this step */
  id: string;
  /** Category of tool expected for this step */
  toolCategory: ToolCategory;
  /** Human-readable description of what this step does */
  description: string;
  /** IDs of steps that must complete before this one */
  dependsOn?: string[];
  /** Specific tool expected (if known) */
  expectedTool?: string;
  /** Whether this step has been executed */
  executed?: boolean;
}

/**
 * Agent's internal mini-plan for executing a task.
 * Created after sub-intent extraction to guide tool usage.
 */
export interface AgentMiniPlan {
  /** Unique identifier for this plan */
  id: string;
  /** Reference to the sub-intent this plan is based on */
  subIntentId: string;
  /** The sub-intent object */
  subIntent: AgentSubIntent;
  /** Ordered steps to execute */
  steps: MiniPlanStep[];
  /** Current step index */
  currentStepIndex: number;
  /** Number of times this plan has been revised */
  replanCount: number;
  /** Maximum allowed replans (prevents infinite loops) */
  maxReplans: number;
  /** Timestamp when plan was created */
  createdAt: number;
}
