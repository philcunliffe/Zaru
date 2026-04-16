/**
 * Audit Chain Verifier
 *
 * Reads an audit.jsonl file and verifies the cryptographic integrity of every
 * entry: hash chain linkage, SHA-512 hash correctness, Ed25519 signatures,
 * and monotonic sequencing. Produces a VerificationReport summarizing results.
 */

import * as fs from "fs";
import nacl from "tweetnacl";
import { decodeBase64 } from "tweetnacl-util";

import type { AuditEntry, AuditEventType } from "./events";
import { GENESIS_HASH } from "./events";
import { computeEntryHash } from "./ledger";

// ============================================================================
// Report Types
// ============================================================================

/** Summary of sessions found in the audit log. */
export interface SessionSummary {
  /** Unique session IDs encountered. */
  sessionIds: string[];
  /** Unique actor IDs encountered. */
  actorIds: string[];
  /** Timestamp of the first entry. */
  firstTimestamp: string | null;
  /** Timestamp of the last entry. */
  lastTimestamp: string | null;
}

/** Full verification report for an audit chain. */
export interface VerificationReport {
  /** Whether the entire chain is valid (all checks pass). */
  valid: boolean;
  /** Total number of entries in the file. */
  totalEntries: number;
  /** Whether the hash chain is intact (every previousHash matches). */
  chainIntact: boolean;
  /** Whether all signatures are valid. */
  signaturesValid: boolean;
  /** Sequence number of the first broken chain link, or null if intact. */
  firstBrokenLink: number | null;
  /** Sequence numbers of entries with invalid signatures. */
  invalidSignatures: number[];
  /** Count of entries by event type. */
  eventCounts: Partial<Record<AuditEventType, number>>;
  /** Summary of sessions and actors in the log. */
  sessionSummary: SessionSummary;
}

// ============================================================================
// Verification Logic
// ============================================================================

/**
 * Parse an audit.jsonl file into an array of AuditEntry objects.
 *
 * Skips empty lines. Throws if a non-empty line is not valid JSON.
 */
export function parseAuditLog(filePath: string): AuditEntry[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n").filter((line) => line.trim().length > 0);
  return lines.map((line, idx) => {
    try {
      return JSON.parse(line) as AuditEntry;
    } catch {
      throw new Error(`Failed to parse audit entry at line ${idx + 1}`);
    }
  });
}

/**
 * Verify an Ed25519 signature on an AuditEntry.
 */
function verifyEntrySignature(entry: AuditEntry): boolean {
  try {
    const dataBytes = new TextEncoder().encode(entry.entryHash);
    const signature = decodeBase64(entry.actorSignature);
    const publicKey = decodeBase64(entry.signingPublicKey);
    return nacl.sign.detached.verify(dataBytes, signature, publicKey);
  } catch {
    return false;
  }
}

/**
 * Verify an audit chain and produce a VerificationReport.
 *
 * Checks performed on each entry:
 * 1. previousHash matches the preceding entry's entryHash (or GENESIS for first)
 * 2. entryHash matches a recomputed SHA-512 over the canonical fields
 * 3. Ed25519 signature verifies against the entry's signingPublicKey
 * 4. Sequence numbers are monotonically increasing with no gaps (0, 1, 2, ...)
 */
export function verifyAuditChain(entries: AuditEntry[]): VerificationReport {
  const eventCounts: Partial<Record<AuditEventType, number>> = {};
  const sessionIds = new Set<string>();
  const actorIds = new Set<string>();
  const invalidSignatures: number[] = [];
  let chainIntact = true;
  let firstBrokenLink: number | null = null;
  let signaturesValid = true;
  let firstTimestamp: string | null = null;
  let lastTimestamp: string | null = null;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];

    // Track metadata
    sessionIds.add(entry.sessionId);
    actorIds.add(entry.actorId);
    if (i === 0) firstTimestamp = entry.timestamp;
    lastTimestamp = entry.timestamp;

    // Count events by type
    const eventType = entry.event.type;
    eventCounts[eventType] = (eventCounts[eventType] ?? 0) + 1;

    // Check 4: Sequence numbers are monotonic with no gaps
    if (entry.sequence !== i) {
      if (chainIntact) {
        chainIntact = false;
        firstBrokenLink ??= entry.sequence;
      }
    }

    // Check 1: previousHash matches prior entry's entryHash
    const expectedPreviousHash = i === 0 ? GENESIS_HASH : entries[i - 1].entryHash;
    if (entry.previousHash !== expectedPreviousHash) {
      if (firstBrokenLink === null) {
        firstBrokenLink = entry.sequence;
      }
      chainIntact = false;
    }

    // Check 2: entryHash matches recomputed SHA-512
    const recomputed = computeEntryHash({
      sequence: entry.sequence,
      timestamp: entry.timestamp,
      sessionId: entry.sessionId,
      previousHash: entry.previousHash,
      event: entry.event,
      actorId: entry.actorId,
    });
    if (entry.entryHash !== recomputed) {
      if (firstBrokenLink === null) {
        firstBrokenLink = entry.sequence;
      }
      chainIntact = false;
    }

    // Check 3: Ed25519 signature verifies
    if (!verifyEntrySignature(entry)) {
      invalidSignatures.push(entry.sequence);
      signaturesValid = false;
    }
  }

  return {
    valid: chainIntact && signaturesValid,
    totalEntries: entries.length,
    chainIntact,
    signaturesValid,
    firstBrokenLink,
    invalidSignatures,
    eventCounts,
    sessionSummary: {
      sessionIds: [...sessionIds],
      actorIds: [...actorIds],
      firstTimestamp,
      lastTimestamp,
    },
  };
}

/**
 * Verify an audit log file end-to-end.
 *
 * Convenience function that reads, parses, and verifies in one call.
 */
export function verifyAuditFile(filePath: string): VerificationReport {
  const entries = parseAuditLog(filePath);
  return verifyAuditChain(entries);
}
