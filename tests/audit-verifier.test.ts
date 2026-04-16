/**
 * Audit Chain Verifier Tests
 *
 * Tests for verifyAuditChain, parseAuditLog, and verifyAuditFile covering:
 * - Valid chain verification
 * - Broken hash chain detection
 * - Invalid signature detection
 * - Sequence gap detection
 * - Event counting and session summary
 * - Tampered entry detection
 * - Empty log handling
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import nacl from "tweetnacl";
import { encodeBase64 } from "tweetnacl-util";

import { AuditLedger } from "../src/audit/ledger";
import {
  GENESIS_HASH,
  sessionStarted,
  sessionEnded,
  planCreated,
  securityWarning,
  permissionChecked,
} from "../src/audit/events";
import type { AuditEntry } from "../src/audit/events";
import {
  verifyAuditChain,
  verifyAuditFile,
  parseAuditLog,
} from "../src/audit/verifier";

/** Generate a test Ed25519 seed encoded as base64 (32 bytes). */
function makeTestKey(): string {
  return encodeBase64(nacl.randomBytes(32));
}

/** Build a valid chain of entries using the real AuditLedger. */
function buildChain(
  sessionId: string,
  secretKey: string,
): { entries: AuditEntry[]; logDir: string } {
  const ledger = new AuditLedger();
  ledger.init(sessionId);

  const entries: AuditEntry[] = [];
  entries.push(ledger.append(sessionStarted("user-1"), "orchestrator", secretKey));
  entries.push(ledger.append(planCreated("p1", "rh", 2, ["s1", "s2"]), "orchestrator", secretKey));
  entries.push(ledger.append(permissionChecked("agent-a", "READ", "/data", true), "agent-a", secretKey));
  entries.push(ledger.append(securityWarning("test", "test warning"), "orchestrator", secretKey));
  entries.push(ledger.append(sessionEnded("user_exit"), "orchestrator", secretKey));

  ledger.close();
  const logDir = path.join(os.homedir(), ".zaru", "logs", sessionId);
  return { entries, logDir };
}

describe("verifyAuditChain", () => {
  test("valid chain passes all checks", () => {
    const secretKey = makeTestKey();
    const { entries } = buildChain(`verify-valid-${Date.now()}`, secretKey);

    const report = verifyAuditChain(entries);

    expect(report.valid).toBe(true);
    expect(report.totalEntries).toBe(5);
    expect(report.chainIntact).toBe(true);
    expect(report.signaturesValid).toBe(true);
    expect(report.firstBrokenLink).toBeNull();
    expect(report.invalidSignatures).toEqual([]);
  });

  test("reports correct event counts", () => {
    const secretKey = makeTestKey();
    const { entries } = buildChain(`verify-counts-${Date.now()}`, secretKey);

    const report = verifyAuditChain(entries);

    expect(report.eventCounts["session.started"]).toBe(1);
    expect(report.eventCounts["session.ended"]).toBe(1);
    expect(report.eventCounts["plan.created"]).toBe(1);
    expect(report.eventCounts["permission.checked"]).toBe(1);
    expect(report.eventCounts["security.warning"]).toBe(1);
  });

  test("reports correct session summary", () => {
    const secretKey = makeTestKey();
    const sessionId = `verify-summary-${Date.now()}`;
    const { entries } = buildChain(sessionId, secretKey);

    const report = verifyAuditChain(entries);

    expect(report.sessionSummary.sessionIds).toEqual([sessionId]);
    expect(report.sessionSummary.actorIds).toContain("orchestrator");
    expect(report.sessionSummary.actorIds).toContain("agent-a");
    expect(report.sessionSummary.firstTimestamp).toBe(entries[0].timestamp);
    expect(report.sessionSummary.lastTimestamp).toBe(entries[entries.length - 1].timestamp);
  });

  test("detects broken hash chain (tampered previousHash)", () => {
    const secretKey = makeTestKey();
    const { entries } = buildChain(`verify-broken-${Date.now()}`, secretKey);

    // Tamper with entry 2's previousHash
    entries[2] = { ...entries[2], previousHash: "TAMPERED" };

    const report = verifyAuditChain(entries);

    expect(report.valid).toBe(false);
    expect(report.chainIntact).toBe(false);
    expect(report.firstBrokenLink).toBe(2);
  });

  test("detects tampered entryHash", () => {
    const secretKey = makeTestKey();
    const { entries } = buildChain(`verify-hash-${Date.now()}`, secretKey);

    // Tamper with entry 1's entryHash — breaks chain at entry 1 and link at entry 2
    entries[1] = { ...entries[1], entryHash: "FAKE_HASH" };

    const report = verifyAuditChain(entries);

    expect(report.valid).toBe(false);
    expect(report.chainIntact).toBe(false);
    // Entry 1 has wrong hash, entry 2 has wrong previousHash
    expect(report.firstBrokenLink).toBe(1);
  });

  test("detects invalid signature", () => {
    const secretKey = makeTestKey();
    const { entries } = buildChain(`verify-sig-${Date.now()}`, secretKey);

    // Replace signature with garbage
    entries[3] = { ...entries[3], actorSignature: encodeBase64(nacl.randomBytes(64)) };

    const report = verifyAuditChain(entries);

    expect(report.valid).toBe(false);
    expect(report.signaturesValid).toBe(false);
    expect(report.invalidSignatures).toEqual([3]);
    // Chain itself is still intact
    expect(report.chainIntact).toBe(true);
  });

  test("detects multiple invalid signatures", () => {
    const secretKey = makeTestKey();
    const { entries } = buildChain(`verify-multi-sig-${Date.now()}`, secretKey);

    // Tamper signatures on entries 1 and 4
    entries[1] = { ...entries[1], actorSignature: encodeBase64(nacl.randomBytes(64)) };
    entries[4] = { ...entries[4], actorSignature: encodeBase64(nacl.randomBytes(64)) };

    const report = verifyAuditChain(entries);

    expect(report.valid).toBe(false);
    expect(report.invalidSignatures).toEqual([1, 4]);
  });

  test("detects sequence gap", () => {
    const secretKey = makeTestKey();
    const { entries } = buildChain(`verify-gap-${Date.now()}`, secretKey);

    // Skip sequence number: 0, 1, 3, 4, 5 (missing 2)
    entries[2] = { ...entries[2], sequence: 3 };
    entries[3] = { ...entries[3], sequence: 4 };
    entries[4] = { ...entries[4], sequence: 5 };

    const report = verifyAuditChain(entries);

    expect(report.valid).toBe(false);
    expect(report.chainIntact).toBe(false);
    expect(report.firstBrokenLink).toBe(3); // Entry at index 2 has sequence 3, expected 2
  });

  test("detects wrong public key", () => {
    const secretKey = makeTestKey();
    const { entries } = buildChain(`verify-pubkey-${Date.now()}`, secretKey);

    // Replace public key with a different one
    const fakeKeyPair = nacl.sign.keyPair();
    entries[2] = { ...entries[2], signingPublicKey: encodeBase64(fakeKeyPair.publicKey) };

    const report = verifyAuditChain(entries);

    expect(report.valid).toBe(false);
    expect(report.signaturesValid).toBe(false);
    expect(report.invalidSignatures).toEqual([2]);
  });

  test("empty chain is valid", () => {
    const report = verifyAuditChain([]);

    expect(report.valid).toBe(true);
    expect(report.totalEntries).toBe(0);
    expect(report.chainIntact).toBe(true);
    expect(report.signaturesValid).toBe(true);
    expect(report.firstBrokenLink).toBeNull();
    expect(report.invalidSignatures).toEqual([]);
    expect(report.eventCounts).toEqual({});
    expect(report.sessionSummary.sessionIds).toEqual([]);
    expect(report.sessionSummary.firstTimestamp).toBeNull();
  });

  test("single entry chain validates correctly", () => {
    const secretKey = makeTestKey();
    const ledger = new AuditLedger();
    const sid = `verify-single-${Date.now()}`;
    ledger.init(sid);
    const entry = ledger.append(sessionStarted("u1"), "orch", secretKey);
    ledger.close();

    const report = verifyAuditChain([entry]);

    expect(report.valid).toBe(true);
    expect(report.totalEntries).toBe(1);
    expect(report.chainIntact).toBe(true);

    try {
      fs.rmSync(path.join(os.homedir(), ".zaru", "logs", sid), { recursive: true, force: true });
    } catch { /* ignore */ }
  });
});

describe("parseAuditLog", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-verifier-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("parses valid JSONL file", () => {
    const secretKey = makeTestKey();
    const sessionId = `parse-test-${Date.now()}`;
    const { entries, logDir } = buildChain(sessionId, secretKey);
    const filePath = path.join(logDir, "audit.jsonl");

    const parsed = parseAuditLog(filePath);

    expect(parsed).toHaveLength(5);
    expect(parsed[0].sequence).toBe(0);
    expect(parsed[4].sequence).toBe(4);

    fs.rmSync(logDir, { recursive: true, force: true });
  });

  test("skips empty lines", () => {
    const filePath = path.join(tmpDir, "sparse.jsonl");
    const entry: AuditEntry = {
      sequence: 0,
      timestamp: new Date().toISOString(),
      sessionId: "test",
      previousHash: GENESIS_HASH,
      entryHash: "hash",
      event: { type: "session.started", userId: "u1" },
      actorId: "orch",
      actorSignature: "sig",
      signingPublicKey: "pk",
    };
    fs.writeFileSync(filePath, `\n${JSON.stringify(entry)}\n\n`);

    const parsed = parseAuditLog(filePath);
    expect(parsed).toHaveLength(1);
  });

  test("throws on invalid JSON", () => {
    const filePath = path.join(tmpDir, "bad.jsonl");
    fs.writeFileSync(filePath, "not json\n");

    expect(() => parseAuditLog(filePath)).toThrow("Failed to parse audit entry at line 1");
  });
});

describe("verifyAuditFile", () => {
  test("end-to-end verification of a file written by AuditLedger", () => {
    const secretKey = makeTestKey();
    const sessionId = `e2e-verify-${Date.now()}`;
    const { logDir } = buildChain(sessionId, secretKey);
    const filePath = path.join(logDir, "audit.jsonl");

    const report = verifyAuditFile(filePath);

    expect(report.valid).toBe(true);
    expect(report.totalEntries).toBe(5);
    expect(report.chainIntact).toBe(true);
    expect(report.signaturesValid).toBe(true);

    fs.rmSync(logDir, { recursive: true, force: true });
  });
});
