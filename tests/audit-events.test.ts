/**
 * Audit Events Tests
 *
 * Tests for AuditEntry, AuditEvent types, and factory functions.
 */

import { describe, test, expect } from "bun:test";
import {
  GENESIS_HASH,
  sessionStarted,
  sessionEnded,
  intentExtracted,
  intentValidated,
  intentBlocked,
  planCreated,
  planStepStarted,
  planStepCompleted,
  stepValidated,
  toolValidated,
  permissionChecked,
  permissionDenied,
  escalationRequested,
  escalationResolved,
  approvalRequested,
  approvalGranted,
  approvalDenied,
  packageEncrypted,
  packageRouted,
  packageDecrypted,
  agentRegistered,
  agentDeregistered,
  securityWarning,
  securityViolation,
  type AuditEntry,
  type AuditEvent,
  type AuditEventType,
} from "../src/audit/events";

describe("AuditEvent factory functions", () => {
  test("sessionStarted produces correct type", () => {
    const event = sessionStarted("user-1");
    expect(event.type).toBe("session.started");
    expect(event.userId).toBe("user-1");
  });

  test("sessionEnded produces correct type", () => {
    const event = sessionEnded("timeout");
    expect(event.type).toBe("session.ended");
    expect(event.reason).toBe("timeout");
  });

  test("intentExtracted produces correct type", () => {
    const event = intentExtracted("i-1", "hash123", "read_only", "high", "Read emails");
    expect(event.type).toBe("intent.extracted");
    expect(event.intentId).toBe("i-1");
    expect(event.messageHash).toBe("hash123");
    expect(event.category).toBe("read_only");
    expect(event.confidence).toBe("high");
    expect(event.summary).toBe("Read emails");
  });

  test("intentValidated produces correct type", () => {
    const violations = [{ code: "SCOPE_VIOLATION", detail: "read outside scope" }];
    const event = intentValidated("i-1", "step-1", false, violations);
    expect(event.type).toBe("intent.validated");
    expect(event.allowed).toBe(false);
    expect(event.violations).toHaveLength(1);
  });

  test("intentBlocked produces correct type", () => {
    const event = intentBlocked("i-1", "step-2", "UNAUTHORIZED_WRITE", "Not allowed");
    expect(event.type).toBe("intent.blocked");
    expect(event.errorCode).toBe("UNAUTHORIZED_WRITE");
  });

  test("planCreated produces correct type", () => {
    const event = planCreated("p-1", "reqhash", 3, ["s1", "s2", "s3"]);
    expect(event.type).toBe("plan.created");
    expect(event.stepCount).toBe(3);
    expect(event.stepIds).toEqual(["s1", "s2", "s3"]);
  });

  test("planStepStarted and planStepCompleted", () => {
    const started = planStepStarted("p-1", "s1", "delegate", "agent-reader");
    expect(started.type).toBe("plan.stepStarted");
    expect(started.targetAgentId).toBe("agent-reader");

    const completed = planStepCompleted("p-1", "s1", "completed", "pkg-1");
    expect(completed.type).toBe("plan.stepCompleted");
    expect(completed.status).toBe("completed");
    expect(completed.outputPackageId).toBe("pkg-1");
  });

  test("stepValidated and toolValidated", () => {
    const sv = stepValidated("p-1", "s1", "agent-1", true);
    expect(sv.type).toBe("step.validated");
    expect(sv.allowed).toBe(true);

    const tv = toolValidated("agent-1", "readFile", false, "not permitted");
    expect(tv.type).toBe("tool.validated");
    expect(tv.allowed).toBe(false);
    expect(tv.reason).toBe("not permitted");
  });

  test("permissionChecked and permissionDenied", () => {
    const checked = permissionChecked("agent-1", "READ", "gmail", true);
    expect(checked.type).toBe("permission.checked");
    expect(checked.granted).toBe(true);

    const denied = permissionDenied("agent-1", "WRITE", "calendar", "No write access");
    expect(denied.type).toBe("permission.denied");
    expect(denied.reason).toBe("No write access");
  });

  test("escalationRequested and escalationResolved", () => {
    const req = escalationRequested("esc-1", "agent-1", "Need clarification", "task-1");
    expect(req.type).toBe("escalation.requested");

    const res = escalationResolved("esc-1", "approved", "user");
    expect(res.type).toBe("escalation.resolved");
    expect(res.resolution).toBe("approved");
  });

  test("approvalRequested, approvalGranted, approvalDenied", () => {
    const req = approvalRequested("apr-1", "s1", "agent-reader", "agent-writer", "Send email");
    expect(req.type).toBe("approval.requested");
    expect(req.description).toBe("Send email");

    const granted = approvalGranted("apr-1", false);
    expect(granted.type).toBe("approval.granted");
    expect(granted.modified).toBe(false);

    const denied = approvalDenied("apr-1", "User rejected");
    expect(denied.type).toBe("approval.denied");
    expect(denied.reason).toBe("User rejected");
  });

  test("packageEncrypted, packageRouted, packageDecrypted", () => {
    const enc = packageEncrypted("pkg-1", "agent-reader", ["agent-writer", "user"], "chash");
    expect(enc.type).toBe("package.encrypted");
    expect(enc.recipientIds).toEqual(["agent-writer", "user"]);

    const routed = packageRouted("pkg-1", "s1", "s2", "agent-writer");
    expect(routed.type).toBe("package.routed");

    const dec = packageDecrypted("pkg-1", "agent-writer", true);
    expect(dec.type).toBe("package.decrypted");
    expect(dec.integrityValid).toBe(true);
  });

  test("agentRegistered and agentDeregistered", () => {
    const reg = agentRegistered("agent-1", "Email Reader", "READ", "pubkey123");
    expect(reg.type).toBe("agent.registered");
    expect(reg.permission).toBe("READ");

    const dereg = agentDeregistered("agent-1", "shutdown");
    expect(dereg.type).toBe("agent.deregistered");
    expect(dereg.reason).toBe("shutdown");
  });

  test("securityWarning and securityViolation", () => {
    const warn = securityWarning("injection", "Suspicious prompt detected", "agent-1");
    expect(warn.type).toBe("security.warning");
    expect(warn.category).toBe("injection");

    const viol = securityViolation(
      "injection",
      "Confirmed prompt injection attempt",
      "critical",
      "agent-1",
      { pattern: "ignore previous" },
    );
    expect(viol.type).toBe("security.violation");
    expect(viol.severity).toBe("critical");
    expect(viol.details).toEqual({ pattern: "ignore previous" });
  });
});

describe("AuditEntry type structure", () => {
  test("AuditEntry can be constructed with all required fields", () => {
    const entry: AuditEntry = {
      sequence: 0,
      timestamp: new Date().toISOString(),
      sessionId: "sess-1",
      previousHash: GENESIS_HASH,
      entryHash: "abc123",
      event: sessionStarted("user-1"),
      actorId: "orchestrator",
      actorSignature: "sig-base64",
      signingPublicKey: "pk-base64",
    };

    expect(entry.sequence).toBe(0);
    expect(entry.previousHash).toBe("GENESIS");
    expect(entry.event.type).toBe("session.started");
  });

  test("GENESIS_HASH sentinel is the string GENESIS", () => {
    expect(GENESIS_HASH).toBe("GENESIS");
  });
});

describe("AuditEvent discriminated union", () => {
  test("type field discriminates event variants", () => {
    const events: AuditEvent[] = [
      sessionStarted("u1"),
      sessionEnded("user_exit"),
      intentExtracted("i1", "h1", "read_only", "high", "test"),
      planCreated("p1", "rh1", 1, ["s1"]),
      agentRegistered("a1", "Test", "READ", "pk1"),
      securityViolation("test", "msg", "high"),
    ];

    const types = events.map((e) => e.type);
    expect(types).toEqual([
      "session.started",
      "session.ended",
      "intent.extracted",
      "plan.created",
      "agent.registered",
      "security.violation",
    ]);
  });

  test("type narrowing works via switch", () => {
    const event: AuditEvent = packageEncrypted("pkg-1", "a1", ["a2"], "ch");

    switch (event.type) {
      case "package.encrypted":
        // TypeScript narrows to PackageEncryptedEvent here
        expect(event.packageId).toBe("pkg-1");
        expect(event.recipientIds).toEqual(["a2"]);
        break;
      default:
        throw new Error("Should not reach default branch");
    }
  });
});
