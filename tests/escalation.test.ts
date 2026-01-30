/**
 * Tests for Escalation Service
 */

import { describe, test, expect, beforeEach, mock } from "bun:test";
import {
  EscalationService,
  initEscalationService,
  getEscalationService,
  type EscalationUIHandler,
  type EscalationForwardHandler,
} from "../src/services/escalation";
import type {
  WorkerEscalationMessage,
  EscalationApprovalRequest,
  EscalationApprovalResponse,
} from "../src/agents/types";

describe("EscalationService", () => {
  let service: EscalationService;

  beforeEach(() => {
    service = initEscalationService();
  });

  describe("agent registration", () => {
    test("registers agents with names", () => {
      service.registerAgent("agent-1", "Test Agent 1");
      service.registerAgent("agent-2", "Test Agent 2");
      // No direct way to query, but should not throw
    });
  });

  describe("handler configuration", () => {
    test("sets UI handler", () => {
      const handler: EscalationUIHandler = async () => ({
        requestId: "test",
        outcome: "approve",
        respondedAt: Date.now(),
      });
      service.setUIHandler(handler);
      // No direct way to query, but should not throw
    });

    test("sets forward handler", () => {
      const handler: EscalationForwardHandler = async () => "response";
      service.setForwardHandler(handler);
      // No direct way to query, but should not throw
    });
  });

  describe("processEscalation", () => {
    const testEscalation: WorkerEscalationMessage["escalation"] = {
      escalationId: "esc-123",
      requestText: "Can you help me with this?",
      reason: "Need additional information",
      originalTaskId: "task-456",
    };

    test("returns denial when no UI handler is configured", async () => {
      const result = await service.processEscalation("agent-1", testEscalation);

      expect(result.escalationId).toBe("esc-123");
      expect(result.resolution).toBe("denied");
      expect(result.respondedBy).toBe("user");
      expect(result.denialReason).toBe("No UI handler configured");
    });

    test("handles user approval and forwards to orchestrator", async () => {
      const uiHandler: EscalationUIHandler = async () => ({
        requestId: "esc-123",
        outcome: "approve",
        respondedAt: Date.now(),
      });

      const forwardHandler: EscalationForwardHandler = async (escalation, sourceAgentId) => {
        expect(escalation.requestText).toBe("Can you help me with this?");
        expect(sourceAgentId).toBe("agent-1");
        return "Orchestrator response";
      };

      service.setUIHandler(uiHandler);
      service.setForwardHandler(forwardHandler);
      service.registerAgent("agent-1", "Test Agent");

      const result = await service.processEscalation("agent-1", testEscalation);

      expect(result.escalationId).toBe("esc-123");
      expect(result.resolution).toBe("approved");
      expect(result.content).toBe("Orchestrator response");
      expect(result.respondedBy).toBe("orchestrator");
    });

    test("handles approval without forward handler", async () => {
      const uiHandler: EscalationUIHandler = async () => ({
        requestId: "esc-123",
        outcome: "approve",
        respondedAt: Date.now(),
      });

      service.setUIHandler(uiHandler);

      const result = await service.processEscalation("agent-1", testEscalation);

      expect(result.resolution).toBe("denied");
      expect(result.denialReason).toBe("No forward handler configured");
    });

    test("handles user denial", async () => {
      const uiHandler: EscalationUIHandler = async () => ({
        requestId: "esc-123",
        outcome: "deny",
        denialReason: "Not needed right now",
        respondedAt: Date.now(),
      });

      service.setUIHandler(uiHandler);

      const result = await service.processEscalation("agent-1", testEscalation);

      expect(result.escalationId).toBe("esc-123");
      expect(result.resolution).toBe("denied");
      expect(result.respondedBy).toBe("user");
      expect(result.denialReason).toBe("Not needed right now");
    });

    test("handles direct user response", async () => {
      const uiHandler: EscalationUIHandler = async () => ({
        requestId: "esc-123",
        outcome: "direct_response",
        directResponse: "Here is the information you need: ABC123",
        respondedAt: Date.now(),
      });

      service.setUIHandler(uiHandler);

      const result = await service.processEscalation("agent-1", testEscalation);

      expect(result.escalationId).toBe("esc-123");
      expect(result.resolution).toBe("direct_response");
      expect(result.content).toBe("Here is the information you need: ABC123");
      expect(result.respondedBy).toBe("user");
    });

    test("handles orchestrator error during forwarding", async () => {
      const uiHandler: EscalationUIHandler = async () => ({
        requestId: "esc-123",
        outcome: "approve",
        respondedAt: Date.now(),
      });

      const forwardHandler: EscalationForwardHandler = async () => {
        throw new Error("Orchestrator unavailable");
      };

      service.setUIHandler(uiHandler);
      service.setForwardHandler(forwardHandler);

      const result = await service.processEscalation("agent-1", testEscalation);

      expect(result.resolution).toBe("denied");
      expect(result.respondedBy).toBe("orchestrator");
      expect(result.denialReason).toBe("Orchestrator unavailable");
    });

    test("passes agent name to UI handler", async () => {
      let receivedRequest: EscalationApprovalRequest | null = null;

      const uiHandler: EscalationUIHandler = async (request) => {
        receivedRequest = request;
        return {
          requestId: request.id,
          outcome: "deny",
          respondedAt: Date.now(),
        };
      };

      service.setUIHandler(uiHandler);
      service.registerAgent("agent-1", "Browser Agent");

      await service.processEscalation("agent-1", testEscalation);

      expect(receivedRequest).not.toBeNull();
      expect(receivedRequest!.sourceAgentId).toBe("agent-1");
      expect(receivedRequest!.sourceAgentName).toBe("Browser Agent");
    });

    test("uses agent ID as name if not registered", async () => {
      let receivedRequest: EscalationApprovalRequest | null = null;

      const uiHandler: EscalationUIHandler = async (request) => {
        receivedRequest = request;
        return {
          requestId: request.id,
          outcome: "deny",
          respondedAt: Date.now(),
        };
      };

      service.setUIHandler(uiHandler);
      // Don't register the agent

      await service.processEscalation("unregistered-agent", testEscalation);

      expect(receivedRequest!.sourceAgentName).toBe("unregistered-agent");
    });
  });

  describe("rate limiting", () => {
    test("allows escalations within rate limit", async () => {
      const uiHandler: EscalationUIHandler = async () => ({
        requestId: "test",
        outcome: "deny",
        respondedAt: Date.now(),
      });

      service.setUIHandler(uiHandler);
      service.setRateLimit(5);

      // Should allow 5 escalations
      for (let i = 0; i < 5; i++) {
        const result = await service.processEscalation("agent-1", {
          escalationId: `esc-${i}`,
          requestText: "Request",
          reason: "Reason",
          originalTaskId: "task-1",
        });
        expect(result.resolution).toBe("denied"); // From UI handler
        // Should not be rate limited (denialReason should be undefined from the deny outcome)
        expect(result.denialReason).toBeUndefined();
      }
    });

    test("blocks escalations exceeding rate limit", async () => {
      const uiHandler: EscalationUIHandler = async () => ({
        requestId: "test",
        outcome: "deny",
        respondedAt: Date.now(),
      });

      service.setUIHandler(uiHandler);
      service.setRateLimit(3);

      // First 3 should work
      for (let i = 0; i < 3; i++) {
        await service.processEscalation("agent-1", {
          escalationId: `esc-${i}`,
          requestText: "Request",
          reason: "Reason",
          originalTaskId: "task-1",
        });
      }

      // 4th should be rate limited
      const result = await service.processEscalation("agent-1", {
        escalationId: "esc-4",
        requestText: "Request",
        reason: "Reason",
        originalTaskId: "task-1",
      });

      expect(result.resolution).toBe("denied");
      expect(result.denialReason).toContain("Rate limit exceeded");
    });

    test("rate limits are per-agent", async () => {
      const uiHandler: EscalationUIHandler = async () => ({
        requestId: "test",
        outcome: "deny",
        respondedAt: Date.now(),
      });

      service.setUIHandler(uiHandler);
      service.setRateLimit(2);

      // Agent 1: 2 escalations (at limit)
      for (let i = 0; i < 2; i++) {
        await service.processEscalation("agent-1", {
          escalationId: `esc-1-${i}`,
          requestText: "Request",
          reason: "Reason",
          originalTaskId: "task-1",
        });
      }

      // Agent 2 should still be able to escalate
      const result = await service.processEscalation("agent-2", {
        escalationId: "esc-2-0",
        requestText: "Request",
        reason: "Reason",
        originalTaskId: "task-2",
      });

      // Should not be rate limited (denialReason should be undefined from the deny outcome)
      expect(result.denialReason).toBeUndefined();
    });
  });

  describe("singleton", () => {
    test("getEscalationService returns singleton", () => {
      const service1 = getEscalationService();
      const service2 = getEscalationService();
      expect(service1).toBe(service2);
    });

    test("initEscalationService creates new instance", () => {
      const service1 = getEscalationService();
      const service2 = initEscalationService();
      expect(service1).not.toBe(service2);
      expect(getEscalationService()).toBe(service2);
    });
  });
});

describe("Escalation Types", () => {
  test("EscalationResolution has all required values", async () => {
    // Type check - these should compile
    const resolutions: import("../src/agents/types").EscalationResolution[] = [
      "approved",
      "denied",
      "direct_response",
      "timeout",
    ];
    expect(resolutions).toHaveLength(4);
  });

  test("WorkerEscalationMessage has correct structure", () => {
    const message: import("../src/agents/types").WorkerEscalationMessage = {
      type: "escalation",
      id: "msg-123",
      timestamp: Date.now(),
      escalation: {
        escalationId: "esc-123",
        requestText: "Help needed",
        reason: "Blocking issue",
        originalTaskId: "task-456",
      },
    };

    expect(message.type).toBe("escalation");
    expect(message.escalation.escalationId).toBe("esc-123");
    expect(message.escalation.requestText).toBe("Help needed");
  });

  test("WorkerEscalationResponseMessage has correct structure", () => {
    const message: import("../src/agents/types").WorkerEscalationResponseMessage = {
      type: "escalation_response",
      id: "msg-456",
      timestamp: Date.now(),
      response: {
        escalationId: "esc-123",
        resolution: "approved",
        content: "Here is your answer",
        respondedBy: "orchestrator",
      },
    };

    expect(message.type).toBe("escalation_response");
    expect(message.response.resolution).toBe("approved");
    expect(message.response.respondedBy).toBe("orchestrator");
  });
});
