/**
 * Threat Scoring Tests
 *
 * Unit tests for step scoring, plan aggregation, tier classification,
 * and display formatting.
 */

import { describe, test, expect } from "bun:test";
import {
  scoreStep,
  scorePlan,
  formatThreatBreakdown,
  type StepThreatScore,
  type PlanThreatScore,
} from "../src/scoring";
import type { ExecutionPlan, PlanStep } from "../src/agents/types";

// ============================================================================
// Helpers
// ============================================================================

function makeStep(overrides: Partial<PlanStep> & { id: string; type: PlanStep["type"] }): PlanStep {
  return {
    requiresApproval: false,
    dependsOn: [],
    ...overrides,
  };
}

function makePlan(steps: PlanStep[], overrides?: Partial<ExecutionPlan>): ExecutionPlan {
  return {
    id: "test-plan-id",
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

const AGENTS = [
  { id: "google-reader", permission: "READ" as const },
  { id: "email-writer", permission: "WRITE" as const },
  { id: "browser-agent", permission: "READ_WRITE" as const },
  { id: "gdocs-writer", permission: "WRITE" as const },
];

// ============================================================================
// Step Scoring
// ============================================================================

describe("scoreStep", () => {
  test("respond step has zero score", () => {
    const step = makeStep({ id: "step-0", type: "respond" });
    const result = scoreStep(step, AGENTS);
    expect(result.total).toBe(0);
    expect(result.factors).toHaveLength(0);
  });

  test("approve step has zero score", () => {
    const step = makeStep({ id: "step-0", type: "approve" });
    const result = scoreStep(step, AGENTS);
    expect(result.total).toBe(0);
  });

  test("gather step has base score of 1", () => {
    const step = makeStep({ id: "step-0", type: "gather", targetAgentId: "google-reader" });
    const result = scoreStep(step, AGENTS);
    expect(result.baseScore).toBe(1);
    // READ agent adds 0 agent score
    expect(result.agentScore).toBe(0);
    expect(result.total).toBe(1);
  });

  test("delegate to READ agent scores base only", () => {
    const step = makeStep({ id: "step-0", type: "delegate", targetAgentId: "google-reader" });
    const result = scoreStep(step, AGENTS);
    expect(result.baseScore).toBe(2);
    expect(result.agentScore).toBe(0);
    expect(result.total).toBe(2);
  });

  test("route to WRITE agent adds agent weight", () => {
    const step = makeStep({ id: "step-1", type: "route", targetAgentId: "email-writer" });
    const result = scoreStep(step, AGENTS);
    expect(result.baseScore).toBe(3);
    expect(result.agentScore).toBe(2); // WRITE agent
    expect(result.total).toBe(5);
  });

  test("delegate to READ_WRITE agent adds highest agent weight", () => {
    const step = makeStep({ id: "step-0", type: "delegate", targetAgentId: "browser-agent" });
    const result = scoreStep(step, AGENTS);
    expect(result.baseScore).toBe(2);
    expect(result.agentScore).toBe(4); // READ_WRITE agent
    expect(result.total).toBe(6);
  });

  test("unknown step type has highest base score", () => {
    const step = makeStep({ id: "step-0", type: "unknown" });
    const result = scoreStep(step, AGENTS);
    expect(result.baseScore).toBe(4);
  });

  test("step with explicit permissions adds permission scores", () => {
    const step = makeStep({
      id: "step-0",
      type: "route",
      targetAgentId: "email-writer",
      stepPermissions: {
        readsFrom: [],
        writesTo: ["email-send"],
        operations: ["sendEmail"],
      },
    });
    const result = scoreStep(step, AGENTS);
    expect(result.permissionScore).toBe(5); // sendEmail = +5
    expect(result.total).toBe(3 + 5 + 2); // base + perm + agent(WRITE)
  });

  test("step with multiple permissions sums them", () => {
    const step = makeStep({
      id: "step-0",
      type: "route",
      targetAgentId: "email-writer",
      stepPermissions: {
        readsFrom: [],
        writesTo: ["email-send"],
        operations: ["sendEmail", "deleteContent"],
      },
    });
    const result = scoreStep(step, AGENTS);
    expect(result.permissionScore).toBe(5 + 8); // sendEmail + deleteContent
  });

  test("step with unknown agent skips agent score", () => {
    const step = makeStep({ id: "step-0", type: "delegate", targetAgentId: "unknown-agent" });
    const result = scoreStep(step, AGENTS);
    expect(result.agentScore).toBe(0);
    expect(result.total).toBe(2); // base only
  });

  test("step with no targetAgentId has zero agent score", () => {
    const step = makeStep({ id: "step-0", type: "respond" });
    const result = scoreStep(step, AGENTS);
    expect(result.agentScore).toBe(0);
  });

  test("factors list describes each contributing factor", () => {
    const step = makeStep({
      id: "step-0",
      type: "route",
      targetAgentId: "email-writer",
      stepPermissions: {
        readsFrom: [],
        writesTo: ["email-send"],
        operations: ["sendEmail"],
      },
    });
    const result = scoreStep(step, AGENTS);
    expect(result.factors).toContainEqual(expect.stringContaining("route step"));
    expect(result.factors).toContainEqual(expect.stringContaining("sendEmail"));
    expect(result.factors).toContainEqual(expect.stringContaining("WRITE agent"));
  });
});

// ============================================================================
// Plan Scoring
// ============================================================================

describe("scorePlan", () => {
  test("empty plan with high-confidence intent has zero score and LOW tier", () => {
    const plan = makePlan([], {
      userIntent: {
        id: "i", originalMessage: "t", messageHash: "h",
        extractedAt: Date.now(), category: "read_only", confidence: "high",
        summary: "t",
        permissions: {
          allowedDataSources: [], allowedWriteDestinations: [],
          explicitlyAllowed: {
            sendEmail: false, createDocument: false, submitForm: false,
            makePayment: false, deleteContent: false, shareContent: false,
            modifyCalendar: false,
          },
          explicitlyForbidden: [],
        },
        goals: [], constraints: [], entities: [], scope: {},
        canExtractIntent: true,
      },
    });
    const result = scorePlan(plan, AGENTS);
    expect(result.total).toBe(0);
    expect(result.tier).toBe("LOW");
    expect(result.steps).toHaveLength(0);
  });

  test("simple read-only plan scores LOW", () => {
    const plan = makePlan([
      makeStep({ id: "step-0", type: "delegate", targetAgentId: "google-reader" }),
      makeStep({ id: "step-1", type: "respond" }),
    ], {
      userIntent: {
        id: "intent-1",
        originalMessage: "summarize emails",
        messageHash: "hash",
        extractedAt: Date.now(),
        category: "read_only",
        confidence: "high",
        summary: "Summarize emails",
        permissions: {
          allowedDataSources: ["email"],
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
        goals: ["summarize emails"],
        constraints: [],
        entities: [],
        scope: {},
        canExtractIntent: true,
      },
    });
    const result = scorePlan(plan, AGENTS);
    // delegate(2) + respond(0) + intent high(0) = 2
    expect(result.total).toBe(2);
    expect(result.tier).toBe("LOW");
  });

  test("plan with route steps incurs orchestrator decryption penalty", () => {
    const plan = makePlan([
      makeStep({ id: "step-0", type: "delegate", targetAgentId: "google-reader" }),
      makeStep({ id: "step-1", type: "route", targetAgentId: "gdocs-writer" }),
      makeStep({ id: "step-2", type: "respond" }),
    ], {
      userIntent: {
        id: "intent-1",
        originalMessage: "save to doc",
        messageHash: "hash",
        extractedAt: Date.now(),
        category: "read_and_write",
        confidence: "high",
        summary: "Save emails to doc",
        permissions: {
          allowedDataSources: ["email"],
          allowedWriteDestinations: ["google-docs"],
          explicitlyAllowed: {
            sendEmail: false,
            createDocument: true,
            submitForm: false,
            makePayment: false,
            deleteContent: false,
            shareContent: false,
            modifyCalendar: false,
          },
          explicitlyForbidden: [],
        },
        goals: ["save to doc"],
        constraints: [],
        entities: [],
        scope: {},
        canExtractIntent: true,
      },
    });
    const result = scorePlan(plan, AGENTS);
    // delegate(2) + route(3+WRITE 2) + respond(0) + orch_decrypt(2 for route) + intent high(0) = 9
    expect(result.total).toBe(9);
    expect(result.tier).toBe("MODERATE");
  });

  test("low confidence intent adds penalty", () => {
    const plan = makePlan([
      makeStep({ id: "step-0", type: "delegate", targetAgentId: "google-reader" }),
      makeStep({ id: "step-1", type: "respond" }),
    ], {
      userIntent: {
        id: "intent-1",
        originalMessage: "do stuff",
        messageHash: "hash",
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
    const result = scorePlan(plan, AGENTS);
    // delegate(2) + respond(0) + intent low(8) = 10
    expect(result.total).toBe(10);
    expect(result.tier).toBe("MODERATE");
    expect(result.intentPenalty).toBe(8);
  });

  test("medium confidence adds moderate penalty", () => {
    const plan = makePlan([
      makeStep({ id: "step-0", type: "respond" }),
    ], {
      userIntent: {
        id: "intent-1",
        originalMessage: "test",
        messageHash: "hash",
        extractedAt: Date.now(),
        category: "read_only",
        confidence: "medium",
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
    const result = scorePlan(plan, AGENTS);
    expect(result.intentPenalty).toBe(3);
  });

  test("plan without userIntent defaults to low confidence penalty", () => {
    const plan = makePlan([
      makeStep({ id: "step-0", type: "respond" }),
    ]);
    const result = scorePlan(plan, AGENTS);
    // No intent → defaults to low confidence = 8
    expect(result.intentPenalty).toBe(8);
  });

  test("high-risk plan with payments scores CRITICAL", () => {
    const plan = makePlan([
      makeStep({ id: "step-0", type: "delegate", targetAgentId: "browser-agent" }),
      makeStep({
        id: "step-1",
        type: "route",
        targetAgentId: "email-writer",
        stepPermissions: {
          readsFrom: [],
          writesTo: ["email-send", "payment"],
          operations: ["sendEmail", "makePayment", "deleteContent"],
        },
      }),
      makeStep({ id: "step-2", type: "respond" }),
    ], {
      userIntent: {
        id: "intent-1",
        originalMessage: "do dangerous stuff",
        messageHash: "hash",
        extractedAt: Date.now(),
        category: "mixed",
        confidence: "low",
        summary: "dangerous",
        permissions: {
          allowedDataSources: [],
          allowedWriteDestinations: [],
          explicitlyAllowed: {
            sendEmail: true,
            createDocument: false,
            submitForm: false,
            makePayment: true,
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
    const result = scorePlan(plan, AGENTS);
    // delegate(2+RW 4) + route(3+sendEmail 5+makePayment 10+delete 8+WRITE 2) + respond(0)
    // + orch_decrypt(2 for route) + intent low(8) = 6+28+0+2+8 = 44
    expect(result.total).toBe(44);
    expect(result.tier).toBe("CRITICAL");
  });

  test("subtotal is sum of step scores", () => {
    const plan = makePlan([
      makeStep({ id: "step-0", type: "delegate", targetAgentId: "google-reader" }),
      makeStep({ id: "step-1", type: "route", targetAgentId: "email-writer" }),
    ], {
      userIntent: {
        id: "i",
        originalMessage: "t",
        messageHash: "h",
        extractedAt: Date.now(),
        category: "read_and_write",
        confidence: "high",
        summary: "t",
        permissions: {
          allowedDataSources: [],
          allowedWriteDestinations: [],
          explicitlyAllowed: {
            sendEmail: false, createDocument: false, submitForm: false,
            makePayment: false, deleteContent: false, shareContent: false,
            modifyCalendar: false,
          },
          explicitlyForbidden: [],
        },
        goals: [], constraints: [], entities: [], scope: {},
        canExtractIntent: true,
      },
    });
    const result = scorePlan(plan, AGENTS);
    const expectedSubtotal = result.steps.reduce((sum, s) => sum + s.total, 0);
    expect(result.subtotal).toBe(expectedSubtotal);
  });

  test("breakdown is sorted by score descending", () => {
    const plan = makePlan([
      makeStep({
        id: "step-0",
        type: "route",
        targetAgentId: "email-writer",
        stepPermissions: {
          readsFrom: [],
          writesTo: [],
          operations: ["sendEmail", "createDocument"],
        },
      }),
    ], {
      userIntent: {
        id: "i",
        originalMessage: "t",
        messageHash: "h",
        extractedAt: Date.now(),
        category: "write_only",
        confidence: "high",
        summary: "t",
        permissions: {
          allowedDataSources: [],
          allowedWriteDestinations: [],
          explicitlyAllowed: {
            sendEmail: true, createDocument: true, submitForm: false,
            makePayment: false, deleteContent: false, shareContent: false,
            modifyCalendar: false,
          },
          explicitlyForbidden: [],
        },
        goals: [], constraints: [], entities: [], scope: {},
        canExtractIntent: true,
      },
    });
    const result = scorePlan(plan, AGENTS);
    // Extract scores from breakdown lines
    const scores = result.breakdown.map((line) => {
      const match = line.match(/^\+(\d+)/);
      return match ? parseInt(match[1], 10) : 0;
    });
    // Verify descending order
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
    }
  });

  test("summary contains score and tier", () => {
    const plan = makePlan([
      makeStep({ id: "step-0", type: "respond" }),
    ]);
    const result = scorePlan(plan, AGENTS);
    expect(result.summary).toContain(String(result.total));
    expect(result.summary).toContain(result.tier);
  });

  test("planId matches plan id", () => {
    const plan = makePlan([], { id: "my-test-id" });
    const result = scorePlan(plan, AGENTS);
    expect(result.planId).toBe("my-test-id");
  });
});

// ============================================================================
// Display Formatting
// ============================================================================

describe("formatThreatBreakdown", () => {
  function makeScore(overrides: Partial<PlanThreatScore>): PlanThreatScore {
    return {
      planId: "test",
      steps: [],
      subtotal: 0,
      intentPenalty: 0,
      total: 0,
      tier: "LOW",
      summary: "Threat Score: 0 — LOW",
      breakdown: [],
      ...overrides,
    };
  }

  test("returns lines for LOW tier score", () => {
    const score = makeScore({ total: 2, tier: "LOW", breakdown: ["+2  gather step (step-0)"] });
    const lines = formatThreatBreakdown(score);
    expect(lines.length).toBeGreaterThan(0);
    // Should contain the score value
    const joined = lines.join("\n");
    expect(joined).toContain("Threat Score: 2");
    expect(joined).toContain("LOW");
  });

  test("returns lines for CRITICAL tier score", () => {
    const score = makeScore({
      total: 35,
      tier: "CRITICAL",
      breakdown: [
        "+10  makePayment permission (step-1)",
        "+8   deleteContent permission (step-1)",
        "+5   sendEmail permission (step-1)",
      ],
    });
    const lines = formatThreatBreakdown(score);
    const joined = lines.join("\n");
    expect(joined).toContain("CRITICAL");
    expect(joined).toContain("makePayment");
  });

  test("truncates breakdown to 8 lines max", () => {
    const breakdown = Array.from({ length: 12 }, (_, i) => `+${i}  factor ${i}`);
    const score = makeScore({ total: 50, tier: "CRITICAL", breakdown });
    const lines = formatThreatBreakdown(score);
    const joined = lines.join("\n");
    // Should show "... and X more factors"
    expect(joined).toContain("... and 4 more factors");
  });

  test("breakdown lines fit within box width", () => {
    const score = makeScore({
      total: 10,
      tier: "MODERATE",
      breakdown: ["+5  a very long factor description that might overflow"],
    });
    const lines = formatThreatBreakdown(score);
    // Each content line should have the box structure
    for (const line of lines) {
      if (line.startsWith("│")) {
        expect(line).toMatch(/│$/);
      }
    }
  });

  test("empty breakdown produces header only", () => {
    const score = makeScore({ total: 0, tier: "LOW", breakdown: [] });
    const lines = formatThreatBreakdown(score);
    // Should have separator + header + separator (no breakdown lines)
    expect(lines.length).toBe(3);
  });
});

// ============================================================================
// Integration: scorePlan produces expected tiers for realistic plans
// ============================================================================

describe("realistic plan scoring", () => {
  test("read email plan is LOW", () => {
    const plan = makePlan([
      makeStep({ id: "step-0", type: "delegate", targetAgentId: "google-reader" }),
      makeStep({ id: "step-1", type: "respond" }),
    ], {
      userIntent: {
        id: "i", originalMessage: "summarize my emails", messageHash: "h",
        extractedAt: Date.now(), category: "read_only", confidence: "high",
        summary: "Summarize emails",
        permissions: {
          allowedDataSources: ["email"], allowedWriteDestinations: [],
          explicitlyAllowed: {
            sendEmail: false, createDocument: false, submitForm: false,
            makePayment: false, deleteContent: false, shareContent: false,
            modifyCalendar: false,
          },
          explicitlyForbidden: [],
        },
        goals: ["summarize"], constraints: [], entities: [], scope: {},
        canExtractIntent: true,
      },
    });
    const result = scorePlan(plan, AGENTS);
    expect(result.tier).toBe("LOW");
  });

  test("read-then-write plan is MODERATE", () => {
    const plan = makePlan([
      makeStep({ id: "step-0", type: "delegate", targetAgentId: "google-reader" }),
      makeStep({ id: "step-1", type: "route", targetAgentId: "gdocs-writer" }),
      makeStep({ id: "step-2", type: "respond" }),
    ], {
      userIntent: {
        id: "i", originalMessage: "save emails to doc", messageHash: "h",
        extractedAt: Date.now(), category: "read_and_write", confidence: "high",
        summary: "Save emails to doc",
        permissions: {
          allowedDataSources: ["email"], allowedWriteDestinations: ["google-docs"],
          explicitlyAllowed: {
            sendEmail: false, createDocument: true, submitForm: false,
            makePayment: false, deleteContent: false, shareContent: false,
            modifyCalendar: false,
          },
          explicitlyForbidden: [],
        },
        goals: ["save to doc"], constraints: [], entities: [], scope: {},
        canExtractIntent: true,
      },
    });
    const result = scorePlan(plan, AGENTS);
    expect(result.tier).toBe("MODERATE");
  });

  test("send email plan with medium confidence approaches HIGH", () => {
    const plan = makePlan([
      makeStep({ id: "step-0", type: "delegate", targetAgentId: "google-reader" }),
      makeStep({
        id: "step-1",
        type: "route",
        targetAgentId: "email-writer",
        stepPermissions: {
          readsFrom: [],
          writesTo: ["email-send"],
          operations: ["sendEmail"],
        },
      }),
      makeStep({ id: "step-2", type: "respond" }),
    ], {
      userIntent: {
        id: "i", originalMessage: "reply to that email", messageHash: "h",
        extractedAt: Date.now(), category: "read_and_write", confidence: "medium",
        summary: "Reply to email",
        permissions: {
          allowedDataSources: ["email"], allowedWriteDestinations: ["email-send"],
          explicitlyAllowed: {
            sendEmail: true, createDocument: false, submitForm: false,
            makePayment: false, deleteContent: false, shareContent: false,
            modifyCalendar: false,
          },
          explicitlyForbidden: [],
        },
        goals: ["reply to email"], constraints: [], entities: [], scope: {},
        canExtractIntent: true,
      },
    });
    const result = scorePlan(plan, AGENTS);
    // delegate(2) + route(3+sendEmail 5+WRITE 2) + respond(0) + orch(2) + medium(3) = 17
    expect(result.total).toBe(17);
    expect(result.tier).toBe("HIGH");
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe("edge cases", () => {
  test("plan with all unknown steps scores high", () => {
    const plan = makePlan([
      makeStep({ id: "step-0", type: "unknown" }),
      makeStep({ id: "step-1", type: "unknown" }),
      makeStep({ id: "step-2", type: "unknown" }),
    ]);
    const result = scorePlan(plan, AGENTS);
    // 3 × unknown(4) + no-intent low(8) = 20
    expect(result.total).toBe(20);
    expect(result.tier).toBe("HIGH");
  });

  test("plan with only approve steps has low score", () => {
    const plan = makePlan([
      makeStep({ id: "step-0", type: "approve" }),
      makeStep({ id: "step-1", type: "approve" }),
    ], {
      userIntent: {
        id: "i", originalMessage: "test", messageHash: "h",
        extractedAt: Date.now(), category: "read_only", confidence: "high",
        summary: "test",
        permissions: {
          allowedDataSources: [], allowedWriteDestinations: [],
          explicitlyAllowed: {
            sendEmail: false, createDocument: false, submitForm: false,
            makePayment: false, deleteContent: false, shareContent: false,
            modifyCalendar: false,
          },
          explicitlyForbidden: [],
        },
        goals: [], constraints: [], entities: [], scope: {},
        canExtractIntent: true,
      },
    });
    const result = scorePlan(plan, AGENTS);
    expect(result.total).toBe(0);
    expect(result.tier).toBe("LOW");
  });

  test("scoreStep with unrecognized permission operation ignores it", () => {
    const step = makeStep({
      id: "step-0",
      type: "route",
      targetAgentId: "email-writer",
      stepPermissions: {
        readsFrom: [],
        writesTo: [],
        operations: ["nonExistentPermission"],
      },
    });
    const result = scoreStep(step, AGENTS);
    expect(result.permissionScore).toBe(0);
  });

  test("gather steps incur orchestrator decryption penalty", () => {
    const plan = makePlan([
      makeStep({ id: "step-0", type: "gather", targetAgentId: "google-reader" }),
      makeStep({ id: "step-1", type: "respond" }),
    ], {
      userIntent: {
        id: "i", originalMessage: "test", messageHash: "h",
        extractedAt: Date.now(), category: "read_only", confidence: "high",
        summary: "test",
        permissions: {
          allowedDataSources: [], allowedWriteDestinations: [],
          explicitlyAllowed: {
            sendEmail: false, createDocument: false, submitForm: false,
            makePayment: false, deleteContent: false, shareContent: false,
            modifyCalendar: false,
          },
          explicitlyForbidden: [],
        },
        goals: [], constraints: [], entities: [], scope: {},
        canExtractIntent: true,
      },
    });
    const result = scorePlan(plan, AGENTS);
    // gather(1) + respond(0) + orch_decrypt(2) + high(0) = 3
    expect(result.total).toBe(3);
  });
});
