/**
 * Audit Ledger
 *
 * Maintains a cryptographic hash chain of audit entries for a session.
 * Each entry is linked to its predecessor via SHA-512 hashing and signed
 * with the acting agent's Ed25519 key. Entries are appended as JSON lines
 * to ~/.zaru/logs/{sessionId}/audit.jsonl.
 *
 * Follows the singleton pattern matching LoggerService.
 * Fail-open: write failures are logged but never block the caller.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import nacl from "tweetnacl";
import { encodeBase64, decodeBase64 } from "tweetnacl-util";

import type { AuditEntry, AuditEvent } from "./events";
import { GENESIS_HASH } from "./events";

/**
 * Compute a deterministic SHA-512 hash of the entry's content fields.
 *
 * The hash covers: sequence, timestamp, sessionId, previousHash, event,
 * actorId — serialized as a canonical JSON string.
 */
function computeEntryHash(fields: {
  sequence: number;
  timestamp: string;
  sessionId: string;
  previousHash: string;
  event: AuditEvent;
  actorId: string;
}): string {
  const canonical = JSON.stringify({
    sequence: fields.sequence,
    timestamp: fields.timestamp,
    sessionId: fields.sessionId,
    previousHash: fields.previousHash,
    event: fields.event,
    actorId: fields.actorId,
  });
  const bytes = new TextEncoder().encode(canonical);
  const hash = nacl.hash(bytes);
  return encodeBase64(hash);
}

/**
 * Sign an entryHash with an Ed25519 secret key.
 *
 * Uses the same seed-based derivation as integrity.ts: the first 32 bytes
 * of the provided secret key are used as the Ed25519 seed.
 *
 * @returns An object with the base64-encoded signature and public key.
 */
function signEntryHash(
  entryHash: string,
  signingSecretKey: string,
): { signature: string; signingPublicKey: string } {
  const secretKey = decodeBase64(signingSecretKey);
  const signKeyPair = nacl.sign.keyPair.fromSeed(secretKey.slice(0, 32));
  const dataBytes = new TextEncoder().encode(entryHash);
  const signature = nacl.sign.detached(dataBytes, signKeyPair.secretKey);
  return {
    signature: encodeBase64(signature),
    signingPublicKey: encodeBase64(signKeyPair.publicKey),
  };
}

/**
 * Cryptographic Audit Ledger
 *
 * Maintains a monotonic sequence counter and hash chain for a single session.
 * Entries are written as append-only JSON lines to disk.
 */
export class AuditLedger {
  private sessionId: string = "";
  private sequence: number = 0;
  private previousHash: string = GENESIS_HASH;
  private filePath: string = "";
  private enabled: boolean = false;

  /**
   * Initialize the ledger for a session.
   *
   * @param sessionId - The session this ledger tracks.
   */
  init(sessionId: string): void {
    this.sessionId = sessionId;
    this.sequence = 0;
    this.previousHash = GENESIS_HASH;

    const logDir = path.join(os.homedir(), ".zaru", "logs", sessionId);

    try {
      fs.mkdirSync(logDir, { recursive: true });
      this.filePath = path.join(logDir, "audit.jsonl");
      this.enabled = true;
    } catch (error) {
      console.error(
        `AuditLedger: failed to initialize: ${error instanceof Error ? error.message : error}`,
      );
      this.enabled = false;
    }
  }

  /**
   * Append an audit entry to the ledger.
   *
   * Computes the hash chain link, signs the entry, writes to disk, and
   * advances the sequence counter. If the write fails the error is logged
   * but the entry is still returned (fail-open).
   *
   * @param event - The audit event payload.
   * @param actorId - ID of the agent or component producing this entry.
   * @param signingSecretKey - Base64-encoded secret key for Ed25519 signing.
   * @returns The fully populated AuditEntry.
   */
  append(
    event: AuditEvent,
    actorId: string,
    signingSecretKey: string,
  ): AuditEntry {
    const timestamp = new Date().toISOString();
    const seq = this.sequence;

    const entryHash = computeEntryHash({
      sequence: seq,
      timestamp,
      sessionId: this.sessionId,
      previousHash: this.previousHash,
      event,
      actorId,
    });

    const { signature, signingPublicKey } = signEntryHash(
      entryHash,
      signingSecretKey,
    );

    const entry: AuditEntry = {
      sequence: seq,
      timestamp,
      sessionId: this.sessionId,
      previousHash: this.previousHash,
      entryHash,
      event,
      actorId,
      actorSignature: signature,
      signingPublicKey,
    };

    // Advance chain state
    this.sequence += 1;
    this.previousHash = entryHash;

    // Persist to disk (fail-open)
    if (this.enabled && this.filePath) {
      try {
        fs.appendFileSync(this.filePath, JSON.stringify(entry) + "\n");
      } catch (error) {
        console.error(
          `AuditLedger: write failed: ${error instanceof Error ? error.message : error}`,
        );
      }
    }

    return entry;
  }

  /**
   * Close the ledger. No further writes will be persisted.
   */
  close(): void {
    this.enabled = false;
    this.filePath = "";
  }

  /** Current sequence number (next entry will use this value). */
  getSequence(): number {
    return this.sequence;
  }

  /** Hash of the most recent entry (or GENESIS if none yet). */
  getPreviousHash(): string {
    return this.previousHash;
  }

  /** Session ID this ledger is tracking. */
  getSessionId(): string {
    return this.sessionId;
  }

  /** Whether the ledger is actively writing to disk. */
  isEnabled(): boolean {
    return this.enabled;
  }
}

// Singleton instance
let _ledger: AuditLedger | null = null;

/**
 * Get the audit ledger singleton.
 */
export function getAuditLedger(): AuditLedger {
  if (!_ledger) {
    _ledger = new AuditLedger();
  }
  return _ledger;
}

/**
 * Initialize a fresh audit ledger for a session.
 */
export function initAuditLedger(sessionId: string): AuditLedger {
  _ledger = new AuditLedger();
  _ledger.init(sessionId);
  return _ledger;
}
