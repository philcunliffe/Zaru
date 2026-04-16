/**
 * Audit Event Types and Entry Definitions
 *
 * Defines the cryptographic audit ledger types for the Zaru agent system.
 * Every security-relevant action produces an AuditEntry containing a typed
 * AuditEvent payload, chained to the previous entry via hashing and signed
 * by the acting agent.
 */

import type { AgentPermission, IntentCategory, IntentConfidence } from "../agents/types";

// ============================================================================
// Audit Event Types
// ============================================================================

/**
 * All possible audit event types in the system.
 */
export type AuditEventType =
  // Session lifecycle
  | "session.started"
  | "session.ended"
  // Intent
  | "intent.extracted"
  | "intent.validated"
  | "intent.blocked"
  // Plan
  | "plan.created"
  | "plan.stepStarted"
  | "plan.stepCompleted"
  // Validation
  | "step.validated"
  | "tool.validated"
  // Permissions
  | "permission.checked"
  | "permission.denied"
  // Escalation
  | "escalation.requested"
  | "escalation.resolved"
  // Approval
  | "approval.requested"
  | "approval.granted"
  | "approval.denied"
  // Package crypto
  | "package.encrypted"
  | "package.routed"
  | "package.decrypted"
  // Agent registry
  | "agent.registered"
  | "agent.deregistered"
  // Security
  | "security.warning"
  | "security.violation";

// ============================================================================
// Event Payload Interfaces
// ============================================================================

/** Session lifecycle */

export interface SessionStartedEvent {
  type: "session.started";
  userId: string;
}

export interface SessionEndedEvent {
  type: "session.ended";
  reason: "user_exit" | "timeout" | "error";
}

/** Intent events */

export interface IntentExtractedEvent {
  type: "intent.extracted";
  intentId: string;
  messageHash: string;
  category: IntentCategory;
  confidence: IntentConfidence;
  summary: string;
}

export interface IntentValidatedEvent {
  type: "intent.validated";
  intentId: string;
  stepId: string;
  allowed: boolean;
  violations: Array<{ code: string; detail: string }>;
}

export interface IntentBlockedEvent {
  type: "intent.blocked";
  intentId: string;
  stepId: string;
  errorCode: string;
  reason: string;
}

/** Plan events */

export interface PlanCreatedEvent {
  type: "plan.created";
  planId: string;
  requestHash: string;
  stepCount: number;
  stepIds: string[];
}

export interface PlanStepStartedEvent {
  type: "plan.stepStarted";
  planId: string;
  stepId: string;
  stepType: string;
  targetAgentId?: string;
}

export interface PlanStepCompletedEvent {
  type: "plan.stepCompleted";
  planId: string;
  stepId: string;
  status: "completed" | "failed";
  outputPackageId?: string;
}

/** Validation events */

export interface StepValidatedEvent {
  type: "step.validated";
  planId: string;
  stepId: string;
  agentId: string;
  allowed: boolean;
  reason?: string;
}

export interface ToolValidatedEvent {
  type: "tool.validated";
  agentId: string;
  toolName: string;
  allowed: boolean;
  reason?: string;
}

/** Permission events */

export interface PermissionCheckedEvent {
  type: "permission.checked";
  agentId: string;
  permission: AgentPermission;
  resource: string;
  granted: boolean;
}

export interface PermissionDeniedEvent {
  type: "permission.denied";
  agentId: string;
  permission: AgentPermission;
  resource: string;
  reason: string;
}

/** Escalation events */

export interface EscalationRequestedEvent {
  type: "escalation.requested";
  escalationId: string;
  agentId: string;
  reason: string;
  taskId: string;
}

export interface EscalationResolvedEvent {
  type: "escalation.resolved";
  escalationId: string;
  resolution: "approved" | "denied" | "direct_response" | "timeout";
  respondedBy: "user" | "orchestrator";
}

/** Approval events */

export interface ApprovalRequestedEvent {
  type: "approval.requested";
  approvalId: string;
  stepId: string;
  sourceAgentId: string;
  targetAgentId: string;
  description: string;
}

export interface ApprovalGrantedEvent {
  type: "approval.granted";
  approvalId: string;
  modified: boolean;
}

export interface ApprovalDeniedEvent {
  type: "approval.denied";
  approvalId: string;
  reason?: string;
}

/** Package crypto events */

export interface PackageEncryptedEvent {
  type: "package.encrypted";
  packageId: string;
  sourceAgentId: string;
  recipientIds: string[];
  contentHash: string;
}

export interface PackageRoutedEvent {
  type: "package.routed";
  packageId: string;
  fromStepId: string;
  toStepId: string;
  targetAgentId: string;
}

export interface PackageDecryptedEvent {
  type: "package.decrypted";
  packageId: string;
  agentId: string;
  integrityValid: boolean;
}

/** Agent registry events */

export interface AgentRegisteredEvent {
  type: "agent.registered";
  agentId: string;
  agentName: string;
  permission: AgentPermission;
  publicKey: string;
}

export interface AgentDeregisteredEvent {
  type: "agent.deregistered";
  agentId: string;
  reason: string;
}

/** Security events */

export interface SecurityWarningEvent {
  type: "security.warning";
  category: string;
  message: string;
  agentId?: string;
  details?: Record<string, unknown>;
}

export interface SecurityViolationEvent {
  type: "security.violation";
  category: string;
  message: string;
  agentId?: string;
  severity: "low" | "medium" | "high" | "critical";
  details?: Record<string, unknown>;
}

// ============================================================================
// Discriminated Union
// ============================================================================

/**
 * Discriminated union of all audit event payloads.
 * The `type` field discriminates between variants.
 */
export type AuditEvent =
  | SessionStartedEvent
  | SessionEndedEvent
  | IntentExtractedEvent
  | IntentValidatedEvent
  | IntentBlockedEvent
  | PlanCreatedEvent
  | PlanStepStartedEvent
  | PlanStepCompletedEvent
  | StepValidatedEvent
  | ToolValidatedEvent
  | PermissionCheckedEvent
  | PermissionDeniedEvent
  | EscalationRequestedEvent
  | EscalationResolvedEvent
  | ApprovalRequestedEvent
  | ApprovalGrantedEvent
  | ApprovalDeniedEvent
  | PackageEncryptedEvent
  | PackageRoutedEvent
  | PackageDecryptedEvent
  | AgentRegisteredEvent
  | AgentDeregisteredEvent
  | SecurityWarningEvent
  | SecurityViolationEvent;

// ============================================================================
// Audit Entry (Chain Node)
// ============================================================================

/**
 * A single entry in the cryptographic audit ledger.
 *
 * Entries form a hash chain: each entry's `previousHash` points to the
 * `entryHash` of the preceding entry. The first entry in a session uses
 * the sentinel value "GENESIS".
 *
 * `entryHash` covers: sequence, timestamp, sessionId, previousHash, event,
 * actorId. It is computed deterministically so that any party holding the
 * actor's public key can recompute and verify the chain.
 *
 * `actorSignature` is a detached Ed25519 signature over `entryHash`, proving
 * the entry was created by the holder of the corresponding secret key.
 */
export interface AuditEntry {
  /** Monotonically increasing index within the session (starts at 0). */
  sequence: number;
  /** ISO-8601 timestamp of when the entry was created. */
  timestamp: string;
  /** Session identifier grouping related entries. */
  sessionId: string;
  /** Hash of the previous entry (`"GENESIS"` for the first entry). */
  previousHash: string;
  /** Deterministic hash of this entry's contents (hex or base64). */
  entryHash: string;
  /** The audit event payload. */
  event: AuditEvent;
  /** ID of the agent or system component that produced this entry. */
  actorId: string;
  /** Detached Ed25519 signature over `entryHash`, base64-encoded. */
  actorSignature: string;
  /** Ed25519 public key of the actor, base64-encoded. */
  signingPublicKey: string;
}

/** Sentinel value for the first entry's previousHash. */
export const GENESIS_HASH = "GENESIS";

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Helper to create a typed event payload. Each factory returns only the
 * event portion; the caller (AuditLedger) wraps it in an AuditEntry with
 * sequence, hashes, and signatures.
 */

// -- Session lifecycle -------------------------------------------------------

export function sessionStarted(userId: string): SessionStartedEvent {
  return { type: "session.started", userId };
}

export function sessionEnded(reason: SessionEndedEvent["reason"]): SessionEndedEvent {
  return { type: "session.ended", reason };
}

// -- Intent ------------------------------------------------------------------

export function intentExtracted(
  intentId: string,
  messageHash: string,
  category: IntentCategory,
  confidence: IntentConfidence,
  summary: string,
): IntentExtractedEvent {
  return { type: "intent.extracted", intentId, messageHash, category, confidence, summary };
}

export function intentValidated(
  intentId: string,
  stepId: string,
  allowed: boolean,
  violations: Array<{ code: string; detail: string }>,
): IntentValidatedEvent {
  return { type: "intent.validated", intentId, stepId, allowed, violations };
}

export function intentBlocked(
  intentId: string,
  stepId: string,
  errorCode: string,
  reason: string,
): IntentBlockedEvent {
  return { type: "intent.blocked", intentId, stepId, errorCode, reason };
}

// -- Plan --------------------------------------------------------------------

export function planCreated(
  planId: string,
  requestHash: string,
  stepCount: number,
  stepIds: string[],
): PlanCreatedEvent {
  return { type: "plan.created", planId, requestHash, stepCount, stepIds };
}

export function planStepStarted(
  planId: string,
  stepId: string,
  stepType: string,
  targetAgentId?: string,
): PlanStepStartedEvent {
  return { type: "plan.stepStarted", planId, stepId, stepType, targetAgentId };
}

export function planStepCompleted(
  planId: string,
  stepId: string,
  status: "completed" | "failed",
  outputPackageId?: string,
): PlanStepCompletedEvent {
  return { type: "plan.stepCompleted", planId, stepId, status, outputPackageId };
}

// -- Validation --------------------------------------------------------------

export function stepValidated(
  planId: string,
  stepId: string,
  agentId: string,
  allowed: boolean,
  reason?: string,
): StepValidatedEvent {
  return { type: "step.validated", planId, stepId, agentId, allowed, reason };
}

export function toolValidated(
  agentId: string,
  toolName: string,
  allowed: boolean,
  reason?: string,
): ToolValidatedEvent {
  return { type: "tool.validated", agentId, toolName, allowed, reason };
}

// -- Permissions -------------------------------------------------------------

export function permissionChecked(
  agentId: string,
  permission: AgentPermission,
  resource: string,
  granted: boolean,
): PermissionCheckedEvent {
  return { type: "permission.checked", agentId, permission, resource, granted };
}

export function permissionDenied(
  agentId: string,
  permission: AgentPermission,
  resource: string,
  reason: string,
): PermissionDeniedEvent {
  return { type: "permission.denied", agentId, permission, resource, reason };
}

// -- Escalation --------------------------------------------------------------

export function escalationRequested(
  escalationId: string,
  agentId: string,
  reason: string,
  taskId: string,
): EscalationRequestedEvent {
  return { type: "escalation.requested", escalationId, agentId, reason, taskId };
}

export function escalationResolved(
  escalationId: string,
  resolution: EscalationResolvedEvent["resolution"],
  respondedBy: "user" | "orchestrator",
): EscalationResolvedEvent {
  return { type: "escalation.resolved", escalationId, resolution, respondedBy };
}

// -- Approval ----------------------------------------------------------------

export function approvalRequested(
  approvalId: string,
  stepId: string,
  sourceAgentId: string,
  targetAgentId: string,
  description: string,
): ApprovalRequestedEvent {
  return { type: "approval.requested", approvalId, stepId, sourceAgentId, targetAgentId, description };
}

export function approvalGranted(approvalId: string, modified: boolean): ApprovalGrantedEvent {
  return { type: "approval.granted", approvalId, modified };
}

export function approvalDenied(approvalId: string, reason?: string): ApprovalDeniedEvent {
  return { type: "approval.denied", approvalId, reason };
}

// -- Package crypto ----------------------------------------------------------

export function packageEncrypted(
  packageId: string,
  sourceAgentId: string,
  recipientIds: string[],
  contentHash: string,
): PackageEncryptedEvent {
  return { type: "package.encrypted", packageId, sourceAgentId, recipientIds, contentHash };
}

export function packageRouted(
  packageId: string,
  fromStepId: string,
  toStepId: string,
  targetAgentId: string,
): PackageRoutedEvent {
  return { type: "package.routed", packageId, fromStepId, toStepId, targetAgentId };
}

export function packageDecrypted(
  packageId: string,
  agentId: string,
  integrityValid: boolean,
): PackageDecryptedEvent {
  return { type: "package.decrypted", packageId, agentId, integrityValid };
}

// -- Agent registry ----------------------------------------------------------

export function agentRegistered(
  agentId: string,
  agentName: string,
  permission: AgentPermission,
  publicKey: string,
): AgentRegisteredEvent {
  return { type: "agent.registered", agentId, agentName, permission, publicKey };
}

export function agentDeregistered(agentId: string, reason: string): AgentDeregisteredEvent {
  return { type: "agent.deregistered", agentId, reason };
}

// -- Security ----------------------------------------------------------------

export function securityWarning(
  category: string,
  message: string,
  agentId?: string,
  details?: Record<string, unknown>,
): SecurityWarningEvent {
  return { type: "security.warning", category, message, agentId, details };
}

export function securityViolation(
  category: string,
  message: string,
  severity: SecurityViolationEvent["severity"],
  agentId?: string,
  details?: Record<string, unknown>,
): SecurityViolationEvent {
  return { type: "security.violation", category, message, agentId, severity, details };
}
