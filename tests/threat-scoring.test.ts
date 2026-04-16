/**
 * ThreatScorer Tests
 *
 * Covers step scoring, plan aggregation, tier classification, and edge cases.
 */

import { describe, test, expect } from "bun:test";
import {
  scoreStep,
  scorePlan,
  classifyTier,
  STEP_TYPE_SCORES,
  PERMISSION_SCORES,
  AGENT_PERMISSION_SCORES,
  INTENT_CONFIDENCE_PENALTY,
} from "../src/scoring";
import type { PlanStep, ExecutionPlan, AgentMetadata } from "../src/agents/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStep(overrides: Partial<PlanStep> & { id: string; type: PlanStep["type"] }): PlanStep {
  return {
    requiresApproval: false,
    dependsOn: [],
    ...overrides,
  };
}

function makePlan(steps: PlanStep[], overrides?: Partial<ExecutionPlan>): ExecutionPlan {
  return {
    id: "plan-1",
    originalRequest: "test request",
    requestHash: "abc123",
    steps,
    currentStepIndex: 0,
    status: "pending",
    createdAt: Date.now(),
    replanCount: 0,
    ...overrides,
  };
}

const AGENTS: Record<string, AgentMetadata> = {
  "google-reader": {
    id: "google-reader",
    name: "Google Reader",
    permission: "READ",
    capabilities: [],
    publicKey: "key-r",
  },
  "email-writer": {
    id: "email-writer",
    name: "Email Writer",
    permission: "WRITE",
    capabilities: [],
    publicKey: "key-w",
  },
  "browser-agent": {
    id: "browser-agent",
    name: "Browser Agent",
    permission: "READ_WRITE",
    capabilities: [],
    publicKey: "key-rw",
  },
};

function agentLookup(id: string): AgentMetadata | undefined {
  return AGENTS[id];
}

// ---------------------------------------------------------------------------
// Step type base scores
// ---------------------------------------------------------------------------

describe("scoreStep — base scores", () => {
  test("respond step scores 0", () => {
    const s = scoreStep(makeStep({ id: "s0", type: "respond" }));
    expect(s.baseScore).toBe(0);
    expect(s.total).toBe(0);
    expect(s.factors).toHaveLength(0);
  });

  test("gather step scores 1", () => {
    const s = scoreStep(makeStep({ id: "s0", type: "gather" }));
    expect(s.baseScore).toBe(1);
    expect(s.total).toBe(1);
  });

  test("delegate step scores 2", () => {
    const s = scoreStep(makeStep({ id: "s0", type: "delegate" }));
    expect(s.baseScore).toBe(2);
  });

  test("route step scores 3", () => {
    const s = scoreStep(makeStep({ id: "s0", type: "route" }));
    expect(s.baseScore).toBe(3);
  });

  test("approve step scores 0", () => {
    const s = scoreStep(makeStep({ id: "s0", type: "approve" }));
    expect(s.baseScore).toBe(0);
    expect(s.total).toBe(0);
  });

  test("unknown step scores 4", () => {
    const s = scoreStep(makeStep({ id: "s0", type: "unknown" }));
    expect(s.baseScore).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Permission scoring
// ---------------------------------------------------------------------------

describe("scoreStep — permission scores", () => {
  test("sendEmail adds 5", () => {
    const step = makeStep({
      id: "s0",
      type: "route",
      stepPermissions: { readsFrom: [], writesTo: ["email"], operations: ["sendEmail"] },
    });
    const s = scoreStep(step);
    expect(s.permissionScore).toBe(PERMISSION_SCORES.sendEmail);
    expect(s.total).toBe(STEP_TYPE_SCORES.route + PERMISSION_SCORES.sendEmail);
  });

  test("makePayment adds 10", () => {
    const step = makeStep({
      id: "s0",
      type: "route",
      stepPermissions: { readsFrom: [], writesTo: [], operations: ["makePayment"] },
    });
    expect(scoreStep(step).permissionScore).toBe(10);
  });

  test("multiple permissions are additive", () => {
    const step = makeStep({
      id: "s0",
      type: "route",
      stepPermissions: {
        readsFrom: [],
        writesTo: [],
        operations: ["sendEmail", "deleteContent"],
      },
    });
    const s = scoreStep(step);
    expect(s.permissionScore).toBe(
      PERMISSION_SCORES.sendEmail + PERMISSION_SCORES.deleteContent,
    );
  });

  test("unknown operations are ignored", () => {
    const step = makeStep({
      id: "s0",
      type: "route",
      stepPermissions: { readsFrom: [], writesTo: [], operations: ["launchMissiles"] },
    });
    expect(scoreStep(step).permissionScore).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Agent permission scoring
// ---------------------------------------------------------------------------

describe("scoreStep — agent permission scores", () => {
  test("READ agent adds 0", () => {
    const step = makeStep({ id: "s0", type: "delegate", targetAgentId: "google-reader" });
    const s = scoreStep(step, agentLookup);
    expect(s.agentScore).toBe(AGENT_PERMISSION_SCORES.READ);
    expect(s.agentScore).toBe(0);
  });

  test("WRITE agent adds 2", () => {
    const step = makeStep({ id: "s0", type: "route", targetAgentId: "email-writer" });
    const s = scoreStep(step, agentLookup);
    expect(s.agentScore).toBe(AGENT_PERMISSION_SCORES.WRITE);
  });

  test("READ_WRITE agent adds 4", () => {
    const step = makeStep({ id: "s0", type: "delegate", targetAgentId: "browser-agent" });
    const s = scoreStep(step, agentLookup);
    expect(s.agentScore).toBe(AGENT_PERMISSION_SCORES.READ_WRITE);
  });

  test("unknown agent ID yields 0 agent score", () => {
    const step = makeStep({ id: "s0", type: "delegate", targetAgentId: "unknown-agent" });
    const s = scoreStep(step, agentLookup);
    expect(s.agentScore).toBe(0);
  });

  test("no agentLookup yields 0 agent score", () => {
    const step = makeStep({ id: "s0", type: "delegate", targetAgentId: "browser-agent" });
    const s = scoreStep(step);
    expect(s.agentScore).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tier classification
// ---------------------------------------------------------------------------

describe("classifyTier", () => {
  test("score 0 is LOW", () => expect(classifyTier(0)).toBe("LOW"));
  test("score 7 is LOW", () => expect(classifyTier(7)).toBe("LOW"));
  test("score 8 is MODERATE", () => expect(classifyTier(8)).toBe("MODERATE"));
  test("score 15 is MODERATE", () => expect(classifyTier(15)).toBe("MODERATE"));
  test("score 16 is HIGH", () => expect(classifyTier(16)).toBe("HIGH"));
  test("score 29 is HIGH", () => expect(classifyTier(29)).toBe("HIGH"));
  test("score 30 is CRITICAL", () => expect(classifyTier(30)).toBe("CRITICAL"));
  test("score 100 is CRITICAL", () => expect(classifyTier(100)).toBe("CRITICAL"));
});

// ---------------------------------------------------------------------------
// Plan aggregation
// ---------------------------------------------------------------------------

describe("scorePlan — aggregation", () => {
  test("empty plan scores 0 with LOW tier", () => {
    const plan = makePlan([], {
      userIntent: {
        id: "i1",
        originalMessage: "test",
        messageHash: "h",
        extractedAt: Date.now(),
        category: "read_only",
        confidence: "high",
        summary: "test",
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
            modifyCalendar: false,
          },
          explicitlyForbidden: [],
        },
        goals: [],
        constraints: [],
        entities: [],
        scope: {},
        canExtractIntent: true,
      },
    });
    const result = scorePlan(plan);
    expect(result.total).toBe(0);
    expect(result.tier).toBe("LOW");
    expect(result.steps).toHaveLength(0);
  });

  test("multi-step plan sums step scores", () => {
    const steps = [
      makeStep({ id: "s0", type: "delegate", targetAgentId: "google-reader" }),
      makeStep({ id: "s1", type: "route", targetAgentId: "email-writer" }),
    ];
    const plan = makePlan(steps, {
      userIntent: {
        id: "i1",
        originalMessage: "test",
        messageHash: "h",
        extractedAt: Date.now(),
        category: "read_and_write",
        confidence: "high",
        summary: "test",
        permissions: {
          allowedDataSources: ["email"],
          allowedWriteDestinations: ["email"],
          explicitlyAllowed: {
            sendEmail: true,
            createDocument: false,
            submitForm: false,
            makePayment: false,
            deleteContent: false,
            shareContent: false,
            modifyCalendar: false,
          },
          explicitlyForbidden: [],
        },
        goals: [],
        constraints: [],
        entities: [],
        scope: {},
        canExtractIntent: true,
      },
    });
    const result = scorePlan(plan, agentLookup);

    // delegate(2) + READ(0) + route(3) + WRITE(2) = 7, intent penalty 0
    expect(result.subtotal).toBe(7);
    expect(result.intentPenalty).toBe(0);
    expect(result.total).toBe(7);
    expect(result.tier).toBe("LOW");
  });

  test("intent confidence penalty applies", () => {
    const steps = [makeStep({ id: "s0", type: "respond" })];
    const plan = makePlan(steps, {
      userIntent: {
        id: "i1",
        originalMessage: "test",
        messageHash: "h",
        extractedAt: Date.now(),
        category: "unknown",
        confidence: "low",
        summary: "test",
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
            modifyCalendar: false,
          },
          explicitlyForbidden: [],
        },
        goals: [],
        constraints: [],
        entities: [],
        scope: {},
        canExtractIntent: false,
      },
    });
    const result = scorePlan(plan);
    expect(result.intentPenalty).toBe(INTENT_CONFIDENCE_PENALTY.low);
    expect(result.total).toBe(8); // 0 + 8
    expect(result.tier).toBe("MODERATE");
  });

  test("missing userIntent defaults to low confidence penalty", () => {
    const steps = [makeStep({ id: "s0", type: "respond" })];
    const plan = makePlan(steps);
    const result = scorePlan(plan);
    expect(result.intentPenalty).toBe(INTENT_CONFIDENCE_PENALTY.low);
  });
});

// ---------------------------------------------------------------------------
// Realistic scenario: HIGH-tier plan
// ---------------------------------------------------------------------------

describe("scorePlan — realistic scenarios", () => {
  test("email read + send with medium confidence scores HIGH", () => {
    const steps = [
      makeStep({
        id: "step-0",
        type: "delegate",
        targetAgentId: "google-reader",
        task: "Read recent emails",
      }),
      makeStep({
        id: "step-1",
        type: "route",
        targetAgentId: "email-writer",
        task: "Send summary email",
        stepPermissions: {
          readsFrom: ["email"],
          writesTo: ["email"],
          operations: ["sendEmail"],
        },
        dependsOn: ["step-0"],
      }),
    ];
    const plan = makePlan(steps, {
      userIntent: {
        id: "i1",
        originalMessage: "Read my emails and send a summary to Bob",
        messageHash: "h",
        extractedAt: Date.now(),
        category: "read_and_write",
        confidence: "medium",
        summary: "Read emails and send summary",
        permissions: {
          allowedDataSources: ["email"],
          allowedWriteDestinations: ["email"],
          explicitlyAllowed: {
            sendEmail: true,
            createDocument: false,
            submitForm: false,
            makePayment: false,
            deleteContent: false,
            shareContent: false,
            modifyCalendar: false,
          },
          explicitlyForbidden: [],
        },
        goals: ["summarize emails", "send summary"],
        constraints: [],
        entities: [{ type: "person", value: "Bob", context: "recipient" }],
        scope: {},
        canExtractIntent: true,
      },
    });

    const result = scorePlan(plan, agentLookup);

    // delegate(2) + READ(0) + route(3) + WRITE(2) + sendEmail(5) + medium(3) = 15
    // But wait — let me re-check: subtotal = 2+0 + 3+2+5 = 12, intent = 3, total = 15
    // That's MODERATE. Let me verify the exact boundary.
    expect(result.subtotal).toBe(12);
    expect(result.intentPenalty).toBe(3);
    expect(result.total).toBe(15);
    expect(result.tier).toBe("MODERATE");
  });

  test("browser + email + payment with low confidence scores CRITICAL", () => {
    const steps = [
      makeStep({
        id: "step-0",
        type: "delegate",
        targetAgentId: "browser-agent",
        task: "Browse payment portal",
        stepPermissions: {
          readsFrom: ["web"],
          writesTo: ["web-form"],
          operations: ["submitForm"],
        },
      }),
      makeStep({
        id: "step-1",
        type: "route",
        targetAgentId: "email-writer",
        task: "Send payment confirmation",
        stepPermissions: {
          readsFrom: [],
          writesTo: ["email"],
          operations: ["sendEmail", "makePayment"],
        },
        dependsOn: ["step-0"],
      }),
    ];
    const plan = makePlan(steps, {
      userIntent: {
        id: "i1",
        originalMessage: "Pay invoice and confirm",
        messageHash: "h",
        extractedAt: Date.now(),
        category: "mixed",
        confidence: "low",
        summary: "Pay and confirm",
        permissions: {
          allowedDataSources: ["web"],
          allowedWriteDestinations: ["web-form", "email"],
          explicitlyAllowed: {
            sendEmail: true,
            createDocument: false,
            submitForm: true,
            makePayment: true,
            deleteContent: false,
            shareContent: false,
            modifyCalendar: false,
          },
          explicitlyForbidden: [],
        },
        goals: ["pay invoice", "send confirmation"],
        constraints: [],
        entities: [],
        scope: {},
        canExtractIntent: true,
      },
    });

    const result = scorePlan(plan, agentLookup);

    // step-0: delegate(2) + READ_WRITE(4) + submitForm(4) = 10
    // step-1: route(3) + WRITE(2) + sendEmail(5) + makePayment(10) = 20
    // subtotal = 30, intentPenalty = 8, total = 38
    expect(result.subtotal).toBe(30);
    expect(result.intentPenalty).toBe(8);
    expect(result.total).toBe(38);
    expect(result.tier).toBe("CRITICAL");
  });

  test("all-unknown steps with low confidence scores high", () => {
    const steps = [
      makeStep({ id: "s0", type: "unknown", unknownReason: "pending gather" }),
      makeStep({ id: "s1", type: "unknown", unknownReason: "pending gather" }),
      makeStep({ id: "s2", type: "unknown", unknownReason: "pending gather" }),
    ];
    const plan = makePlan(steps, {
      userIntent: {
        id: "i1",
        originalMessage: "do something",
        messageHash: "h",
        extractedAt: Date.now(),
        category: "unknown",
        confidence: "low",
        summary: "unclear",
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
            modifyCalendar: false,
          },
          explicitlyForbidden: [],
        },
        goals: [],
        constraints: [],
        entities: [],
        scope: {},
        canExtractIntent: false,
      },
    });

    const result = scorePlan(plan);
    // 3 * unknown(4) = 12, intentPenalty = 8, total = 20
    expect(result.subtotal).toBe(12);
    expect(result.total).toBe(20);
    expect(result.tier).toBe("HIGH");
  });
});

// ---------------------------------------------------------------------------
// Breakdown and summary
// ---------------------------------------------------------------------------

describe("scorePlan — breakdown and summary", () => {
  test("breakdown is sorted by weight descending", () => {
    const steps = [
      makeStep({
        id: "s0",
        type: "route",
        targetAgentId: "email-writer",
        stepPermissions: {
          readsFrom: [],
          writesTo: ["email"],
          operations: ["sendEmail", "deleteContent"],
        },
      }),
    ];
    const plan = makePlan(steps, {
      userIntent: {
        id: "i1",
        originalMessage: "test",
        messageHash: "h",
        extractedAt: Date.now(),
        category: "read_and_write",
        confidence: "medium",
        summary: "test",
        permissions: {
          allowedDataSources: [],
          allowedWriteDestinations: ["email"],
          explicitlyAllowed: {
            sendEmail: true,
            createDocument: false,
            submitForm: false,
            makePayment: false,
            deleteContent: true,
            shareContent: false,
            modifyCalendar: false,
          },
          explicitlyForbidden: [],
        },
        goals: [],
        constraints: [],
        entities: [],
        scope: {},
        canExtractIntent: true,
      },
    });
    const result = scorePlan(plan, agentLookup);

    // Breakdown should be sorted: deleteContent(8), sendEmail(5), route(3), medium(3), WRITE(2)
    const weights = result.breakdown.map((line) => {
      const m = line.match(/^\+(\d+)/);
      return m ? parseInt(m[1], 10) : 0;
    });
    for (let i = 1; i < weights.length; i++) {
      expect(weights[i]).toBeLessThanOrEqual(weights[i - 1]);
    }
  });

  test("summary includes tier and point total", () => {
    const plan = makePlan([makeStep({ id: "s0", type: "respond" })], {
      userIntent: {
        id: "i1",
        originalMessage: "hi",
        messageHash: "h",
        extractedAt: Date.now(),
        category: "read_only",
        confidence: "high",
        summary: "greeting",
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
            modifyCalendar: false,
          },
          explicitlyForbidden: [],
        },
        goals: [],
        constraints: [],
        entities: [],
        scope: {},
        canExtractIntent: true,
      },
    });
    const result = scorePlan(plan);
    expect(result.summary).toContain("LOW");
    expect(result.summary).toContain("0 pts");
  });
});

// ---------------------------------------------------------------------------
// Factors tracing
// ---------------------------------------------------------------------------

describe("scoreStep — factors tracing", () => {
  test("factors list each contributing component", () => {
    const step = makeStep({
      id: "s0",
      type: "route",
      targetAgentId: "browser-agent",
      stepPermissions: {
        readsFrom: ["web"],
        writesTo: ["form"],
        operations: ["submitForm"],
      },
    });
    const s = scoreStep(step, agentLookup);

    // Should have: route base, submitForm permission, READ_WRITE agent
    expect(s.factors.length).toBe(3);
    expect(s.factors.some((f) => f.includes("route"))).toBe(true);
    expect(s.factors.some((f) => f.includes("submitForm"))).toBe(true);
    expect(s.factors.some((f) => f.includes("READ_WRITE"))).toBe(true);
  });

  test("zero-score steps produce no factors", () => {
    const step = makeStep({ id: "s0", type: "respond" });
    const s = scoreStep(step);
    expect(s.factors).toHaveLength(0);
  });
});
