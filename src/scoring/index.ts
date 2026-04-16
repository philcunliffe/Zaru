/**
 * Scoring Module — Public API
 *
 * Re-exports weight constants, tier classification, and configuration
 * utilities for the threat scoring system.
 */

export {
  STEP_TYPE_SCORES,
  PERMISSION_SCORES,
  AGENT_PERMISSION_SCORES,
  INTENT_CONFIDENCE_PENALTIES,
  ORCHESTRATOR_DECRYPTION_PENALTY,
  DEFAULT_TIER_THRESHOLDS,
  getTierThresholds,
  classifyTier,
  tierRequiresConfirmation,
  type ThreatTier,
} from "./weights";
