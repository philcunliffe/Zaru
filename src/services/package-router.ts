/**
 * Encrypted Package Router
 *
 * Routes encrypted packages between agents. The router CANNOT read
 * the content of packages - it only handles routing based on metadata.
 */

import type {
  EncryptedPackage,
  WorkerInitMessage,
  WorkerTaskMessage,
  WorkerResultMessage,
  WorkerEscalationMessage,
  WorkerEscalationResponseMessage,
  AnyWorkerMessage,
  AgentMetadata,
  AgentPermission,
} from "../agents/types";
import type { EscalationResult } from "./escalation";
import { getKeyRegistry } from "../crypto";
import { getLogger } from "./logger";
import type { GeneratedAgentSpec } from "../generation/agent-generator";
import { getDefaultProvider, type PermissionType } from "../agents/llm";

/**
 * Result from delegating to a reader agent
 */
export interface DelegateResult {
  package: EncryptedPackage;
  outcomeSummary?: string;
}

/**
 * Worker handle for managing agent workers
 */
interface WorkerHandle {
  worker: Worker;
  metadata: AgentMetadata;
  busy: boolean;
  pendingTasks: Map<
    string,
    {
      resolve: (pkg: EncryptedPackage, outcomeSummary?: string) => void;
      reject: (error: Error) => void;
    }
  >;
}

/**
 * Escalation handler callback type
 */
export type EscalationHandler = (
  agentId: string,
  escalation: WorkerEscalationMessage["escalation"]
) => Promise<EscalationResult>;

/**
 * Package Router
 *
 * Manages worker lifecycle and routes encrypted packages between agents.
 */
export class PackageRouter {
  private workers: Map<string, WorkerHandle> = new Map();
  private packageStore: Map<string, EncryptedPackage> = new Map();
  private escalationHandler: EscalationHandler | null = null;

  /**
   * Set the escalation handler for worker escalation requests
   * @param handler - Function to handle escalation requests
   */
  setEscalationHandler(handler: EscalationHandler): void {
    this.escalationHandler = handler;
  }

  /**
   * Spawn a new agent worker
   */
  async spawnWorker(
    metadata: AgentMetadata,
    workerPath: string
  ): Promise<void> {
    const registry = getKeyRegistry();
    const agent = registry.getAgent(metadata.id);

    if (!agent) {
      throw new Error(`Agent ${metadata.id} not registered in key registry`);
    }

    // Build recipient public keys map
    const recipientPublicKeys: Record<string, string> = {};

    // Add user's public key
    const userPublicKey = registry.getUserPublicKey();
    if (userPublicKey) {
      recipientPublicKeys["user"] = userPublicKey;
    }

    // Add other agents' public keys
    for (const agentId of registry.getAgentIds()) {
      if (agentId !== metadata.id) {
        const key = registry.getAgentPublicKey(agentId);
        if (key) {
          recipientPublicKeys[agentId] = key;
        }
      }
    }

    // Create the worker
    const worker = new Worker(workerPath, {
      type: "module",
    });

    const handle: WorkerHandle = {
      worker,
      metadata,
      busy: false,
      pendingTasks: new Map(),
    };

    // Set up message handler
    worker.onmessage = (event: MessageEvent<AnyWorkerMessage>) => {
      this.handleWorkerMessage(metadata.id, event.data);
    };

    worker.onerror = (error) => {
      console.error(`Worker ${metadata.id} error:`, error);
      // Log worker error
      getLogger().logError(
        "ERROR",
        `worker:${metadata.id}`,
        `Worker error: ${error.message}`,
        undefined,
        { pendingTasks: Array.from(handle.pendingTasks.keys()) }
      );
      // Reject all pending tasks
      for (const [taskId, { reject }] of handle.pendingTasks) {
        reject(new Error(`Worker error: ${error.message}`));
      }
      handle.pendingTasks.clear();
      handle.busy = false;
    };

    this.workers.set(metadata.id, handle);

    // Initialize the worker
    const initMessage: WorkerInitMessage = {
      type: "init",
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      config: {
        agentId: metadata.id,
        agentName: metadata.name,
        permission: metadata.permission,
        secretKey: agent.keyPair.secretKey,
        recipientPublicKeys,
      },
    };

    // Wait for init confirmation
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Worker ${metadata.id} init timeout`));
      }, 5000);

      const originalHandler = worker.onmessage;
      worker.onmessage = (event: MessageEvent<AnyWorkerMessage>) => {
        const message = event.data;
        if (message.type === "result" && message.id === initMessage.id) {
          clearTimeout(timeout);
          worker.onmessage = originalHandler;
          resolve();
        } else if (message.type === "error") {
          clearTimeout(timeout);
          worker.onmessage = originalHandler;
          reject(new Error((message as { error: { message: string } }).error.message));
        }
      };

      worker.postMessage(initMessage);
    });
  }

  /**
   * Handle messages from workers
   */
  private handleWorkerMessage(agentId: string, message: AnyWorkerMessage): void {
    const handle = this.workers.get(agentId);
    if (!handle) return;

    // Log worker message
    getLogger().logChat({
      type: "worker_message",
      agentId,
      content: `Worker message: ${message.type}`,
      metadata: { messageId: message.id },
    });

    if (message.type === "result") {
      const result = message as WorkerResultMessage;
      const pending = handle.pendingTasks.get(message.id);

      if (pending) {
        handle.pendingTasks.delete(message.id);
        handle.busy = false;

        if (result.result.success && result.result.package) {
          // Store the package
          this.packageStore.set(result.result.package.id, result.result.package);
          pending.resolve(result.result.package, result.result.outcomeSummary);
        } else {
          pending.reject(
            new Error(result.result.error || "Task failed without error")
          );
        }
      }
    } else if (message.type === "error") {
      // Handle error for any pending task
      for (const [taskId, { reject }] of handle.pendingTasks) {
        reject(
          new Error(
            (message as { error: { message: string } }).error.message
          )
        );
      }
      handle.pendingTasks.clear();
      handle.busy = false;
    } else if (message.type === "escalation") {
      // Handle escalation request from worker
      this.handleEscalation(agentId, message as WorkerEscalationMessage);
    }
  }

  /**
   * Handle an escalation request from a worker
   */
  private async handleEscalation(
    agentId: string,
    message: WorkerEscalationMessage
  ): Promise<void> {
    const handle = this.workers.get(agentId);
    if (!handle) {
      getLogger().logError(
        "ERROR",
        `worker:${agentId}`,
        "Escalation from unknown worker",
        undefined,
        { escalationId: message.escalation.escalationId }
      );
      return;
    }

    // Log the escalation request
    getLogger().logChat({
      type: "worker_message",
      agentId,
      content: `Escalation request: ${message.escalation.reason}`,
      metadata: {
        escalationId: message.escalation.escalationId,
        requestText: message.escalation.requestText,
      },
    });

    if (!this.escalationHandler) {
      // No handler configured - send denial response
      const response: WorkerEscalationResponseMessage = {
        type: "escalation_response",
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        response: {
          escalationId: message.escalation.escalationId,
          resolution: "denied",
          respondedBy: "user",
          denialReason: "Escalation not supported",
        },
      };
      handle.worker.postMessage(response);
      return;
    }

    try {
      // Process escalation through the handler
      const result = await this.escalationHandler(agentId, message.escalation);

      // Log the result
      getLogger().logChat({
        type: "worker_message",
        agentId,
        content: `Escalation result: ${result.resolution}`,
        metadata: {
          escalationId: result.escalationId,
          resolution: result.resolution,
          respondedBy: result.respondedBy,
        },
      });

      // Send response back to worker
      const response: WorkerEscalationResponseMessage = {
        type: "escalation_response",
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        response: {
          escalationId: result.escalationId,
          resolution: result.resolution,
          content: result.content,
          respondedBy: result.respondedBy,
          denialReason: result.denialReason,
        },
      };
      handle.worker.postMessage(response);
    } catch (error) {
      // Log and send error response
      getLogger().logError(
        "ERROR",
        `worker:${agentId}`,
        "Escalation handler failed",
        error instanceof Error ? error : undefined,
        { escalationId: message.escalation.escalationId }
      );

      const response: WorkerEscalationResponseMessage = {
        type: "escalation_response",
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        response: {
          escalationId: message.escalation.escalationId,
          resolution: "denied",
          respondedBy: "user",
          denialReason: error instanceof Error ? error.message : "Handler error",
        },
      };
      handle.worker.postMessage(response);
    }
  }

  /**
   * Delegate a task to a READ agent
   */
  async delegateToReader(
    agentId: string,
    task: string,
    originalRequest: string,
    outputRecipients: string[]
  ): Promise<DelegateResult> {
    const handle = this.workers.get(agentId);
    if (!handle) {
      throw new Error(`Worker ${agentId} not found`);
    }

    if (handle.metadata.permission !== "READ" && handle.metadata.permission !== "READ_WRITE") {
      throw new Error(`Agent ${agentId} is not a READ agent`);
    }

    const taskMessage: WorkerTaskMessage = {
      type: "task",
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      task: {
        description: task,
        originalRequest,
        requestHash: "", // Will be computed by worker
        input: task, // READ agents get task as input
        outputRecipients,
      },
    };

    return new Promise((resolve, reject) => {
      handle.pendingTasks.set(taskMessage.id, {
        resolve: (pkg: EncryptedPackage, outcomeSummary?: string) =>
          resolve({ package: pkg, outcomeSummary }),
        reject,
      });
      handle.busy = true;
      handle.worker.postMessage(taskMessage);
    });
  }

  /**
   * Route an encrypted package to a WRITE agent
   */
  async routeToWriter(
    agentId: string,
    pkg: EncryptedPackage,
    taskDescription: string,
    originalRequest: string
  ): Promise<EncryptedPackage> {
    const handle = this.workers.get(agentId);
    if (!handle) {
      throw new Error(`Worker ${agentId} not found`);
    }

    if (handle.metadata.permission !== "WRITE" && handle.metadata.permission !== "READ_WRITE") {
      throw new Error(`Agent ${agentId} is not a WRITE agent`);
    }

    // Verify the package has a sealed box for this agent
    if (!pkg.sealedBoxes[agentId]) {
      throw new Error(`Package does not contain content for agent ${agentId}`);
    }

    const taskMessage: WorkerTaskMessage = {
      type: "task",
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      task: {
        description: taskDescription,
        originalRequest: originalRequest,
        requestHash: pkg.requestHash,
        input: pkg, // WRITE agents get encrypted package
        outputRecipients: ["user"], // Results go to user
      },
    };

    return new Promise((resolve, reject) => {
      handle.pendingTasks.set(taskMessage.id, { resolve, reject });
      handle.busy = true;
      handle.worker.postMessage(taskMessage);
    });
  }

  /**
   * Get a stored package by ID
   */
  getPackage(packageId: string): EncryptedPackage | undefined {
    return this.packageStore.get(packageId);
  }

  /**
   * Shutdown all workers
   */
  async shutdown(): Promise<void> {
    for (const [agentId, handle] of this.workers) {
      handle.worker.postMessage({ type: "shutdown", id: crypto.randomUUID(), timestamp: Date.now() });
      handle.worker.terminate();
    }
    this.workers.clear();
  }

  /**
   * Check if a worker is available
   */
  isWorkerAvailable(agentId: string): boolean {
    const handle = this.workers.get(agentId);
    return handle !== undefined && !handle.busy;
  }

  /**
   * Get all worker IDs
   */
  getWorkerIds(): string[] {
    return Array.from(this.workers.keys());
  }

  /**
   * Spawn a dynamic worker from a generated agent specification
   *
   * Unlike spawnWorker which uses a static worker file path, this method
   * spawns the generic dynamic worker and configures it via the init message
   * with the agent's service configuration and tools.
   *
   * @param spec - Generated agent specification from JSON config
   */
  async spawnDynamicWorker(spec: GeneratedAgentSpec): Promise<void> {
    const registry = getKeyRegistry();
    const agent = registry.getAgent(spec.id);

    if (!agent) {
      throw new Error(`Agent ${spec.id} not registered in key registry`);
    }

    // Build recipient public keys map
    const recipientPublicKeys: Record<string, string> = {};

    // Add user's public key
    const userPublicKey = registry.getUserPublicKey();
    if (userPublicKey) {
      recipientPublicKeys["user"] = userPublicKey;
    }

    // Add other agents' public keys
    for (const agentId of registry.getAgentIds()) {
      if (agentId !== spec.id) {
        const key = registry.getAgentPublicKey(agentId);
        if (key) {
          recipientPublicKeys[agentId] = key;
        }
      }
    }

    // Use the dynamic worker file directly
    const dynamicWorkerPath = new URL(
      "../agents/workers/dynamic-worker.ts",
      import.meta.url
    ).pathname;

    const worker = new Worker(dynamicWorkerPath, {
      type: "module",
    });

    // Convert spec to metadata for storage
    const metadata: AgentMetadata = {
      id: spec.id,
      name: spec.name,
      permission: spec.permission,
      capabilities: spec.capabilities,
      publicKey: spec.publicKey,
    };

    const handle: WorkerHandle = {
      worker,
      metadata,
      busy: false,
      pendingTasks: new Map(),
    };

    // Set up message handler
    worker.onmessage = (event: MessageEvent<AnyWorkerMessage>) => {
      this.handleWorkerMessage(spec.id, event.data);
    };

    worker.onerror = (error) => {
      console.error(`Dynamic Worker ${spec.id} error:`, error);
      getLogger().logError(
        "ERROR",
        `worker:${spec.id}`,
        `Worker error: ${error.message}`,
        undefined,
        { pendingTasks: Array.from(handle.pendingTasks.keys()) }
      );
      // Reject all pending tasks
      for (const [taskId, { reject }] of handle.pendingTasks) {
        reject(new Error(`Worker error: ${error.message}`));
      }
      handle.pendingTasks.clear();
      handle.busy = false;
    };

    this.workers.set(spec.id, handle);

    // Get model ID for this permission type
    const llm = getDefaultProvider();
    const modelId = llm.getModelIdForPermission(spec.permission as PermissionType);

    // Initialize the worker with dynamic config included
    const initMessage: WorkerInitMessage = {
      type: "init",
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      config: {
        agentId: spec.id,
        agentName: spec.name,
        permission: spec.permission,
        secretKey: agent.keyPair.secretKey,
        recipientPublicKeys,
        // Include dynamic config for JSON-defined workers
        dynamicConfig: {
          serviceConfig: spec.serviceConfig,
          toolNames: spec.toolNames,
          expectedPermission: spec.permission,
          modelId,
        },
      },
    };

    // Wait for init confirmation
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Dynamic Worker ${spec.id} init timeout`));
      }, 10000); // Longer timeout for dynamic workers

      const originalHandler = worker.onmessage;
      worker.onmessage = (event: MessageEvent<AnyWorkerMessage>) => {
        const message = event.data;
        if (message.type === "result" && message.id === initMessage.id) {
          clearTimeout(timeout);
          worker.onmessage = originalHandler;
          resolve();
        } else if (message.type === "error") {
          clearTimeout(timeout);
          worker.onmessage = originalHandler;
          reject(new Error((message as { error: { message: string } }).error.message));
        }
      };

      worker.postMessage(initMessage);
    });
  }
}

// Singleton instance
let _packageRouter: PackageRouter | null = null;

export function getPackageRouter(): PackageRouter {
  if (!_packageRouter) {
    _packageRouter = new PackageRouter();
  }
  return _packageRouter;
}

export function initPackageRouter(): PackageRouter {
  _packageRouter = new PackageRouter();
  return _packageRouter;
}
