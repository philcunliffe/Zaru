/**
 * Crypto Module Tests
 *
 * Tests for sealed box encryption, key management, and integrity proofs.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import {
  createSealedBox,
  openSealedBox,
  createMultiRecipientSealedBoxes,
  generateKeyPair,
  derivePublicKey,
  KeyRegistry,
  initKeyRegistry,
  createIntegrityProof,
  verifyIntegrityProof,
  verifyIntegrityProofDetailed,
  hashContent,
} from "../src/crypto";

describe("Sealed Box Encryption", () => {
  test("should encrypt and decrypt a message", () => {
    const keyPair = generateKeyPair();
    const plaintext = "Hello, this is a secret message!";

    const sealedBox = createSealedBox(plaintext, keyPair.publicKey);
    const decrypted = openSealedBox(sealedBox, keyPair.secretKey);

    expect(decrypted).toBe(plaintext);
  });

  test("should encrypt with different ciphertext each time (ephemeral keys)", () => {
    const keyPair = generateKeyPair();
    const plaintext = "Same message";

    const sealedBox1 = createSealedBox(plaintext, keyPair.publicKey);
    const sealedBox2 = createSealedBox(plaintext, keyPair.publicKey);

    // Ciphertexts should be different due to ephemeral keys
    expect(sealedBox1.ciphertext).not.toBe(sealedBox2.ciphertext);

    // Both should decrypt to the same plaintext
    expect(openSealedBox(sealedBox1, keyPair.secretKey)).toBe(plaintext);
    expect(openSealedBox(sealedBox2, keyPair.secretKey)).toBe(plaintext);
  });

  test("should fail to decrypt with wrong key", () => {
    const keyPair1 = generateKeyPair();
    const keyPair2 = generateKeyPair();
    const plaintext = "Secret message";

    const sealedBox = createSealedBox(plaintext, keyPair1.publicKey);

    expect(() => openSealedBox(sealedBox, keyPair2.secretKey)).toThrow();
  });

  test("should create sealed boxes for multiple recipients", () => {
    const keyPair1 = generateKeyPair();
    const keyPair2 = generateKeyPair();
    const keyPair3 = generateKeyPair();
    const plaintext = "Message for everyone";

    const sealedBoxes = createMultiRecipientSealedBoxes(plaintext, [
      keyPair1.publicKey,
      keyPair2.publicKey,
      keyPair3.publicKey,
    ]);

    expect(sealedBoxes.length).toBe(3);

    // Each recipient should be able to decrypt their box
    expect(openSealedBox(sealedBoxes[0], keyPair1.secretKey)).toBe(plaintext);
    expect(openSealedBox(sealedBoxes[1], keyPair2.secretKey)).toBe(plaintext);
    expect(openSealedBox(sealedBoxes[2], keyPair3.secretKey)).toBe(plaintext);

    // Cross-decryption should fail
    expect(() => openSealedBox(sealedBoxes[0], keyPair2.secretKey)).toThrow();
  });

  test("should handle unicode content", () => {
    const keyPair = generateKeyPair();
    const plaintext = "Hello 世界! 🎉 Ça va?";

    const sealedBox = createSealedBox(plaintext, keyPair.publicKey);
    const decrypted = openSealedBox(sealedBox, keyPair.secretKey);

    expect(decrypted).toBe(plaintext);
  });

  test("should handle large content", () => {
    const keyPair = generateKeyPair();
    const plaintext = "A".repeat(100000); // 100KB of content

    const sealedBox = createSealedBox(plaintext, keyPair.publicKey);
    const decrypted = openSealedBox(sealedBox, keyPair.secretKey);

    expect(decrypted).toBe(plaintext);
  });
});

describe("Key Management", () => {
  test("should generate valid key pairs", () => {
    const keyPair = generateKeyPair();

    expect(keyPair.publicKey).toBeDefined();
    expect(keyPair.secretKey).toBeDefined();
    expect(keyPair.publicKey).not.toBe(keyPair.secretKey);

    // Keys should be base64 encoded
    expect(() => atob(keyPair.publicKey)).not.toThrow();
    expect(() => atob(keyPair.secretKey)).not.toThrow();
  });

  test("should derive public key from secret key", () => {
    const keyPair = generateKeyPair();
    const derivedPublicKey = derivePublicKey(keyPair.secretKey);

    expect(derivedPublicKey).toBe(keyPair.publicKey);
  });

  test("should generate unique key pairs", () => {
    const keyPair1 = generateKeyPair();
    const keyPair2 = generateKeyPair();

    expect(keyPair1.publicKey).not.toBe(keyPair2.publicKey);
    expect(keyPair1.secretKey).not.toBe(keyPair2.secretKey);
  });
});

describe("Key Registry", () => {
  let registry: KeyRegistry;

  beforeEach(() => {
    registry = initKeyRegistry();
  });

  test("should register and retrieve agents", () => {
    const identity = registry.registerAgent("agent-1", "TestAgent");

    expect(identity.id).toBe("agent-1");
    expect(identity.name).toBe("TestAgent");
    expect(identity.keyPair.publicKey).toBeDefined();

    const retrieved = registry.getAgent("agent-1");
    expect(retrieved).toEqual(identity);
  });

  test("should register agent with existing keys", () => {
    const keyPair = generateKeyPair();
    const identity = registry.registerAgentWithKeys(
      "agent-2",
      "TestAgent2",
      keyPair
    );

    expect(identity.keyPair.publicKey).toBe(keyPair.publicKey);
    expect(identity.keyPair.secretKey).toBe(keyPair.secretKey);
  });

  test("should initialize and retrieve user keys", () => {
    const userKeyPair = registry.initUserKeys();

    expect(userKeyPair.publicKey).toBeDefined();
    expect(registry.getUserPublicKey()).toBe(userKeyPair.publicKey);
    expect(registry.getUserKeyPair()).toEqual(userKeyPair);
  });

  test("should get public keys for multiple recipients", () => {
    registry.registerAgent("reader", "EmailReader");
    registry.registerAgent("writer", "DocsWriter");
    registry.initUserKeys();

    const keys = registry.getPublicKeysForRecipients([
      "reader",
      "writer",
      "user",
    ]);

    expect(keys.size).toBe(3);
    expect(keys.has("reader")).toBe(true);
    expect(keys.has("writer")).toBe(true);
    expect(keys.has("user")).toBe(true);
  });

  test("should track orchestrator ID", () => {
    registry.registerAgent("orchestrator", "Orchestrator");
    registry.setOrchestratorId("orchestrator");

    expect(registry.getOrchestratorId()).toBe("orchestrator");
    expect(registry.isOrchestrator("orchestrator")).toBe(true);
    expect(registry.isOrchestrator("other-agent")).toBe(false);
  });
});

describe("Integrity Proofs", () => {
  test("should create and verify integrity proof", () => {
    const keyPair = generateKeyPair();
    const originalRequest = "Summarize my emails";
    const content = "Here is the summary of your emails...";
    const agentId = "email-reader";

    const proof = createIntegrityProof(
      originalRequest,
      content,
      agentId,
      keyPair.secretKey
    );

    expect(proof.requestHash).toBeDefined();
    expect(proof.contentHash).toBeDefined();
    expect(proof.agentId).toBe(agentId);
    expect(proof.signature).toBeDefined();

    const isValid = verifyIntegrityProof(proof, originalRequest, content);
    expect(isValid).toBe(true);
  });

  test("should fail verification with wrong request", () => {
    const keyPair = generateKeyPair();
    const originalRequest = "Summarize my emails";
    const wrongRequest = "Delete all my emails";
    const content = "Here is the summary...";

    const proof = createIntegrityProof(
      originalRequest,
      content,
      "agent",
      keyPair.secretKey
    );

    const isValid = verifyIntegrityProof(proof, wrongRequest, content);
    expect(isValid).toBe(false);
  });

  test("should fail verification with wrong content", () => {
    const keyPair = generateKeyPair();
    const originalRequest = "Summarize my emails";
    const content = "Here is the summary...";
    const wrongContent = "Malicious content injected!";

    const proof = createIntegrityProof(
      originalRequest,
      content,
      "agent",
      keyPair.secretKey
    );

    const isValid = verifyIntegrityProof(proof, originalRequest, wrongContent);
    expect(isValid).toBe(false);
  });

  test("should fail verification with tampered signature", () => {
    const keyPair = generateKeyPair();
    const originalRequest = "Summarize my emails";
    const content = "Here is the summary...";

    const proof = createIntegrityProof(
      originalRequest,
      content,
      "agent",
      keyPair.secretKey
    );

    // Tamper with signature
    const tamperedProof = {
      ...proof,
      signature: proof.signature.slice(0, -4) + "XXXX",
    };

    const isValid = verifyIntegrityProof(
      tamperedProof,
      originalRequest,
      content
    );
    expect(isValid).toBe(false);
  });

  test("should provide detailed verification results", () => {
    const keyPair = generateKeyPair();
    const originalRequest = "Summarize my emails";
    const content = "Here is the summary...";

    const proof = createIntegrityProof(
      originalRequest,
      content,
      "email-reader",
      keyPair.secretKey
    );

    const result = verifyIntegrityProofDetailed(proof, originalRequest, content);

    expect(result.valid).toBe(true);
    expect(result.requestHashMatches).toBe(true);
    expect(result.contentHashMatches).toBe(true);
    expect(result.signatureValid).toBe(true);
    expect(result.agentId).toBe("email-reader");
    expect(result.timestamp).toBeInstanceOf(Date);
  });

  test("should identify specific verification failure", () => {
    const keyPair = generateKeyPair();
    const originalRequest = "Summarize my emails";
    const content = "Here is the summary...";

    const proof = createIntegrityProof(
      originalRequest,
      content,
      "agent",
      keyPair.secretKey
    );

    // Test with wrong content
    const result = verifyIntegrityProofDetailed(
      proof,
      originalRequest,
      "Different content"
    );

    expect(result.valid).toBe(false);
    expect(result.requestHashMatches).toBe(true);
    expect(result.contentHashMatches).toBe(false);
    expect(result.signatureValid).toBe(true); // Signature is still valid for original data
  });
});

describe("Hash Content", () => {
  test("should produce consistent hashes", () => {
    const content = "Test content";

    const hash1 = hashContent(content);
    const hash2 = hashContent(content);

    expect(hash1).toBe(hash2);
  });

  test("should produce different hashes for different content", () => {
    const hash1 = hashContent("Content A");
    const hash2 = hashContent("Content B");

    expect(hash1).not.toBe(hash2);
  });

  test("should be sensitive to small changes", () => {
    const hash1 = hashContent("Hello World");
    const hash2 = hashContent("Hello World!"); // Added exclamation

    expect(hash1).not.toBe(hash2);
  });
});
