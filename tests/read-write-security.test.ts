/**
 * Tests for ReadWriteSecurityController
 *
 * Verifies the security flow for READ_WRITE agents:
 * 1. Sub-intent extraction from task description (before content)
 * 2. Tool call validation against sub-intent and orchestrator intent
 * 3. Re-planning respects original sub-intent
 * 4. Tool limits are enforced
 */

import { describe, it, expect, beforeEach, mock } from "bun:test";
import {
  ReadWriteSecurityController,
  formatSubIntentForPrompt,
  validateSubIntentAgainstOrchestrator,
} from "../src/agents/read-write-security";
import type {
  IntentContext,
  UserIntent,
  AgentSubIntent,
} from "../src/agents/types";

// Mock OpenAI provider for testing
const createMockOpenAI = () => {
  return (modelName: string) => ({
    modelId: modelName,
  });
};

// Create mock intent context for testing
function createMockIntentContext(overrides?: Partial<UserIntent>): IntentContext {
  const intent: UserIntent = {
    id: "test-intent-1",
    originalMessage: "Go to example.com and buy tickets",
    messageHash: "hash123",
    extractedAt: Date.now(),
    category: "read_and_write",
    confidence: "high",
    summary: "Navigate to example.com and purchase tickets",
    permissions: {
      allowedDataSources: ["web"],
      allowedWriteDestinations: ["web-form"],
      explicitlyAllowed: {
        sendEmail: false,
        createDocument: false,
        submitForm: true,
        makePayment: true,
        deleteContent: false,
        shareContent: false,
      },
      explicitlyForbidden: [],
    },
    goals: ["purchase tickets"],
    constraints: [],
    entities: [{ type: "organization", value: "example.com", context: "website" }],
    scope: {},
    canExtractIntent: true,
    ...overrides,
  };

  return {
    intent,
    taskPermissions: {
      readsFrom: ["web"],
      writesTo: ["web-form"],
      operations: ["navigate", "submitForm"],
    },
    strictness: "moderate",
  };
}

// Create mock sub-intent for testing
function createMockSubIntent(overrides?: Partial<AgentSubIntent>): AgentSubIntent {
  return {
    id: "test-sub-intent-1",
    taskDescription: "Navigate to example.com and purchase tickets",
    summary: "Navigate to website and complete ticket purchase",
    expectedToolCategories: ["navigate", "read", "write"],
    expectedTools: ["navigate", "getPageContent", "fillForm", "submitForm"],
    forbiddenOperations: ["sendEmail", "deleteContent"],
    toolLimits: {
      submitForm: 1,
      navigate: 5,
    },
    scope: {
      allowedDomains: ["example.com"],
      allowedFormActions: ["purchase", "buy"],
    },
    extractedAt: Date.now(),
    ...overrides,
  };
}

describe("ReadWriteSecurityController", () => {
  describe("validateToolCall", () => {
    it("should allow tools within expected categories", () => {
      const controller = new ReadWriteSecurityController({
        orchestratorIntent: createMockIntentContext(),
        llmProvider: createMockOpenAI() as any,
        agentType: "browser",
        strictness: "moderate",
      });

      // Manually set sub-intent for testing
      (controller as any).subIntent = createMockSubIntent();

      const result = controller.validateToolCall("navigate", { url: "https://example.com" });

      expect(result.allowed).toBe(true);
      expect(result.severity).toBe("info");
    });

    it("should block forbidden operations", () => {
      // No orchestrator intent to test sub-intent forbidden operations specifically
      const controller = new ReadWriteSecurityController({
        orchestratorIntent: null,
        llmProvider: createMockOpenAI() as any,
        agentType: "browser",
        strictness: "moderate",
      });

      (controller as any).subIntent = createMockSubIntent({
        forbiddenOperations: ["sendEmail", "deleteContent"],
        expectedToolCategories: ["navigate", "read", "write", "input", "other"], // Allow all categories
      });

      const result = controller.validateToolCall("sendEmail", { to: "test@example.com" });

      expect(result.allowed).toBe(false);
      expect(result.severity).toBe("block");
      expect(result.violations.some((v) => v.code === "FORBIDDEN_OPERATION")).toBe(true);
    });

    it("should block tools outside expected categories in strict mode", () => {
      const controller = new ReadWriteSecurityController({
        orchestratorIntent: createMockIntentContext(),
        llmProvider: createMockOpenAI() as any,
        agentType: "browser",
        strictness: "strict",
      });

      (controller as any).subIntent = createMockSubIntent({
        expectedToolCategories: ["navigate", "read"], // No "write"
      });

      const result = controller.validateToolCall("submitForm", { formId: "checkout" });

      expect(result.allowed).toBe(false);
      expect(result.severity).toBe("block");
    });

    it("should enforce tool limits", () => {
      const controller = new ReadWriteSecurityController({
        orchestratorIntent: createMockIntentContext(),
        llmProvider: createMockOpenAI() as any,
        agentType: "browser",
        strictness: "moderate",
      });

      (controller as any).subIntent = createMockSubIntent({
        toolLimits: { submitForm: 1 },
      });

      // First call should succeed
      const result1 = controller.validateToolCall("submitForm", { formId: "checkout" });
      expect(result1.allowed).toBe(true);

      // Second call should be blocked due to limit
      const result2 = controller.validateToolCall("submitForm", { formId: "checkout2" });
      expect(result2.allowed).toBe(false);
      expect(result2.violations.some((v) => v.code === "SCOPE_VIOLATION")).toBe(true);
    });

    it("should enforce domain constraints for navigation", () => {
      const controller = new ReadWriteSecurityController({
        orchestratorIntent: createMockIntentContext(),
        llmProvider: createMockOpenAI() as any,
        agentType: "browser",
        strictness: "moderate",
      });

      (controller as any).subIntent = createMockSubIntent({
        scope: { allowedDomains: ["example.com", "secure.example.com"] },
      });

      // Allowed domain
      const result1 = controller.validateToolCall("navigate", {
        url: "https://example.com/tickets",
      });
      expect(result1.allowed).toBe(true);

      // Blocked domain
      const result2 = controller.validateToolCall("navigate", {
        url: "https://malicious.com/steal",
      });
      expect(result2.allowed).toBe(false);
      expect(result2.violations.some((v) => v.code === "SCOPE_VIOLATION")).toBe(true);
    });

    it("should respect orchestrator intent when blocking", () => {
      const readOnlyIntent = createMockIntentContext({
        category: "read_only",
      });
      readOnlyIntent.strictness = "moderate";

      const controller = new ReadWriteSecurityController({
        orchestratorIntent: readOnlyIntent,
        llmProvider: createMockOpenAI() as any,
        agentType: "browser",
        strictness: "moderate",
      });

      (controller as any).subIntent = createMockSubIntent({
        expectedToolCategories: ["navigate", "read", "write"], // Sub-intent allows write
      });

      // Write operation should be blocked because orchestrator intent is read_only
      const result = controller.validateToolCall("submitForm", { formId: "checkout" });

      // The orchestrator-level validation happens first
      expect(result.allowed).toBe(false);
    });
  });

  describe("getSecurityPrompt", () => {
    it("should include sub-intent summary", () => {
      const controller = new ReadWriteSecurityController({
        orchestratorIntent: createMockIntentContext(),
        llmProvider: createMockOpenAI() as any,
        agentType: "browser",
      });

      (controller as any).subIntent = createMockSubIntent();

      const prompt = controller.getSecurityPrompt();

      expect(prompt).toContain("SECURITY DIRECTIVES");
      expect(prompt).toContain("Navigate to website and complete ticket purchase");
      expect(prompt).toContain("example.com");
    });

    it("should include forbidden operations", () => {
      const controller = new ReadWriteSecurityController({
        orchestratorIntent: createMockIntentContext(),
        llmProvider: createMockOpenAI() as any,
      });

      (controller as any).subIntent = createMockSubIntent({
        forbiddenOperations: ["sendEmail", "deleteContent"],
      });

      const prompt = controller.getSecurityPrompt();

      expect(prompt).toContain("sendEmail");
      expect(prompt).toContain("deleteContent");
    });
  });

  describe("getToolCallCounts", () => {
    it("should track tool call counts", () => {
      const controller = new ReadWriteSecurityController({
        orchestratorIntent: createMockIntentContext(),
        llmProvider: createMockOpenAI() as any,
        agentType: "browser",
      });

      (controller as any).subIntent = createMockSubIntent();

      controller.validateToolCall("navigate", { url: "https://example.com" });
      controller.validateToolCall("navigate", { url: "https://example.com/page2" });
      controller.validateToolCall("getPageContent", {});

      const counts = controller.getToolCallCounts();

      expect(counts.navigate).toBe(2);
      expect(counts.getPageContent).toBe(1);
    });
  });
});

describe("formatSubIntentForPrompt", () => {
  it("should format sub-intent for display", () => {
    const subIntent = createMockSubIntent();
    const formatted = formatSubIntentForPrompt(subIntent);

    expect(formatted).toContain("Agent Sub-Intent");
    expect(formatted).toContain("Navigate to website and complete ticket purchase");
    expect(formatted).toContain("navigate");
    expect(formatted).toContain("read");
    expect(formatted).toContain("write");
    expect(formatted).toContain("example.com");
  });

  it("should include tool limits when present", () => {
    const subIntent = createMockSubIntent({
      toolLimits: { submitForm: 1, navigate: 5 },
    });
    const formatted = formatSubIntentForPrompt(subIntent);

    expect(formatted).toContain("Tool Limits");
    expect(formatted).toContain("submitForm: 1");
    expect(formatted).toContain("navigate: 5");
  });
});

describe("validateSubIntentAgainstOrchestrator", () => {
  it("should pass when sub-intent is within orchestrator bounds", () => {
    const subIntent = createMockSubIntent({
      expectedToolCategories: ["navigate", "read", "write"],
      expectedTools: ["navigate", "getPageContent", "submitForm"],
    });

    const orchestratorIntent: UserIntent = {
      id: "orch-1",
      originalMessage: "Buy tickets",
      messageHash: "hash",
      extractedAt: Date.now(),
      category: "read_and_write",
      confidence: "high",
      summary: "Purchase tickets",
      permissions: {
        allowedDataSources: ["web"],
        allowedWriteDestinations: ["web-form"],
        explicitlyAllowed: {
          sendEmail: false,
          createDocument: false,
          submitForm: true,
          makePayment: true,
          deleteContent: false,
          shareContent: false,
        },
        explicitlyForbidden: [],
      },
      goals: [],
      constraints: [],
      entities: [],
      scope: {},
      canExtractIntent: true,
    };

    const result = validateSubIntentAgainstOrchestrator(subIntent, orchestratorIntent);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("should fail when sub-intent includes write but orchestrator is read_only", () => {
    const subIntent = createMockSubIntent({
      expectedToolCategories: ["navigate", "read", "write"],
    });

    const orchestratorIntent: UserIntent = {
      id: "orch-1",
      originalMessage: "Check ticket availability",
      messageHash: "hash",
      extractedAt: Date.now(),
      category: "read_only",
      confidence: "high",
      summary: "Check availability",
      permissions: {
        allowedDataSources: ["web"],
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
      canExtractIntent: true,
    };

    const result = validateSubIntentAgainstOrchestrator(subIntent, orchestratorIntent);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("write"))).toBe(true);
  });

  it("should fail when sub-intent expects forbidden operation", () => {
    const subIntent = createMockSubIntent({
      expectedTools: ["navigate", "sendEmail"],
    });

    const orchestratorIntent: UserIntent = {
      id: "orch-1",
      originalMessage: "Buy tickets but dont email me",
      messageHash: "hash",
      extractedAt: Date.now(),
      category: "read_and_write",
      confidence: "high",
      summary: "Purchase tickets without email",
      permissions: {
        allowedDataSources: ["web"],
        allowedWriteDestinations: ["web-form"],
        explicitlyAllowed: {
          sendEmail: false,
          createDocument: false,
          submitForm: true,
          makePayment: true,
          deleteContent: false,
          shareContent: false,
        },
        explicitlyForbidden: ["email", "send"],
      },
      goals: [],
      constraints: [],
      entities: [],
      scope: {},
      canExtractIntent: true,
    };

    const result = validateSubIntentAgainstOrchestrator(subIntent, orchestratorIntent);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("sendEmail"))).toBe(true);
  });

  it("should fail when sub-intent expects submitForm but user didnt allow it", () => {
    const subIntent = createMockSubIntent({
      expectedTools: ["navigate", "getPageContent", "submitForm"],
    });

    const orchestratorIntent: UserIntent = {
      id: "orch-1",
      originalMessage: "Check ticket prices",
      messageHash: "hash",
      extractedAt: Date.now(),
      category: "read_only",
      confidence: "high",
      summary: "Check prices only",
      permissions: {
        allowedDataSources: ["web"],
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
      canExtractIntent: true,
    };

    const result = validateSubIntentAgainstOrchestrator(subIntent, orchestratorIntent);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("submitForm"))).toBe(true);
  });
});

describe("Strictness levels", () => {
  it("strict mode should block any category mismatch", () => {
    const controller = new ReadWriteSecurityController({
      orchestratorIntent: createMockIntentContext(),
      llmProvider: createMockOpenAI() as any,
      agentType: "browser",
      strictness: "strict",
    });

    (controller as any).subIntent = createMockSubIntent({
      expectedToolCategories: ["navigate", "read"], // No "other" or "write"
    });

    // "other" category tool should be blocked in strict mode
    const result = controller.validateToolCall("unknownTool", {});

    expect(result.allowed).toBe(false);
    expect(result.severity).toBe("block");
    expect(result.violations.some((v) => v.code === "CATEGORY_MISMATCH")).toBe(true);
  });

  it("moderate mode should block writes but warn on others", () => {
    const controller = new ReadWriteSecurityController({
      orchestratorIntent: createMockIntentContext(),
      llmProvider: createMockOpenAI() as any,
      agentType: "browser",
      strictness: "moderate",
    });

    (controller as any).subIntent = createMockSubIntent({
      expectedToolCategories: ["navigate", "read"],
      forbiddenOperations: [],
    });

    // Write tool (submitForm is in browser write category) should be blocked
    const writeResult = controller.validateToolCall("submitForm", { formId: "test" });
    expect(writeResult.allowed).toBe(false);
    expect(writeResult.severity).toBe("block");
    expect(writeResult.violations.some((v) => v.code === "CATEGORY_MISMATCH")).toBe(true);

    // Unknown tool should be warned but allowed in moderate (not a write, so not blocked)
    const otherResult = controller.validateToolCall("unknownReadTool", {});
    expect(otherResult.allowed).toBe(true);  // Not blocked in moderate mode for non-write tools
    expect(otherResult.severity).toBe("warn");
  });

  it("permissive mode should warn but allow most operations", () => {
    const controller = new ReadWriteSecurityController({
      orchestratorIntent: createMockIntentContext(),
      llmProvider: createMockOpenAI() as any,
      agentType: "browser",
      strictness: "permissive",
    });

    (controller as any).subIntent = createMockSubIntent({
      expectedToolCategories: ["navigate", "read"],
    });

    // Even write tool should be allowed with warning in permissive
    const result = controller.validateToolCall("submitForm", { formId: "test" });

    expect(result.allowed).toBe(true);
    expect(result.severity).toBe("warn");
  });
});
