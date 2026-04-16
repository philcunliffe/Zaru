/**
 * ThreatScorer — Step scoring, plan aggregation, tier classification
 *
 * Computes a deterministic numeric risk score for each execution plan.
 * No LLM in the scoring loop — all weights are auditable constants.
 */

import type {
  ExecutionPlan,
  PlanStep,
  AgentPermission,
  IntentConfidence,
} from "../agents/types";
import {
  STEP_TYPE_SCORES,
  PERMISSION_SCORES,
  AGENT_PERMISSION_SCORES,
  INTENT_CONFIDENCE_PENALTIES,
  ORCHESTRATOR_DECRYPTION_PENALTY,
  classifyTier,
  type ThreatTier,
} from "./weights";

// ============================================================================
// Types
// ============================================================================

export interface StepThreatScore {
  stepId: string;
  baseScore: number;
  permissionScore: number;
  agentScore: number;
  total: number;
  factors: string[];
}

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

// ============================================================================
// Agent metadata lookup (used to resolve agent permissions)
// ============================================================================

interface AgentInfo {
  id: string;
  permission: AgentPermission | string;
}

// ============================================================================
// Step Scoring
// ============================================================================

/**
 * Score a single plan step.
 *
 * @param step - The plan step to score
 * @param agents - Available agents (for resolving target agent permissions)
 */
export function scoreStep(step: PlanStep, agents: AgentInfo[]): StepThreatScore {
  const factors: string[] = [];

  // 1. Base score from step type
  const baseScore = STEP_TYPE_SCORES[step.type] ?? STEP_TYPE_SCORES.unknown;
  if (baseScore > 0) {
    factors.push(`${step.type} step (+${baseScore})`);
  }

  // 2. Permission score from step's explicit permissions (operations list)
  let permissionScore = 0;
  if (step.stepPermissions) {
    for (const op of step.stepPermissions.operations) {
      const opScore = PERMISSION_SCORES[op];
      if (opScore !== undefined) {
        permissionScore += opScore;
        factors.push(`${op} permission (+${opScore})`);
      }
    }
  }

  // 3. Agent permission weight based on target agent
  let agentScore = 0;
  if (step.targetAgentId) {
    const agent = agents.find((a) => a.id === step.targetAgentId);
    if (agent) {
      const perm = agent.permission as AgentPermission;
      const score = AGENT_PERMISSION_SCORES[perm];
      if (score !== undefined && score > 0) {
        agentScore = score;
        factors.push(`${perm} agent: ${step.targetAgentId} (+${score})`);
      }
    }
  }

  const total = baseScore + permissionScore + agentScore;

  return {
    stepId: step.id,
    baseScore,
    permissionScore,
    agentScore,
    total,
    factors,
  };
}

// ============================================================================
// Plan Scoring
// ============================================================================

/**
 * Score an entire execution plan.
 *
 * @param plan - The execution plan to score
 * @param agents - Available agents (for resolving permissions)
 */
export function scorePlan(plan: ExecutionPlan, agents: AgentInfo[]): PlanThreatScore {
  // Score each step
  const stepScores = plan.steps.map((step) => scoreStep(step, agents));

  // Compute subtotal (sum of all step scores)
  const subtotal = stepScores.reduce((sum, s) => sum + s.total, 0);

  // Intent confidence penalty
  const confidence = plan.userIntent?.confidence ?? "low";
  const intentPenalty = INTENT_CONFIDENCE_PENALTIES[confidence as IntentConfidence] ?? INTENT_CONFIDENCE_PENALTIES.low;

  // Orchestrator decryption penalty: count steps where orchestrator is implicit
  // (route/gather steps where content passes through orchestrator routing)
  // We approximate this by checking for route steps (orchestrator handles routing)
  let orchestratorPenalty = 0;
  for (const step of plan.steps) {
    if (step.type === "route" || step.type === "gather") {
      orchestratorPenalty += ORCHESTRATOR_DECRYPTION_PENALTY;
    }
  }

  const total = subtotal + intentPenalty + orchestratorPenalty;
  const tier = classifyTier(total);

  // Build breakdown lines (sorted by contribution, descending)
  const breakdown: string[] = [];
  const allFactors: Array<{ label: string; score: number; context: string }> = [];

  for (const stepScore of stepScores) {
    for (const factor of stepScore.factors) {
      // Extract score from factor string like "sendEmail permission (+5)"
      const match = factor.match(/\(\+(\d+)\)/);
      const score = match ? parseInt(match[1], 10) : 0;
      allFactors.push({ label: factor, score, context: stepScore.stepId });
    }
  }

  if (intentPenalty > 0) {
    allFactors.push({
      label: `${confidence} confidence intent`,
      score: intentPenalty,
      context: "plan",
    });
  }

  if (orchestratorPenalty > 0) {
    const routeCount = plan.steps.filter(
      (s) => s.type === "route" || s.type === "gather"
    ).length;
    allFactors.push({
      label: `${routeCount}x orchestrator decryption`,
      score: orchestratorPenalty,
      context: "plan",
    });
  }

  // Sort by score descending
  allFactors.sort((a, b) => b.score - a.score);

  for (const f of allFactors) {
    const ctx = f.context !== "plan" ? ` (${f.context})` : "";
    breakdown.push(`+${f.score}  ${f.label}${ctx}`);
  }

  // Build summary
  const summary = `Threat Score: ${total} — ${tier}`;

  return {
    planId: plan.id,
    steps: stepScores,
    subtotal,
    intentPenalty: intentPenalty + orchestratorPenalty,
    total,
    tier,
    summary,
    breakdown,
  };
}

// ============================================================================
// Display Formatting
// ============================================================================

/**
 * Format the threat breakdown for terminal display within the execution plan box.
 */
export function formatThreatBreakdown(score: PlanThreatScore): string[] {
  const lines: string[] = [];
  const BOX_WIDTH = 59; // inner width of the execution plan box

  // Tier indicator colors
  const tierColor: Record<ThreatTier, string> = {
    LOW: "\x1b[32m",      // green
    MODERATE: "\x1b[33m", // yellow/amber
    HIGH: "\x1b[31m",     // red
    CRITICAL: "\x1b[31m", // red
  };
  const reset = "\x1b[0m";
  const color = tierColor[score.tier];

  // Separator
  lines.push("├─────────────────────────────────────────────────────────────┤");

  // Threat score header
  const scoreStr = `Threat Score: ${score.total}`;
  const tierStr = `Tier: ${score.tier}`;
  const headerContent = `${color}${scoreStr}${reset}           ${color}${tierStr}${reset}`;
  // Pad manually accounting for ANSI escape sequences
  const visibleLen = scoreStr.length + "           ".length + tierStr.length;
  const padNeeded = BOX_WIDTH - visibleLen;
  lines.push(`│ ${headerContent}${" ".repeat(Math.max(0, padNeeded))} │`);

  // Breakdown separator
  lines.push("├─────────────────────────────────────────────────────────────┤");

  // Breakdown lines (max 8 for readability)
  const displayLines = score.breakdown.slice(0, 8);
  for (const line of displayLines) {
    const truncated = line.slice(0, BOX_WIDTH);
    const pad = BOX_WIDTH - truncated.length;
    lines.push(`│ ${truncated}${" ".repeat(Math.max(0, pad))} │`);
  }

  if (score.breakdown.length > 8) {
    const moreMsg = `... and ${score.breakdown.length - 8} more factors`;
    const pad = BOX_WIDTH - moreMsg.length;
    lines.push(`│ ${moreMsg}${" ".repeat(Math.max(0, pad))} │`);
  }

  return lines;
}
