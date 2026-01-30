/**
 * Key Management
 *
 * Handles key generation, storage, and lookup for agents and users.
 */

import nacl from "tweetnacl";
import { encodeBase64, decodeBase64 } from "tweetnacl-util";

/**
 * Key pair with base64-encoded keys
 */
export interface KeyPair {
  publicKey: string;
  secretKey: string;
}

/**
 * Agent identity with keys
 */
export interface AgentIdentity {
  id: string;
  name: string;
  keyPair: KeyPair;
}

/**
 * Generate a new key pair for encryption
 */
export function generateKeyPair(): KeyPair {
  const keyPair = nacl.box.keyPair();
  return {
    publicKey: encodeBase64(keyPair.publicKey),
    secretKey: encodeBase64(keyPair.secretKey),
  };
}

/**
 * Derive public key from secret key
 */
export function derivePublicKey(secretKey: string): string {
  const secretKeyBytes = decodeBase64(secretKey);
  const keyPair = nacl.box.keyPair.fromSecretKey(secretKeyBytes);
  return encodeBase64(keyPair.publicKey);
}

/**
 * Key Registry
 *
 * Manages keys for all agents and the user.
 * In a production system, this would integrate with a secure key store.
 */
export class KeyRegistry {
  private agents: Map<string, AgentIdentity> = new Map();
  private userKeyPair: KeyPair | null = null;
  private orchestratorId: string | null = null;

  /**
   * Register a new agent with generated keys
   */
  registerAgent(id: string, name: string): AgentIdentity {
    const keyPair = generateKeyPair();
    const identity: AgentIdentity = { id, name, keyPair };
    this.agents.set(id, identity);
    return identity;
  }

  /**
   * Register an agent with existing keys
   */
  registerAgentWithKeys(
    id: string,
    name: string,
    keyPair: KeyPair
  ): AgentIdentity {
    const identity: AgentIdentity = { id, name, keyPair };
    this.agents.set(id, identity);
    return identity;
  }

  /**
   * Get an agent's identity
   */
  getAgent(id: string): AgentIdentity | undefined {
    return this.agents.get(id);
  }

  /**
   * Get an agent's public key
   */
  getAgentPublicKey(id: string): string | undefined {
    return this.agents.get(id)?.keyPair.publicKey;
  }

  /**
   * Get all registered agent IDs
   */
  getAgentIds(): string[] {
    return Array.from(this.agents.keys());
  }

  /**
   * Initialize user keys
   */
  initUserKeys(): KeyPair {
    this.userKeyPair = generateKeyPair();
    return this.userKeyPair;
  }

  /**
   * Get user's key pair
   */
  getUserKeyPair(): KeyPair | null {
    return this.userKeyPair;
  }

  /**
   * Get user's public key
   */
  getUserPublicKey(): string | null {
    return this.userKeyPair?.publicKey ?? null;
  }

  /**
   * Set the orchestrator agent ID
   */
  setOrchestratorId(id: string): void {
    this.orchestratorId = id;
  }

  /**
   * Get the orchestrator agent ID
   */
  getOrchestratorId(): string | null {
    return this.orchestratorId;
  }

  /**
   * Check if an ID belongs to the orchestrator
   */
  isOrchestrator(id: string): boolean {
    return this.orchestratorId === id;
  }

  /**
   * Get public keys for a list of recipient IDs
   * Handles special "user" ID for the user's key
   */
  getPublicKeysForRecipients(recipientIds: string[]): Map<string, string> {
    const keys = new Map<string, string>();

    for (const id of recipientIds) {
      if (id === "user") {
        const userKey = this.getUserPublicKey();
        if (userKey) {
          keys.set(id, userKey);
        }
      } else {
        const agentKey = this.getAgentPublicKey(id);
        if (agentKey) {
          keys.set(id, agentKey);
        }
      }
    }

    return keys;
  }
}

// Singleton key registry
let _registry: KeyRegistry | null = null;

/**
 * Get the global key registry
 */
export function getKeyRegistry(): KeyRegistry {
  if (!_registry) {
    _registry = new KeyRegistry();
  }
  return _registry;
}

/**
 * Initialize a fresh key registry (for testing)
 */
export function initKeyRegistry(): KeyRegistry {
  _registry = new KeyRegistry();
  return _registry;
}
