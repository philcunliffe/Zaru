/**
 * Sealed Box Encryption
 *
 * Implements sealed boxes using TweetNaCl for anonymous authenticated encryption.
 * Sealed boxes allow encrypting data for a recipient without revealing the sender.
 */

import nacl from "tweetnacl";
import { encodeBase64, decodeBase64 } from "tweetnacl-util";

/**
 * Sealed box encryption result
 */
export interface SealedBox {
  // Base64-encoded ciphertext (includes ephemeral public key + encrypted data)
  ciphertext: string;
  // Recipient's public key (base64) - for routing purposes
  recipientPublicKey: string;
}

/**
 * Decrypt a sealed box
 *
 * @param sealedBox - The sealed box to decrypt
 * @param recipientSecretKey - The recipient's secret key (base64)
 * @returns Decrypted plaintext string
 * @throws Error if decryption fails
 */
export function openSealedBox(
  sealedBox: SealedBox,
  recipientSecretKey: string
): string {
  const ciphertext = decodeBase64(sealedBox.ciphertext);
  const secretKey = decodeBase64(recipientSecretKey);

  // Extract ephemeral public key (first 32 bytes)
  const ephemeralPublicKey = ciphertext.slice(0, nacl.box.publicKeyLength);
  const encryptedMessage = ciphertext.slice(nacl.box.publicKeyLength);

  // Derive the recipient's public key from secret key
  const keyPair = nacl.box.keyPair.fromSecretKey(secretKey);

  // Create nonce from ephemeral public key and recipient public key
  const nonce = createNonce(ephemeralPublicKey, keyPair.publicKey);

  // Decrypt
  const plaintext = nacl.box.open(
    encryptedMessage,
    nonce,
    ephemeralPublicKey,
    secretKey
  );

  if (!plaintext) {
    throw new Error("Failed to decrypt sealed box: invalid ciphertext or key");
  }

  return new TextDecoder().decode(plaintext);
}

/**
 * Create a sealed box for a recipient
 *
 * @param plaintext - The message to encrypt
 * @param recipientPublicKey - The recipient's public key (base64)
 * @returns Sealed box containing encrypted data
 */
export function createSealedBox(
  plaintext: string,
  recipientPublicKey: string
): SealedBox {
  const recipientPubKey = decodeBase64(recipientPublicKey);
  const message = new TextEncoder().encode(plaintext);

  // Generate ephemeral key pair
  const ephemeralKeyPair = nacl.box.keyPair();

  // Create nonce from ephemeral public key and recipient public key
  const nonce = createNonce(ephemeralKeyPair.publicKey, recipientPubKey);

  // Encrypt
  const encrypted = nacl.box(
    message,
    nonce,
    recipientPubKey,
    ephemeralKeyPair.secretKey
  );

  // Combine ephemeral public key + encrypted message
  const combined = new Uint8Array(
    ephemeralKeyPair.publicKey.length + encrypted.length
  );
  combined.set(ephemeralKeyPair.publicKey);
  combined.set(encrypted, ephemeralKeyPair.publicKey.length);

  return {
    ciphertext: encodeBase64(combined),
    recipientPublicKey,
  };
}

/**
 * Create a deterministic nonce from two public keys
 * Uses the first 24 bytes of the hash of the concatenated keys
 */
function createNonce(
  ephemeralPublicKey: Uint8Array,
  recipientPublicKey: Uint8Array
): Uint8Array {
  // Concatenate the two public keys
  const combined = new Uint8Array(
    ephemeralPublicKey.length + recipientPublicKey.length
  );
  combined.set(ephemeralPublicKey);
  combined.set(recipientPublicKey, ephemeralPublicKey.length);

  // Hash and take first 24 bytes for nonce
  const hash = nacl.hash(combined);
  return hash.slice(0, nacl.box.nonceLength);
}

/**
 * Create sealed boxes for multiple recipients
 *
 * @param plaintext - The message to encrypt
 * @param recipientPublicKeys - Array of recipient public keys (base64)
 * @returns Array of sealed boxes, one per recipient
 */
export function createMultiRecipientSealedBoxes(
  plaintext: string,
  recipientPublicKeys: string[]
): SealedBox[] {
  return recipientPublicKeys.map((publicKey) =>
    createSealedBox(plaintext, publicKey)
  );
}
