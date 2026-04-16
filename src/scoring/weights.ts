/**
 * Threat Scoring Weights & Configurable Thresholds
 *
 * Defines the deterministic weight constants used by ThreatScorer to compute
 * plan-level risk scores. All weights are auditable constants — no LLM in
 * the scoring loop.
 *
 * Tier thresholds can be overridden via ~/.zaru/config.json under the
 * "scoring" key.
 */

import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { PlanStepType, AgentPermission, IntentConfidence } from "../agents/types";

// ============================================================================
// Step Type Base Scores
// ============================================================================

/**
 * Base risk score for each plan step type.
 * Higher score = more risk surface.
 */
export const STEP_TYPE_SCORES: Record<PlanStepType, number> = {
  respond: 0,   // Returning data to user — no risk
  approve: 0,   // Explicit user checkpoint — reduces risk
  gather: 1,    // Reading external data for planning
  delegate: 2,  // Sending task to READ agent — processes untrusted content
  route: 3,     // Sending encrypted package to WRITE agent — external state change
  unknown: 4,   // Unresolved step — uncertain what it will do
};

// ============================================================================
// Explicit Permission Multipliers
// ============================================================================

/**
 * Additive score for each explicit permission flag present on a step.
 * Applied per step based on StepPermissions operations and ExplicitPermissions.
 */
export const PERMISSION_SCORES: Record<string, number> = {
  sendEmail: 5,       // Irreversible external communication
  makePayment: 10,    // Financial consequence
  deleteContent: 8,   // Destructive, hard to reverse
  submitForm: 4,      // External state change
  shareContent: 3,    // Data leaves system boundary
  createDocument: 2,  // Creates artifact, low risk
  modifyCalendar: 2,  // Modifiable, low risk
};

// ============================================================================
// Agent Permission Weights
// ============================================================================

/**
 * Additive score based on the target agent's declared permission type.
 * READ_WRITE is highest because it violates Rule of Two by necessity.
 */
export const AGENT_PERMISSION_SCORES: Record<AgentPermission, number> = {
  READ: 0,       // Can only observe
  WRITE: 2,      // Can change external state
  READ_WRITE: 4, // Highest surface area — violates Rule of Two by necessity
};

// ============================================================================
// Intent Confidence Penalty
// ============================================================================

/**
 * Additive penalty applied to plan total based on intent extraction confidence.
 * Low confidence means the system is less sure what the user wants, increasing risk.
 */
export const INTENT_CONFIDENCE_PENALTIES: Record<IntentConfidence, number> = {
  high: 0,
  medium: 3,
  low: 8,
};

// ============================================================================
// Orchestrator Decryption Penalty
// ============================================================================

/**
 * Additive penalty per step where the orchestrator appears in outputRecipients
 * and the target agent is not the user. Each such step represents a point where
 * encrypted content is exposed to the routing layer.
 */
export const ORCHESTRATOR_DECRYPTION_PENALTY = 2;

// ============================================================================
// Threat Tiers
// ============================================================================

/**
 * Risk tier classification for plan-level threat scores.
 */
export type ThreatTier = "LOW" | "MODERATE" | "HIGH" | "CRITICAL";

/**
 * Default tier thresholds. A plan's total score is classified into the highest
 * tier whose minimum it meets or exceeds.
 *
 * Overridable via ~/.zaru/config.json:
 * ```json
 * {
 *   "scoring": {
 *     "thresholds": { "LOW": 0, "MODERATE": 8, "HIGH": 16, "CRITICAL": 30 }
 *   }
 * }
 * ```
 */
export const DEFAULT_TIER_THRESHOLDS: Record<ThreatTier, number> = {
  LOW: 0,
  MODERATE: 8,
  HIGH: 16,
  CRITICAL: 30,
};

/**
 * Ordered tiers from most severe to least, used for classification.
 */
const TIER_ORDER: ThreatTier[] = ["CRITICAL", "HIGH", "MODERATE", "LOW"];

// ============================================================================
// Configuration
// ============================================================================

const CONFIG_FILE = join(homedir(), ".zaru", "config.json");

interface ScoringConfig {
  thresholds?: Partial<Record<ThreatTier, number>>;
}

/**
 * Load scoring configuration from ~/.zaru/config.json.
 * Returns merged thresholds (user overrides + defaults).
 */
function loadScoringConfig(): ScoringConfig {
  if (!existsSync(CONFIG_FILE)) {
    return {};
  }
  try {
    const content = readFileSync(CONFIG_FILE, "utf-8");
    const config = JSON.parse(content);
    return config?.scoring ?? {};
  } catch {
    return {};
  }
}

/**
 * Get the active tier thresholds, merging any user overrides from config
 * with the defaults.
 */
export function getTierThresholds(): Record<ThreatTier, number> {
  const userConfig = loadScoringConfig();
  if (!userConfig.thresholds) {
    return { ...DEFAULT_TIER_THRESHOLDS };
  }
  return {
    ...DEFAULT_TIER_THRESHOLDS,
    ...userConfig.thresholds,
  };
}

/**
 * Classify a numeric threat score into a tier using the active thresholds.
 * Returns the highest tier whose minimum the score meets or exceeds.
 */
export function classifyTier(score: number): ThreatTier {
  const thresholds = getTierThresholds();
  for (const tier of TIER_ORDER) {
    if (score >= thresholds[tier]) {
      return tier;
    }
  }
  return "LOW";
}

/**
 * Whether a tier requires user confirmation before plan execution.
 * HIGH and CRITICAL require confirmation; LOW and MODERATE do not.
 */
export function tierRequiresConfirmation(tier: ThreatTier): boolean {
  return tier === "HIGH" || tier === "CRITICAL";
}
