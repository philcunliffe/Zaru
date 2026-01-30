/**
 * Encrypted Content Display
 *
 * Handles secure display of encrypted content to the user.
 * Decrypts locally and shows with integrity verification.
 */

import { openSealedBox, verifyIntegrityProofDetailed } from "../crypto";
import type { EncryptedPackage } from "../agents/types";
import type { KeyPair, VerificationResult } from "../crypto";

/**
 * Display result for encrypted content
 */
export interface DecryptedDisplay {
  content: string;
  verification: VerificationResult;
  sourceAgent: string;
  timestamp: Date;
}

/**
 * Decrypt and display encrypted content for the user
 *
 * @param pkg - The encrypted package to display
 * @param userKeyPair - The user's key pair for decryption
 * @param originalRequest - The original request for integrity verification
 * @returns Decrypted content with verification results
 */
export function decryptAndDisplay(
  pkg: EncryptedPackage,
  userKeyPair: KeyPair,
  originalRequest: string
): DecryptedDisplay {
  // Check if there's content for the user
  const userSealedBox = pkg.sealedBoxes["user"];
  if (!userSealedBox) {
    throw new Error("No encrypted content for user in this package");
  }

  // Decrypt the content
  const content = openSealedBox(userSealedBox, userKeyPair.secretKey);

  // Verify integrity
  const verification = verifyIntegrityProofDetailed(
    pkg.integrityProof,
    originalRequest,
    content
  );

  return {
    content,
    verification,
    sourceAgent: pkg.sourceAgentId,
    timestamp: new Date(pkg.createdAt),
  };
}

/**
 * Format the decrypted display for terminal output
 */
export function formatDecryptedDisplay(display: DecryptedDisplay): string {
  const lines: string[] = [];

  // Header
  lines.push("┌─────────────────────────────────────────────────────────────┐");
  lines.push("│                   DECRYPTED CONTENT                         │");
  lines.push("├─────────────────────────────────────────────────────────────┤");

  // Verification status
  const statusIcon = display.verification.valid ? "✓" : "✗";
  const statusColor = display.verification.valid ? "\x1b[32m" : "\x1b[31m";
  const resetColor = "\x1b[0m";

  lines.push(
    `│ ${statusColor}${statusIcon} Integrity Verified: ${display.verification.valid ? "YES" : "NO"}${resetColor}`
  );
  lines.push(`│   - Request Hash: ${display.verification.requestHashMatches ? "✓" : "✗"}`);
  lines.push(`│   - Content Hash: ${display.verification.contentHashMatches ? "✓" : "✗"}`);
  lines.push(`│   - Signature: ${display.verification.signatureValid ? "✓" : "✗"}`);
  lines.push(`│   - Source Agent: ${display.sourceAgent}`);
  lines.push(`│   - Generated: ${display.timestamp.toLocaleString()}`);
  lines.push("├─────────────────────────────────────────────────────────────┤");

  // Content
  lines.push("│ CONTENT:                                                     │");
  lines.push("└─────────────────────────────────────────────────────────────┘");
  lines.push("");
  lines.push(display.content);
  lines.push("");
  lines.push("─────────────────────────────────────────────────────────────────");

  return lines.join("\n");
}

/**
 * Simple verification summary for inline display
 */
export function formatVerificationSummary(
  verification: VerificationResult
): string {
  if (verification.valid) {
    return `\x1b[32m✓ Verified\x1b[0m (from ${verification.agentId} at ${verification.timestamp.toLocaleTimeString()})`;
  } else {
    const issues: string[] = [];
    if (!verification.requestHashMatches) issues.push("request mismatch");
    if (!verification.contentHashMatches) issues.push("content mismatch");
    if (!verification.signatureValid) issues.push("invalid signature");
    return `\x1b[31m✗ Verification Failed\x1b[0m: ${issues.join(", ")}`;
  }
}
