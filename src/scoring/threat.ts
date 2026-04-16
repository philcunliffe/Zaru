/**
 * ThreatScorer — step scoring, plan aggregation, tier classification
 *
 * Computes a deterministic numeric risk score for each execution plan step
 * and aggregates into a plan-level threat score with named risk tier.
 * No LLM in the scoring loop — weights are fixed constants.
 */

import type {
  PlanStep,
  PlanStepType,
  ExecutionPlan,
  AgentPermission,
  AgentMetadata,
  ExplicitPermissions,
  IntentConfidence,
} from "../agents/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StepThreatScore {
  stepId: string;
  baseScore: number;
  permissionScore: number;
  agentScore: number;
  total: number;
  factors: string[];
}

export type ThreatTier = "LOW" | "MODERATE" | "HIGH" | "CRITICAL";

export interface PlanThreatScore {
  planId: string;
  steps: StepThreatScore[];
  subtotal: number;
  intentPenalty: number;
  total: number;
  tier: ThreatTier;
  summary: string;
  breakdown: string[];
}

// ---------------------------------------------------------------------------
// Weight constants (za-tb5.2 will extract these into weights.ts)
// ---------------------------------------------------------------------------

/** Base score per step type. */
export const STEP_TYPE_SCORES: Record<PlanStepType, number> = {
  respond: 0,
  gather: 1,
  delegate: 2,
  route: 3,
  approve: 0,
  unknown: 4,
};

/** Additive score per explicit permission flag present on a step. */
export const PERMISSION_SCORES: Record<keyof ExplicitPermissions, number> = {
  sendEmail: 5,
  makePayment: 10,
  deleteContent: 8,
  submitForm: 4,
  shareContent: 3,
  createDocument: 2,
  modifyCalendar: 2,
};

/** Additive score per target agent permission type. */
export const AGENT_PERMISSION_SCORES: Record<AgentPermission, number> = {
  READ: 0,
  WRITE: 2,
  READ_WRITE: 4,
};

/** Penalty added to the plan total based on intent confidence. */
export const INTENT_CONFIDENCE_PENALTY: Record<IntentConfidence, number> = {
  high: 0,
  medium: 3,
  low: 8,
};

/** Tier thresholds — score >= threshold maps to the tier. */
export const TIER_THRESHOLDS: { tier: ThreatTier; min: number }[] = [
  { tier: "CRITICAL", min: 30 },
  { tier: "HIGH", min: 16 },
  { tier: "MODERATE", min: 8 },
  { tier: "LOW", min: 0 },
];

// ---------------------------------------------------------------------------
// Step scoring
// ---------------------------------------------------------------------------

/**
 * Score a single execution plan step.
 *
 * @param step        The plan step to score.
 * @param agentLookup Optional function that resolves an agent ID to metadata.
 *                    When provided, the agent's permission type contributes to
 *                    the score.
 */
export function scoreStep(
  step: PlanStep,
  agentLookup?: (agentId: string) => AgentMetadata | undefined,
): StepThreatScore {
  const factors: string[] = [];

  // --- base score from step type ---
  const baseScore = STEP_TYPE_SCORES[step.type] ?? STEP_TYPE_SCORES.unknown;
  if (baseScore > 0) {
    factors.push(`+${baseScore} ${step.type} step`);
  }

  // --- permission score from explicit permissions on the step ---
  let permissionScore = 0;
  if (step.stepPermissions) {
    for (const op of step.stepPermissions.operations) {
      const key = op as keyof ExplicitPermissions;
      const weight = PERMISSION_SCORES[key];
      if (weight !== undefined) {
        permissionScore += weight;
        factors.push(
          `+${weight} ${op} permission${step.targetAgentId ? ` (${step.id} \u2192 ${step.targetAgentId})` : ""}`,
        );
      }
    }
  }

  // --- agent permission score ---
  let agentScore = 0;
  if (step.targetAgentId && agentLookup) {
    const agent = agentLookup(step.targetAgentId);
    if (agent) {
      agentScore = AGENT_PERMISSION_SCORES[agent.permission] ?? 0;
      if (agentScore > 0) {
        factors.push(
          `+${agentScore} ${agent.permission} agent (${step.id} \u2192 ${agent.id})`,
        );
      }
    }
  }

  return {
    stepId: step.id,
    baseScore,
    permissionScore,
    agentScore,
    total: baseScore + permissionScore + agentScore,
    factors,
  };
}

// ---------------------------------------------------------------------------
// Tier classification
// ---------------------------------------------------------------------------

/** Map a numeric score to a threat tier. */
export function classifyTier(score: number): ThreatTier {
  for (const { tier, min } of TIER_THRESHOLDS) {
    if (score >= min) return tier;
  }
  return "LOW";
}

// ---------------------------------------------------------------------------
// Plan aggregation
// ---------------------------------------------------------------------------

/**
 * Score an entire execution plan.
 *
 * @param plan        The execution plan to score.
 * @param agentLookup Optional function to resolve agent IDs to metadata.
 */
export function scorePlan(
  plan: ExecutionPlan,
  agentLookup?: (agentId: string) => AgentMetadata | undefined,
): PlanThreatScore {
  const stepScores = plan.steps.map((s) => scoreStep(s, agentLookup));
  const subtotal = stepScores.reduce((sum, s) => sum + s.total, 0);

  // Intent confidence penalty
  const confidence: IntentConfidence =
    plan.userIntent?.confidence ?? "low";
  const intentPenalty = INTENT_CONFIDENCE_PENALTY[confidence];

  const total = subtotal + intentPenalty;
  const tier = classifyTier(total);

  // Collect all factor lines across steps, then add intent penalty
  const breakdown = stepScores.flatMap((s) => s.factors);
  if (intentPenalty > 0) {
    breakdown.push(`+${intentPenalty} ${confidence} confidence intent`);
  }
  // Sort breakdown by weight descending for readability
  breakdown.sort((a, b) => {
    const wa = parseInt(a.match(/^\+(\d+)/)?.[1] ?? "0", 10);
    const wb = parseInt(b.match(/^\+(\d+)/)?.[1] ?? "0", 10);
    return wb - wa;
  });

  const summary = `Threat: ${tier} (${total} pts, ${plan.steps.length} steps)`;

  return {
    planId: plan.id,
    steps: stepScores,
    subtotal,
    intentPenalty,
    total,
    tier,
    summary,
    breakdown,
  };
}
