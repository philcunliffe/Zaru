/**
 * /verify CLI Command Tests
 *
 * Tests for the formatVerificationReport formatter and the /verify
 * command's integration with the audit chain verifier.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import nacl from "tweetnacl";
import { encodeBase64 } from "tweetnacl-util";

import { formatVerificationReport } from "../src/cli/chat";
import { AuditLedger } from "../src/audit/ledger";
import {
  sessionStarted,
  sessionEnded,
  planCreated,
  permissionChecked,
  securityWarning,
  packageEncrypted,
} from "../src/audit/events";
import { verifyAuditFile } from "../src/audit/verifier";
import type { VerificationReport } from "../src/audit/verifier";

/** Generate a test Ed25519 seed encoded as base64 (32 bytes). */
function makeTestKey(): string {
  return encodeBase64(nacl.randomBytes(32));
}

/** Strip ANSI escape codes for easier assertion. */
function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("formatVerificationReport", () => {
  test("should show VALID for a fully intact report", () => {
    const report: VerificationReport = {
      valid: true,
      totalEntries: 5,
      chainIntact: true,
      signaturesValid: true,
      firstBrokenLink: null,
      invalidSignatures: [],
      eventCounts: {
        "session.started": 1,
        "plan.created": 1,
        "permission.checked": 2,
        "session.ended": 1,
      },
      sessionSummary: {
        sessionIds: ["test-session-123"],
        actorIds: ["orchestrator", "agent-a"],
        firstTimestamp: "2026-04-15T10:00:00.000Z",
        lastTimestamp: "2026-04-15T10:05:00.000Z",
      },
    };

    const output = formatVerificationReport(report);
    const plain = stripAnsi(output);

    expect(plain).toContain("AUDIT CHAIN VERIFICATION");
    expect(plain).toContain("VALID");
    expect(plain).toContain("Total entries: 5");
    expect(plain).toContain("intact");
    expect(plain).toContain("all valid");
    expect(plain).toContain("session.started");
    expect(plain).toContain("plan.created");
    expect(plain).toContain("permission.checked");
    expect(plain).toContain("session.ended");
    expect(plain).toContain("test-session-123");
    expect(plain).toContain("orchestrator, agent-a");
  });

  test("should show INVALID with broken chain details", () => {
    const report: VerificationReport = {
      valid: false,
      totalEntries: 10,
      chainIntact: false,
      signaturesValid: true,
      firstBrokenLink: 3,
      invalidSignatures: [],
      eventCounts: { "session.started": 1 },
      sessionSummary: {
        sessionIds: ["s1"],
        actorIds: ["orchestrator"],
        firstTimestamp: null,
        lastTimestamp: null,
      },
    };

    const output = formatVerificationReport(report);
    const plain = stripAnsi(output);

    expect(plain).toContain("INVALID");
    expect(plain).toContain("BROKEN");
    expect(plain).toContain("First broken link at sequence 3");
  });

  test("should show INVALID with failed signature details", () => {
    const report: VerificationReport = {
      valid: false,
      totalEntries: 8,
      chainIntact: true,
      signaturesValid: false,
      firstBrokenLink: null,
      invalidSignatures: [2, 5, 7],
      eventCounts: { "session.started": 1 },
      sessionSummary: {
        sessionIds: ["s1"],
        actorIds: ["a"],
        firstTimestamp: null,
        lastTimestamp: null,
      },
    };

    const output = formatVerificationReport(report);
    const plain = stripAnsi(output);

    expect(plain).toContain("INVALID");
    expect(plain).toContain("3 failed");
    expect(plain).toContain("Failed at: 2, 5, 7");
  });

  test("should truncate long invalid signature lists", () => {
    const report: VerificationReport = {
      valid: false,
      totalEntries: 20,
      chainIntact: true,
      signaturesValid: false,
      firstBrokenLink: null,
      invalidSignatures: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      eventCounts: {},
      sessionSummary: {
        sessionIds: [],
        actorIds: [],
        firstTimestamp: null,
        lastTimestamp: null,
      },
    };

    const output = formatVerificationReport(report);
    const plain = stripAnsi(output);

    expect(plain).toContain("13 failed");
    expect(plain).toContain("+3 more");
  });

  test("should handle empty event counts", () => {
    const report: VerificationReport = {
      valid: true,
      totalEntries: 0,
      chainIntact: true,
      signaturesValid: true,
      firstBrokenLink: null,
      invalidSignatures: [],
      eventCounts: {},
      sessionSummary: {
        sessionIds: [],
        actorIds: [],
        firstTimestamp: null,
        lastTimestamp: null,
      },
    };

    const output = formatVerificationReport(report);
    const plain = stripAnsi(output);

    expect(plain).toContain("(no events)");
  });

  test("should sort events by count descending", () => {
    const report: VerificationReport = {
      valid: true,
      totalEntries: 10,
      chainIntact: true,
      signaturesValid: true,
      firstBrokenLink: null,
      invalidSignatures: [],
      eventCounts: {
        "session.started": 1,
        "permission.checked": 5,
        "plan.created": 2,
      },
      sessionSummary: {
        sessionIds: ["s1"],
        actorIds: ["a"],
        firstTimestamp: null,
        lastTimestamp: null,
      },
    };

    const output = formatVerificationReport(report);
    const plain = stripAnsi(output);

    // permission.checked (5) should come before plan.created (2) which comes before session.started (1)
    const permIdx = plain.indexOf("permission.checked");
    const planIdx = plain.indexOf("plan.created");
    const sessIdx = plain.indexOf("session.started");
    expect(permIdx).toBeLessThan(planIdx);
    expect(planIdx).toBeLessThan(sessIdx);
  });
});

describe("/verify end-to-end", () => {
  let testSessionId: string;
  let logDir: string;
  let secretKey: string;

  beforeEach(() => {
    testSessionId = `verify-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    logDir = path.join(os.homedir(), ".zaru", "logs", testSessionId);
    secretKey = makeTestKey();
  });

  afterEach(() => {
    try {
      fs.rmSync(logDir, { recursive: true, force: true });
    } catch {
      // best effort cleanup
    }
  });

  test("should produce a valid report for a real audit chain", () => {
    const ledger = new AuditLedger();
    ledger.init(testSessionId);

    ledger.append(sessionStarted("user-1"), "orchestrator", secretKey);
    ledger.append(planCreated("p1", "hash", 3, ["s1", "s2", "s3"]), "orchestrator", secretKey);
    ledger.append(permissionChecked("reader-1", "READ", "/emails", true), "reader-1", secretKey);
    ledger.append(packageEncrypted("pkg-1", "reader-1", ["user"], "chash"), "reader-1", secretKey);
    ledger.append(securityWarning("test", "low severity"), "orchestrator", secretKey);
    ledger.append(sessionEnded("user_exit"), "orchestrator", secretKey);
    ledger.close();

    const auditPath = path.join(logDir, "audit.jsonl");
    const report = verifyAuditFile(auditPath);
    const output = formatVerificationReport(report);
    const plain = stripAnsi(output);

    expect(report.valid).toBe(true);
    expect(report.totalEntries).toBe(6);
    expect(report.chainIntact).toBe(true);
    expect(report.signaturesValid).toBe(true);
    expect(plain).toContain("VALID");
    expect(plain).toContain("Total entries: 6");
    expect(plain).toContain("session.started");
    expect(plain).toContain("session.ended");
    expect(plain).toContain("package.encrypted");
  });

  test("should detect tampered entries in formatted output", () => {
    const ledger = new AuditLedger();
    ledger.init(testSessionId);

    ledger.append(sessionStarted("user-1"), "orchestrator", secretKey);
    ledger.append(planCreated("p1", "h", 1, ["s1"]), "orchestrator", secretKey);
    ledger.append(sessionEnded("user_exit"), "orchestrator", secretKey);
    ledger.close();

    // Tamper with the second entry
    const auditPath = path.join(logDir, "audit.jsonl");
    const lines = fs.readFileSync(auditPath, "utf-8").split("\n").filter(Boolean);
    const entry = JSON.parse(lines[1]);
    entry.actorId = "evil-agent";
    lines[1] = JSON.stringify(entry);
    fs.writeFileSync(auditPath, lines.join("\n") + "\n");

    const report = verifyAuditFile(auditPath);
    const output = formatVerificationReport(report);
    const plain = stripAnsi(output);

    expect(report.valid).toBe(false);
    expect(plain).toContain("INVALID");
    expect(plain).toContain("BROKEN");
  });
});
