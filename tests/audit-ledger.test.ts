/**
 * Audit Ledger Tests
 *
 * Tests for AuditLedger hash chaining, signing, sequencing, and file output.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import nacl from "tweetnacl";
import { encodeBase64, decodeBase64 } from "tweetnacl-util";

import { AuditLedger, initAuditLedger, getAuditLedger } from "../src/audit/ledger";
import { GENESIS_HASH, sessionStarted, sessionEnded, planCreated } from "../src/audit/events";
import type { AuditEntry } from "../src/audit/events";

/** Generate a test Ed25519 seed encoded as base64 (32 bytes). */
function makeTestKey(): string {
  return encodeBase64(nacl.randomBytes(32));
}

/** Recompute the entry hash the same way the ledger does. */
function recomputeHash(entry: AuditEntry): string {
  const canonical = JSON.stringify({
    sequence: entry.sequence,
    timestamp: entry.timestamp,
    sessionId: entry.sessionId,
    previousHash: entry.previousHash,
    event: entry.event,
    actorId: entry.actorId,
  });
  const bytes = new TextEncoder().encode(canonical);
  return encodeBase64(nacl.hash(bytes));
}

/** Verify the Ed25519 signature on an AuditEntry. */
function verifySignature(entry: AuditEntry): boolean {
  const dataBytes = new TextEncoder().encode(entry.entryHash);
  const signature = decodeBase64(entry.actorSignature);
  const publicKey = decodeBase64(entry.signingPublicKey);
  return nacl.sign.detached.verify(dataBytes, signature, publicKey);
}

describe("AuditLedger", () => {
  const sessionId = `test-ledger-${Date.now()}`;
  let ledger: AuditLedger;
  let secretKey: string;
  let logDir: string;

  beforeEach(() => {
    ledger = new AuditLedger();
    ledger.init(sessionId);
    secretKey = makeTestKey();
    logDir = path.join(os.homedir(), ".zaru", "logs", sessionId);
  });

  afterEach(() => {
    ledger.close();
    // Clean up test files
    try {
      fs.rmSync(logDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup failures
    }
  });

  test("genesis entry has sequence 0 and GENESIS previousHash", () => {
    const entry = ledger.append(sessionStarted("user-1"), "orchestrator", secretKey);
    expect(entry.sequence).toBe(0);
    expect(entry.previousHash).toBe(GENESIS_HASH);
  });

  test("sequence increments monotonically", () => {
    const e0 = ledger.append(sessionStarted("u1"), "orch", secretKey);
    const e1 = ledger.append(planCreated("p1", "rh", 1, ["s1"]), "orch", secretKey);
    const e2 = ledger.append(sessionEnded("user_exit"), "orch", secretKey);

    expect(e0.sequence).toBe(0);
    expect(e1.sequence).toBe(1);
    expect(e2.sequence).toBe(2);
    expect(ledger.getSequence()).toBe(3);
  });

  test("hash chain links each entry to its predecessor", () => {
    const e0 = ledger.append(sessionStarted("u1"), "orch", secretKey);
    const e1 = ledger.append(planCreated("p1", "rh", 1, ["s1"]), "orch", secretKey);
    const e2 = ledger.append(sessionEnded("user_exit"), "orch", secretKey);

    expect(e0.previousHash).toBe(GENESIS_HASH);
    expect(e1.previousHash).toBe(e0.entryHash);
    expect(e2.previousHash).toBe(e1.entryHash);
  });

  test("entryHash is deterministic and verifiable", () => {
    const entry = ledger.append(sessionStarted("u1"), "orch", secretKey);
    const recomputed = recomputeHash(entry);
    expect(entry.entryHash).toBe(recomputed);
  });

  test("Ed25519 signature is valid and verifiable", () => {
    const entry = ledger.append(sessionStarted("u1"), "orch", secretKey);
    expect(verifySignature(entry)).toBe(true);
  });

  test("signature fails with wrong public key", () => {
    const entry = ledger.append(sessionStarted("u1"), "orch", secretKey);

    // Tamper with the public key
    const fakeKey = encodeBase64(nacl.randomBytes(32));
    const tampered: AuditEntry = { ...entry, signingPublicKey: fakeKey };
    expect(verifySignature(tampered)).toBe(false);
  });

  test("tampered entryHash invalidates the signature", () => {
    const entry = ledger.append(sessionStarted("u1"), "orch", secretKey);
    const tampered: AuditEntry = { ...entry, entryHash: "TAMPERED" };
    expect(verifySignature(tampered)).toBe(false);
  });

  test("different actors produce different signatures", () => {
    const key1 = makeTestKey();
    const key2 = makeTestKey();

    const ledger1 = new AuditLedger();
    ledger1.init(`sig-test-1-${Date.now()}`);
    const ledger2 = new AuditLedger();
    ledger2.init(`sig-test-2-${Date.now()}`);

    const e1 = ledger1.append(sessionStarted("u1"), "agent-a", key1);
    const e2 = ledger2.append(sessionStarted("u1"), "agent-b", key2);

    expect(e1.actorSignature).not.toBe(e2.actorSignature);
    expect(e1.signingPublicKey).not.toBe(e2.signingPublicKey);
    expect(verifySignature(e1)).toBe(true);
    expect(verifySignature(e2)).toBe(true);

    ledger1.close();
    ledger2.close();
    try {
      fs.rmSync(path.join(os.homedir(), ".zaru", "logs", ledger1.getSessionId()), { recursive: true, force: true });
      fs.rmSync(path.join(os.homedir(), ".zaru", "logs", ledger2.getSessionId()), { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  test("writes entries as JSONL to audit.jsonl", () => {
    ledger.append(sessionStarted("u1"), "orch", secretKey);
    ledger.append(sessionEnded("user_exit"), "orch", secretKey);
    ledger.close();

    const filePath = path.join(logDir, "audit.jsonl");
    expect(fs.existsSync(filePath)).toBe(true);

    const lines = fs.readFileSync(filePath, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(2);

    const parsed0: AuditEntry = JSON.parse(lines[0]);
    const parsed1: AuditEntry = JSON.parse(lines[1]);

    expect(parsed0.sequence).toBe(0);
    expect(parsed0.event.type).toBe("session.started");
    expect(parsed1.sequence).toBe(1);
    expect(parsed1.event.type).toBe("session.ended");
    expect(parsed1.previousHash).toBe(parsed0.entryHash);
  });

  test("sessionId is set correctly", () => {
    const entry = ledger.append(sessionStarted("u1"), "orch", secretKey);
    expect(entry.sessionId).toBe(sessionId);
    expect(ledger.getSessionId()).toBe(sessionId);
  });

  test("isEnabled returns true after init", () => {
    expect(ledger.isEnabled()).toBe(true);
  });

  test("isEnabled returns false after close", () => {
    ledger.close();
    expect(ledger.isEnabled()).toBe(false);
  });

  test("append still returns entry when ledger is not enabled (fail-open)", () => {
    const disabled = new AuditLedger();
    // Don't call init — ledger stays disabled
    const entry = disabled.append(sessionStarted("u1"), "orch", secretKey);
    expect(entry.sequence).toBe(0);
    expect(entry.event.type).toBe("session.started");
    expect(verifySignature(entry)).toBe(true);
  });
});

describe("AuditLedger singleton", () => {
  test("getAuditLedger returns the same instance", () => {
    const a = getAuditLedger();
    const b = getAuditLedger();
    expect(a).toBe(b);
  });

  test("initAuditLedger creates and initializes a new instance", () => {
    const sid = `singleton-test-${Date.now()}`;
    const ledger = initAuditLedger(sid);
    expect(ledger.getSessionId()).toBe(sid);
    expect(ledger.isEnabled()).toBe(true);

    // The singleton should now be this instance
    expect(getAuditLedger()).toBe(ledger);

    ledger.close();
    try {
      fs.rmSync(path.join(os.homedir(), ".zaru", "logs", sid), { recursive: true, force: true });
    } catch { /* ignore */ }
  });
});
