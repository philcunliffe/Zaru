/**
 * Scoring module — public API
 */

export {
  scoreStep,
  scorePlan,
  classifyTier,
  STEP_TYPE_SCORES,
  PERMISSION_SCORES,
  AGENT_PERMISSION_SCORES,
  INTENT_CONFIDENCE_PENALTY,
  TIER_THRESHOLDS,
} from "./threat";

export type {
  StepThreatScore,
  PlanThreatScore,
  ThreatTier,
} from "./threat";
