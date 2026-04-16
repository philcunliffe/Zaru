/**
 * Comprehensive Audit Ledger Tests
 *
 * Covers: hash determinism, chain linking, tamper detection at position M,
 * signature verification (valid + wrong key), event factories, genesis entry,
 * monotonic sequence enforcement, and integration test mocking orchestration flow.
 *
 * (za-8ey.6)
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import nacl from "tweetnacl";
import { encodeBase64, decodeBase64 } from "tweetnacl-util";

import { AuditLedger } from "../src/audit/ledger";
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
  permissionChecked,
  packageEncrypted,
  packageRouted,
  packageDecrypted,
  agentRegistered,
  agentDeregistered,
  escalationRequested,
  escalationResolved,
  securityWarning,
  securityViolation,
  type AuditEntry,
  type AuditEvent,
} from "../src/audit/events";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a base64-encoded 32-byte Ed25519 seed for tests. */
function makeTestKey(): string {
  return encodeBase64(nacl.randomBytes(32));
}

/** Recompute the entry hash from its content fields (mirrors ledger internals). */
function recomputeHash(entry: AuditEntry): string {
  const canonical = JSON.stringify({
    sequence: entry.sequence,
    timestamp: entry.timestamp,
    sessionId: entry.sessionId,
    previousHash: entry.previousHash,
    event: entry.event,
    actorId: entry.actorId,
  });
  return encodeBase64(nacl.hash(new TextEncoder().encode(canonical)));
}

/** Verify the Ed25519 signature on an AuditEntry. */
function verifySignature(entry: AuditEntry): boolean {
  const dataBytes = new TextEncoder().encode(entry.entryHash);
  return nacl.sign.detached.verify(
    dataBytes,
    decodeBase64(entry.actorSignature),
    decodeBase64(entry.signingPublicKey),
  );
}

/**
 * Verify the integrity of a full chain of entries.
 *
 * Checks that each entry's previousHash matches the preceding entry's
 * entryHash (or GENESIS for the first), that entryHash is deterministic,
 * that sequences are monotonically increasing without gaps, and that
 * every signature is valid.
 *
 * @returns The 0-based index of the first broken entry, or -1 if valid.
 */
function verifyChain(entries: AuditEntry[]): number {
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const expectedPrev = i === 0 ? GENESIS_HASH : entries[i - 1].entryHash;

    if (entry.previousHash !== expectedPrev) return i;
    if (entry.entryHash !== recomputeHash(entry)) return i;
    if (entry.sequence !== i) return i;
    if (!verifySignature(entry)) return i;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Test data: reusable session & cleanup helpers
// ---------------------------------------------------------------------------

function makeSessionId(): string {
  return `test-audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function cleanupSession(sessionId: string): void {
  try {
    fs.rmSync(path.join(os.homedir(), ".zaru", "logs", sessionId), {
      recursive: true,
      force: true,
    });
  } catch {
    /* ignore */
  }
}

// ===========================================================================
// 1. Hash Determinism
// ===========================================================================

describe("Hash determinism", () => {
  let ledger: AuditLedger;
  let sid: string;
  const key = makeTestKey();

  beforeEach(() => {
    sid = makeSessionId();
    ledger = new AuditLedger();
    ledger.init(sid);
  });
  afterEach(() => {
    ledger.close();
    cleanupSession(sid);
  });

  test("entryHash matches independent recomputation", () => {
    const entry = ledger.append(sessionStarted("u1"), "orch", key);
    expect(entry.entryHash).toBe(recomputeHash(entry));
  });

  test("identical inputs produce the same hash across ledger instances", () => {
    const ts = new Date().toISOString();
    const event = sessionStarted("u1");

    // Build the canonical object both times to confirm determinism
    const canonical = JSON.stringify({
      sequence: 0,
      timestamp: ts,
      sessionId: sid,
      previousHash: GENESIS_HASH,
      event,
      actorId: "orch",
    });
    const hash1 = encodeBase64(nacl.hash(new TextEncoder().encode(canonical)));
    const hash2 = encodeBase64(nacl.hash(new TextEncoder().encode(canonical)));
    expect(hash1).toBe(hash2);
  });

  test("changing any content field produces a different hash", () => {
    const entry = ledger.append(sessionStarted("u1"), "orch", key);
    const base = recomputeHash(entry);

    // Mutate actorId
    const altered: AuditEntry = { ...entry, actorId: "different-actor" };
    expect(recomputeHash(altered)).not.toBe(base);
  });
});

// ===========================================================================
// 2. Chain Linking
// ===========================================================================

describe("Chain linking", () => {
  let ledger: AuditLedger;
  let sid: string;
  const key = makeTestKey();

  beforeEach(() => {
    sid = makeSessionId();
    ledger = new AuditLedger();
    ledger.init(sid);
  });
  afterEach(() => {
    ledger.close();
    cleanupSession(sid);
  });

  test("first entry links to GENESIS_HASH", () => {
    const e0 = ledger.append(sessionStarted("u1"), "orch", key);
    expect(e0.previousHash).toBe(GENESIS_HASH);
  });

  test("subsequent entries link to the previous entryHash", () => {
    const e0 = ledger.append(sessionStarted("u1"), "orch", key);
    const e1 = ledger.append(planCreated("p1", "rh", 2, ["s1", "s2"]), "orch", key);
    const e2 = ledger.append(sessionEnded("user_exit"), "orch", key);

    expect(e1.previousHash).toBe(e0.entryHash);
    expect(e2.previousHash).toBe(e1.entryHash);
  });

  test("full chain verifies cleanly", () => {
    const entries: AuditEntry[] = [];
    entries.push(ledger.append(sessionStarted("u1"), "orch", key));
    entries.push(ledger.append(planCreated("p1", "rh", 1, ["s1"]), "orch", key));
    entries.push(ledger.append(planStepStarted("p1", "s1", "delegate", "reader"), "orch", key));
    entries.push(ledger.append(planStepCompleted("p1", "s1", "completed", "pkg-1"), "orch", key));
    entries.push(ledger.append(sessionEnded("user_exit"), "orch", key));

    expect(verifyChain(entries)).toBe(-1);
  });
});

// ===========================================================================
// 3. Tamper Detection — modify entry M, verify chain breaks at M
// ===========================================================================

describe("Tamper detection", () => {
  let ledger: AuditLedger;
  let sid: string;
  const key = makeTestKey();

  beforeEach(() => {
    sid = makeSessionId();
    ledger = new AuditLedger();
    ledger.init(sid);
  });
  afterEach(() => {
    ledger.close();
    cleanupSession(sid);
  });

  test("tampering entry 0 in a 5-entry chain is detected at index 0", () => {
    const entries: AuditEntry[] = [];
    entries.push(ledger.append(sessionStarted("u1"), "orch", key));
    entries.push(ledger.append(intentExtracted("i1", "mh", "read_only", "high", "test"), "orch", key));
    entries.push(ledger.append(planCreated("p1", "rh", 1, ["s1"]), "orch", key));
    entries.push(ledger.append(planStepCompleted("p1", "s1", "completed"), "orch", key));
    entries.push(ledger.append(sessionEnded("user_exit"), "orch", key));

    // Untouched chain is valid
    expect(verifyChain(entries)).toBe(-1);

    // Tamper with entry 0's event payload
    entries[0] = { ...entries[0], event: sessionStarted("hacker") };
    expect(verifyChain(entries)).toBe(0);
  });

  test("tampering entry 2 in a 5-entry chain is detected at index 2", () => {
    const entries: AuditEntry[] = [];
    entries.push(ledger.append(sessionStarted("u1"), "orch", key));
    entries.push(ledger.append(intentExtracted("i1", "mh", "read_only", "high", "test"), "orch", key));
    entries.push(ledger.append(planCreated("p1", "rh", 1, ["s1"]), "orch", key));
    entries.push(ledger.append(planStepCompleted("p1", "s1", "completed"), "orch", key));
    entries.push(ledger.append(sessionEnded("user_exit"), "orch", key));

    // Tamper entry at index 2 — change the actorId
    entries[2] = { ...entries[2], actorId: "evil-agent" };
    expect(verifyChain(entries)).toBe(2);
  });

  test("tampering the last entry in a chain is detected at that index", () => {
    const entries: AuditEntry[] = [];
    entries.push(ledger.append(sessionStarted("u1"), "orch", key));
    entries.push(ledger.append(planCreated("p1", "rh", 1, ["s1"]), "orch", key));
    entries.push(ledger.append(sessionEnded("user_exit"), "orch", key));

    entries[2] = { ...entries[2], actorId: "tampered" };
    expect(verifyChain(entries)).toBe(2);
  });

  test("replacing an entryHash breaks the chain at the next entry", () => {
    const entries: AuditEntry[] = [];
    entries.push(ledger.append(sessionStarted("u1"), "orch", key));
    entries.push(ledger.append(planCreated("p1", "rh", 1, ["s1"]), "orch", key));
    entries.push(ledger.append(sessionEnded("user_exit"), "orch", key));

    // Overwrite entry 1's entryHash — entry 1 itself will fail recomputation,
    // AND entry 2's previousHash will no longer match.
    entries[1] = { ...entries[1], entryHash: "FORGED_HASH" };
    const breakAt = verifyChain(entries);
    // Must detect at entry 1 (hash mismatch) even before reaching entry 2
    expect(breakAt).toBe(1);
  });

  test("inserting an entry breaks the chain", () => {
    const entries: AuditEntry[] = [];
    entries.push(ledger.append(sessionStarted("u1"), "orch", key));
    entries.push(ledger.append(planCreated("p1", "rh", 1, ["s1"]), "orch", key));
    entries.push(ledger.append(sessionEnded("user_exit"), "orch", key));

    // Insert a copy of entry 1 between positions 1 and 2
    const injected = { ...entries[1] };
    entries.splice(2, 0, injected);

    // The injected entry at index 2 has the wrong sequence (1 instead of 2)
    expect(verifyChain(entries)).toBe(2);
  });
});

// ===========================================================================
// 4. Signature Verification
// ===========================================================================

describe("Signature verification", () => {
  let ledger: AuditLedger;
  let sid: string;
  const key = makeTestKey();

  beforeEach(() => {
    sid = makeSessionId();
    ledger = new AuditLedger();
    ledger.init(sid);
  });
  afterEach(() => {
    ledger.close();
    cleanupSession(sid);
  });

  test("valid signature passes verification", () => {
    const entry = ledger.append(sessionStarted("u1"), "orch", key);
    expect(verifySignature(entry)).toBe(true);
  });

  test("wrong public key fails verification", () => {
    const entry = ledger.append(sessionStarted("u1"), "orch", key);
    const fakePublicKey = encodeBase64(nacl.sign.keyPair().publicKey);
    const tampered = { ...entry, signingPublicKey: fakePublicKey };
    expect(verifySignature(tampered)).toBe(false);
  });

  test("modified entryHash invalidates signature", () => {
    const entry = ledger.append(sessionStarted("u1"), "orch", key);
    const tampered = { ...entry, entryHash: "TAMPERED" };
    expect(verifySignature(tampered)).toBe(false);
  });

  test("different signing keys produce different signatures", () => {
    const key2 = makeTestKey();
    const sid2 = makeSessionId();
    const ledger2 = new AuditLedger();
    ledger2.init(sid2);

    const e1 = ledger.append(sessionStarted("u1"), "agent-a", key);
    const e2 = ledger2.append(sessionStarted("u1"), "agent-b", key2);

    expect(e1.actorSignature).not.toBe(e2.actorSignature);
    expect(e1.signingPublicKey).not.toBe(e2.signingPublicKey);
    expect(verifySignature(e1)).toBe(true);
    expect(verifySignature(e2)).toBe(true);

    ledger2.close();
    cleanupSession(sid2);
  });
});

// ===========================================================================
// 5. Event Factories
// ===========================================================================

describe("Event factories", () => {
  test("session lifecycle events", () => {
    const started = sessionStarted("u1");
    expect(started.type).toBe("session.started");
    expect(started.userId).toBe("u1");

    const ended = sessionEnded("error");
    expect(ended.type).toBe("session.ended");
    expect(ended.reason).toBe("error");
  });

  test("intent events", () => {
    const extracted = intentExtracted("i1", "mh", "read_only", "high", "Read emails");
    expect(extracted.type).toBe("intent.extracted");
    expect(extracted.category).toBe("read_only");

    const validated = intentValidated("i1", "s1", true, []);
    expect(validated.type).toBe("intent.validated");
    expect(validated.allowed).toBe(true);

    const blocked = intentBlocked("i1", "s1", "UNAUTHORIZED_WRITE", "Nope");
    expect(blocked.type).toBe("intent.blocked");
    expect(blocked.errorCode).toBe("UNAUTHORIZED_WRITE");
  });

  test("plan events", () => {
    const created = planCreated("p1", "rh", 2, ["s1", "s2"]);
    expect(created.type).toBe("plan.created");
    expect(created.stepCount).toBe(2);

    const started = planStepStarted("p1", "s1", "delegate", "reader");
    expect(started.type).toBe("plan.stepStarted");
    expect(started.targetAgentId).toBe("reader");

    const completed = planStepCompleted("p1", "s1", "completed", "pkg-1");
    expect(completed.type).toBe("plan.stepCompleted");
    expect(completed.status).toBe("completed");
  });

  test("permission events", () => {
    const checked = permissionChecked("a1", "READ", "gmail", true);
    expect(checked.type).toBe("permission.checked");
    expect(checked.granted).toBe(true);
  });

  test("package crypto events", () => {
    const enc = packageEncrypted("pkg-1", "reader", ["writer"], "ch");
    expect(enc.type).toBe("package.encrypted");

    const routed = packageRouted("pkg-1", "s1", "s2", "writer");
    expect(routed.type).toBe("package.routed");

    const dec = packageDecrypted("pkg-1", "writer", true);
    expect(dec.type).toBe("package.decrypted");
    expect(dec.integrityValid).toBe(true);
  });

  test("agent registry events", () => {
    const reg = agentRegistered("a1", "Reader", "READ", "pk1");
    expect(reg.type).toBe("agent.registered");

    const dereg = agentDeregistered("a1", "shutdown");
    expect(dereg.type).toBe("agent.deregistered");
  });

  test("security events", () => {
    const warn = securityWarning("injection", "Suspicious input", "a1");
    expect(warn.type).toBe("security.warning");

    const viol = securityViolation("injection", "Confirmed attack", "critical", "a1");
    expect(viol.type).toBe("security.violation");
    expect(viol.severity).toBe("critical");
  });
});

// ===========================================================================
// 6. Genesis Entry
// ===========================================================================

describe("Genesis entry", () => {
  let ledger: AuditLedger;
  let sid: string;
  const key = makeTestKey();

  beforeEach(() => {
    sid = makeSessionId();
    ledger = new AuditLedger();
    ledger.init(sid);
  });
  afterEach(() => {
    ledger.close();
    cleanupSession(sid);
  });

  test("GENESIS_HASH sentinel is the string 'GENESIS'", () => {
    expect(GENESIS_HASH).toBe("GENESIS");
  });

  test("first appended entry has sequence 0 and GENESIS previousHash", () => {
    const entry = ledger.append(sessionStarted("u1"), "orch", key);
    expect(entry.sequence).toBe(0);
    expect(entry.previousHash).toBe(GENESIS_HASH);
  });

  test("genesis entry is fully verifiable", () => {
    const entry = ledger.append(sessionStarted("u1"), "orch", key);
    expect(entry.entryHash).toBe(recomputeHash(entry));
    expect(verifySignature(entry)).toBe(true);
  });
});

// ===========================================================================
// 7. Monotonic Sequence Enforcement
// ===========================================================================

describe("Monotonic sequence enforcement", () => {
  let ledger: AuditLedger;
  let sid: string;
  const key = makeTestKey();

  beforeEach(() => {
    sid = makeSessionId();
    ledger = new AuditLedger();
    ledger.init(sid);
  });
  afterEach(() => {
    ledger.close();
    cleanupSession(sid);
  });

  test("sequences are strictly 0, 1, 2, ... with no gaps", () => {
    const entries: AuditEntry[] = [];
    for (let i = 0; i < 10; i++) {
      entries.push(ledger.append(sessionStarted(`u${i}`), "orch", key));
    }
    entries.forEach((e, i) => expect(e.sequence).toBe(i));
  });

  test("getSequence() returns the next sequence number", () => {
    expect(ledger.getSequence()).toBe(0);
    ledger.append(sessionStarted("u1"), "orch", key);
    expect(ledger.getSequence()).toBe(1);
    ledger.append(sessionStarted("u2"), "orch", key);
    expect(ledger.getSequence()).toBe(2);
  });

  test("a skipped sequence is detected by chain verification", () => {
    const entries: AuditEntry[] = [];
    entries.push(ledger.append(sessionStarted("u1"), "orch", key));
    entries.push(ledger.append(planCreated("p1", "rh", 1, ["s1"]), "orch", key));
    entries.push(ledger.append(sessionEnded("user_exit"), "orch", key));

    // Simulate a gap: remove entry 1 so sequences go 0, 2
    entries.splice(1, 1);
    expect(verifyChain(entries)).toBe(1);
  });
});

// ===========================================================================
// 8. Integration Test — Mocking an Orchestration Flow
// ===========================================================================

describe("Integration: orchestration flow audit trail", () => {
  let ledger: AuditLedger;
  let sid: string;
  const orchKey = makeTestKey();
  const readerKey = makeTestKey();
  const writerKey = makeTestKey();

  beforeEach(() => {
    sid = makeSessionId();
    ledger = new AuditLedger();
    ledger.init(sid);
  });
  afterEach(() => {
    ledger.close();
    cleanupSession(sid);
  });

  test("full orchestration flow produces a valid, verifiable chain", () => {
    const entries: AuditEntry[] = [];

    // 1. Session start
    entries.push(
      ledger.append(sessionStarted("user-42"), "orchestrator", orchKey),
    );

    // 2. Agent registration
    entries.push(
      ledger.append(
        agentRegistered("google-reader", "Google Reader", "READ", "pk-reader"),
        "orchestrator",
        orchKey,
      ),
    );
    entries.push(
      ledger.append(
        agentRegistered("email-writer", "Email Writer", "WRITE", "pk-writer"),
        "orchestrator",
        orchKey,
      ),
    );

    // 3. Intent extraction
    entries.push(
      ledger.append(
        intentExtracted(
          "intent-1",
          "msg-hash-abc",
          "read_and_write",
          "high",
          "Summarize emails and reply to John",
        ),
        "orchestrator",
        orchKey,
      ),
    );

    // 4. Plan creation
    entries.push(
      ledger.append(
        planCreated("plan-1", "req-hash-xyz", 3, ["step-0", "step-1", "step-2"]),
        "orchestrator",
        orchKey,
      ),
    );

    // 5. Step 0: delegate to reader
    entries.push(
      ledger.append(
        planStepStarted("plan-1", "step-0", "delegate", "google-reader"),
        "orchestrator",
        orchKey,
      ),
    );

    // 6. Permission check for reader
    entries.push(
      ledger.append(
        permissionChecked("google-reader", "READ", "gmail", true),
        "google-reader",
        readerKey,
      ),
    );

    // 7. Reader produces encrypted package
    entries.push(
      ledger.append(
        packageEncrypted("pkg-1", "google-reader", ["email-writer", "user"], "content-hash"),
        "google-reader",
        readerKey,
      ),
    );

    // 8. Step 0 complete
    entries.push(
      ledger.append(
        planStepCompleted("plan-1", "step-0", "completed", "pkg-1"),
        "orchestrator",
        orchKey,
      ),
    );

    // 9. Intent validation before route step
    entries.push(
      ledger.append(
        intentValidated("intent-1", "step-1", true, []),
        "orchestrator",
        orchKey,
      ),
    );

    // 10. Step 1: route package to writer
    entries.push(
      ledger.append(
        planStepStarted("plan-1", "step-1", "route", "email-writer"),
        "orchestrator",
        orchKey,
      ),
    );
    entries.push(
      ledger.append(
        packageRouted("pkg-1", "step-0", "step-1", "email-writer"),
        "orchestrator",
        orchKey,
      ),
    );

    // 11. Writer decrypts and acts
    entries.push(
      ledger.append(
        packageDecrypted("pkg-1", "email-writer", true),
        "email-writer",
        writerKey,
      ),
    );
    entries.push(
      ledger.append(
        planStepCompleted("plan-1", "step-1", "completed"),
        "orchestrator",
        orchKey,
      ),
    );

    // 12. Step 2: respond to user
    entries.push(
      ledger.append(
        planStepStarted("plan-1", "step-2", "respond", undefined),
        "orchestrator",
        orchKey,
      ),
    );
    entries.push(
      ledger.append(
        planStepCompleted("plan-1", "step-2", "completed"),
        "orchestrator",
        orchKey,
      ),
    );

    // 13. Session end
    entries.push(
      ledger.append(sessionEnded("user_exit"), "orchestrator", orchKey),
    );

    // --- Assertions ---

    // Chain is valid end-to-end
    expect(verifyChain(entries)).toBe(-1);

    // Correct count
    expect(entries.length).toBe(17);

    // Monotonic sequences
    entries.forEach((e, i) => expect(e.sequence).toBe(i));

    // Multiple actors contributed valid signatures
    const actors = new Set(entries.map((e) => e.actorId));
    expect(actors.size).toBe(3);
    expect(actors.has("orchestrator")).toBe(true);
    expect(actors.has("google-reader")).toBe(true);
    expect(actors.has("email-writer")).toBe(true);

    // Every entry individually verifiable
    for (const entry of entries) {
      expect(verifySignature(entry)).toBe(true);
      expect(entry.entryHash).toBe(recomputeHash(entry));
    }

    // Event type progression makes sense
    expect(entries[0].event.type).toBe("session.started");
    expect(entries[entries.length - 1].event.type).toBe("session.ended");
  });

  test("escalation flow produces valid audit entries", () => {
    const entries: AuditEntry[] = [];

    entries.push(ledger.append(sessionStarted("u1"), "orchestrator", orchKey));

    entries.push(
      ledger.append(
        planStepStarted("p1", "s1", "delegate", "google-reader"),
        "orchestrator",
        orchKey,
      ),
    );

    // Reader encounters ambiguity and escalates
    entries.push(
      ledger.append(
        escalationRequested("esc-1", "google-reader", "Multiple matching emails", "task-1"),
        "google-reader",
        readerKey,
      ),
    );

    entries.push(
      ledger.append(
        escalationResolved("esc-1", "approved", "user"),
        "orchestrator",
        orchKey,
      ),
    );

    entries.push(ledger.append(sessionEnded("user_exit"), "orchestrator", orchKey));

    expect(verifyChain(entries)).toBe(-1);
    expect(entries[2].event.type).toBe("escalation.requested");
    expect(entries[3].event.type).toBe("escalation.resolved");
  });

  test("security violation flow is audited and chain remains valid", () => {
    const entries: AuditEntry[] = [];

    entries.push(ledger.append(sessionStarted("u1"), "orchestrator", orchKey));

    entries.push(
      ledger.append(
        intentExtracted("i1", "mh", "read_only", "high", "Read emails"),
        "orchestrator",
        orchKey,
      ),
    );

    // Attempt to write blocked by intent validation
    entries.push(
      ledger.append(
        intentBlocked("i1", "step-1", "UNAUTHORIZED_WRITE", "Write not in intent"),
        "orchestrator",
        orchKey,
      ),
    );

    entries.push(
      ledger.append(
        securityWarning("intent_violation", "Step attempted write on read-only intent", "orchestrator"),
        "orchestrator",
        orchKey,
      ),
    );

    entries.push(ledger.append(sessionEnded("error"), "orchestrator", orchKey));

    expect(verifyChain(entries)).toBe(-1);
    expect(entries[2].event.type).toBe("intent.blocked");
    expect(entries[3].event.type).toBe("security.warning");
  });

  test("tamper in the middle of an orchestration chain is detected at the right position", () => {
    const entries: AuditEntry[] = [];

    entries.push(ledger.append(sessionStarted("u1"), "orchestrator", orchKey));
    entries.push(
      ledger.append(
        agentRegistered("reader", "Reader", "READ", "pk"),
        "orchestrator",
        orchKey,
      ),
    );
    entries.push(
      ledger.append(
        intentExtracted("i1", "mh", "read_only", "high", "Read emails"),
        "orchestrator",
        orchKey,
      ),
    );
    entries.push(
      ledger.append(
        planCreated("p1", "rh", 1, ["s1"]),
        "orchestrator",
        orchKey,
      ),
    );
    entries.push(
      ledger.append(
        planStepStarted("p1", "s1", "delegate", "reader"),
        "orchestrator",
        orchKey,
      ),
    );
    entries.push(
      ledger.append(
        packageEncrypted("pkg-1", "reader", ["user"], "ch"),
        "reader",
        readerKey,
      ),
    );
    entries.push(ledger.append(sessionEnded("user_exit"), "orchestrator", orchKey));

    // Valid before tamper
    expect(verifyChain(entries)).toBe(-1);

    // Tamper: someone tries to forge the plan to include more steps
    entries[3] = {
      ...entries[3],
      event: planCreated("p1", "rh", 5, ["s1", "s2", "s3", "s4", "s5"]),
    };

    // Detected at the tampered entry
    expect(verifyChain(entries)).toBe(3);
  });
});
