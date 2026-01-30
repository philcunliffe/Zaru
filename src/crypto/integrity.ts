/**
 * Integrity Proofs
 *
 * Generates and verifies proofs linking agent output to the original user request.
 * This allows users to verify that the content they receive was generated in
 * response to their specific request and hasn't been tampered with.
 */

import nacl from "tweetnacl";
import { encodeBase64, decodeBase64 } from "tweetnacl-util";

/**
 * Integrity proof structure
 */
export interface IntegrityProof {
  // Hash of the original user request
  requestHash: string;
  // Hash of the content being proven
  contentHash: string;
  // Timestamp when proof was created
  timestamp: number;
  // Agent ID that created the proof
  agentId: string;
  // Signature over the combined data
  signature: string;
  // Public key used for signing (for verification)
  signingPublicKey: string;
}

/**
 * Data that gets signed for the integrity proof
 */
interface ProofData {
  requestHash: string;
  contentHash: string;
  timestamp: number;
  agentId: string;
}

/**
 * Generate a SHA-512 hash of content (using nacl.hash)
 */
export function hashContent(content: string): string {
  const bytes = new TextEncoder().encode(content);
  const hash = nacl.hash(bytes);
  return encodeBase64(hash);
}

/**
 * Create an integrity proof linking content to an original request
 *
 * @param originalRequest - The original user request
 * @param content - The content to create a proof for
 * @param agentId - The ID of the agent creating the proof
 * @param signingSecretKey - The agent's signing secret key (base64)
 * @returns Integrity proof
 */
export function createIntegrityProof(
  originalRequest: string,
  content: string,
  agentId: string,
  signingSecretKey: string
): IntegrityProof {
  const requestHash = hashContent(originalRequest);
  const contentHash = hashContent(content);
  const timestamp = Date.now();

  // Create the data to sign
  const proofData: ProofData = {
    requestHash,
    contentHash,
    timestamp,
    agentId,
  };

  const dataToSign = JSON.stringify(proofData);
  const dataBytes = new TextEncoder().encode(dataToSign);

  // Sign the data
  const secretKey = decodeBase64(signingSecretKey);
  // For signing, we need to use nacl.sign.keyPair.fromSeed with the first 32 bytes
  // or use the box secret key to derive a signing key
  const signKeyPair = nacl.sign.keyPair.fromSeed(secretKey.slice(0, 32));
  const signature = nacl.sign.detached(dataBytes, signKeyPair.secretKey);

  return {
    requestHash,
    contentHash,
    timestamp,
    agentId,
    signature: encodeBase64(signature),
    signingPublicKey: encodeBase64(signKeyPair.publicKey),
  };
}

/**
 * Verify an integrity proof
 *
 * @param proof - The integrity proof to verify
 * @param originalRequest - The original user request (to verify hash)
 * @param content - The content (to verify hash)
 * @returns True if the proof is valid
 */
export function verifyIntegrityProof(
  proof: IntegrityProof,
  originalRequest: string,
  content: string
): boolean {
  try {
    // Verify request hash matches
    const expectedRequestHash = hashContent(originalRequest);
    if (proof.requestHash !== expectedRequestHash) {
      return false;
    }

    // Verify content hash matches
    const expectedContentHash = hashContent(content);
    if (proof.contentHash !== expectedContentHash) {
      return false;
    }

    // Verify signature
    const proofData: ProofData = {
      requestHash: proof.requestHash,
      contentHash: proof.contentHash,
      timestamp: proof.timestamp,
      agentId: proof.agentId,
    };

    const dataToVerify = JSON.stringify(proofData);
    const dataBytes = new TextEncoder().encode(dataToVerify);
    const signature = decodeBase64(proof.signature);
    const publicKey = decodeBase64(proof.signingPublicKey);

    return nacl.sign.detached.verify(dataBytes, signature, publicKey);
  } catch {
    // Any decoding or verification error means the proof is invalid
    return false;
  }
}

/**
 * Integrity proof verification result with details
 */
export interface VerificationResult {
  valid: boolean;
  requestHashMatches: boolean;
  contentHashMatches: boolean;
  signatureValid: boolean;
  agentId: string;
  timestamp: Date;
}

/**
 * Verify an integrity proof with detailed results
 */
export function verifyIntegrityProofDetailed(
  proof: IntegrityProof,
  originalRequest: string,
  content: string
): VerificationResult {
  // Check request hash
  const expectedRequestHash = hashContent(originalRequest);
  const requestHashMatches = proof.requestHash === expectedRequestHash;

  // Check content hash
  const expectedContentHash = hashContent(content);
  const contentHashMatches = proof.contentHash === expectedContentHash;

  // Verify signature
  let signatureValid = false;
  try {
    const proofData: ProofData = {
      requestHash: proof.requestHash,
      contentHash: proof.contentHash,
      timestamp: proof.timestamp,
      agentId: proof.agentId,
    };

    const dataToVerify = JSON.stringify(proofData);
    const dataBytes = new TextEncoder().encode(dataToVerify);
    const signature = decodeBase64(proof.signature);
    const publicKey = decodeBase64(proof.signingPublicKey);

    signatureValid = nacl.sign.detached.verify(dataBytes, signature, publicKey);
  } catch {
    signatureValid = false;
  }

  return {
    valid: requestHashMatches && contentHashMatches && signatureValid,
    requestHashMatches,
    contentHashMatches,
    signatureValid,
    agentId: proof.agentId,
    timestamp: new Date(proof.timestamp),
  };
}
