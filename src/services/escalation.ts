/**
 * Escalation Service
 *
 * Handles escalation requests from sub-agents, presenting them to the user
 * for approval and routing approved requests to the orchestrator.
 */

import type {
  WorkerEscalationMessage,
  EscalationApprovalRequest,
  EscalationApprovalResponse,
  EscalationResolution,
} from "../agents/types";

/**
 * Response returned to the worker after escalation is processed
 */
export interface EscalationResult {
  escalationId: string;
  resolution: EscalationResolution;
  content?: string;
  respondedBy: "user" | "orchestrator";
  denialReason?: string;
}

/**
 * UI handler function type for presenting escalation requests to the user
 */
export type EscalationUIHandler = (
  request: EscalationApprovalRequest
) => Promise<EscalationApprovalResponse>;

/**
 * Forward handler function type for sending approved requests to the orchestrator
 */
export type EscalationForwardHandler = (
  escalation: WorkerEscalationMessage["escalation"],
  sourceAgentId: string
) => Promise<string>;

/**
 * Rate limit entry for tracking escalations per agent
 */
interface RateLimitEntry {
  timestamps: number[];
}

/**
 * Escalation Service
 *
 * Coordinates escalation requests from workers:
 * 1. Receives escalation from worker
 * 2. Presents to user via UI handler
 * 3. Routes based on user decision (approve/deny/direct response)
 * 4. Returns result to worker
 */
export class EscalationService {
  private uiHandler: EscalationUIHandler | null = null;
  private forwardHandler: EscalationForwardHandler | null = null;
  private agentNames: Map<string, string> = new Map();
  private rateLimits: Map<string, RateLimitEntry> = new Map();

  // Rate limit: 10 escalations per agent per minute by default
  private rateLimitWindow = 60 * 1000; // 1 minute
  private rateLimitMax = 10;

  /**
   * Register an agent with the service
   * @param agentId - The agent's unique identifier
   * @param agentName - Human-readable name for display
   */
  registerAgent(agentId: string, agentName: string): void {
    this.agentNames.set(agentId, agentName);
  }

  /**
   * Set the UI handler for presenting escalation requests to the user
   * @param handler - Function that displays the escalation and returns user response
   */
  setUIHandler(handler: EscalationUIHandler): void {
    this.uiHandler = handler;
  }

  /**
   * Set the forward handler for sending approved requests to the orchestrator
   * @param handler - Function that forwards the request and returns orchestrator response
   */
  setForwardHandler(handler: EscalationForwardHandler): void {
    this.forwardHandler = handler;
  }

  /**
   * Configure rate limiting
   * @param maxPerMinute - Maximum escalations per agent per minute (default: 10)
   */
  setRateLimit(maxPerMinute: number): void {
    this.rateLimitMax = maxPerMinute;
  }

  /**
   * Check if an agent is rate limited
   * @param agentId - The agent to check
   * @returns true if rate limited, false otherwise
   */
  private isRateLimited(agentId: string): boolean {
    const entry = this.rateLimits.get(agentId);
    if (!entry) return false;

    const now = Date.now();
    const windowStart = now - this.rateLimitWindow;

    // Clean up old timestamps
    entry.timestamps = entry.timestamps.filter((t) => t > windowStart);

    return entry.timestamps.length >= this.rateLimitMax;
  }

  /**
   * Record an escalation for rate limiting
   * @param agentId - The agent making the escalation
   */
  private recordEscalation(agentId: string): void {
    let entry = this.rateLimits.get(agentId);
    if (!entry) {
      entry = { timestamps: [] };
      this.rateLimits.set(agentId, entry);
    }
    entry.timestamps.push(Date.now());
  }

  /**
   * Process an escalation request from a worker
   *
   * @param agentId - ID of the agent making the request
   * @param escalation - The escalation details
   * @returns Promise resolving to the escalation result
   */
  async processEscalation(
    agentId: string,
    escalation: WorkerEscalationMessage["escalation"]
  ): Promise<EscalationResult> {
    // Check rate limit
    if (this.isRateLimited(agentId)) {
      return {
        escalationId: escalation.escalationId,
        resolution: "denied",
        respondedBy: "user",
        denialReason: "Rate limit exceeded - too many escalation requests",
      };
    }

    // Record this escalation for rate limiting
    this.recordEscalation(agentId);

    // Check if UI handler is set
    if (!this.uiHandler) {
      return {
        escalationId: escalation.escalationId,
        resolution: "denied",
        respondedBy: "user",
        denialReason: "No UI handler configured",
      };
    }

    // Get agent name for display
    const agentName = this.agentNames.get(agentId) || agentId;

    // Create approval request for UI
    const approvalRequest: EscalationApprovalRequest = {
      id: escalation.escalationId,
      escalation,
      sourceAgentId: agentId,
      sourceAgentName: agentName,
      createdAt: Date.now(),
    };

    // Present to user
    const userResponse = await this.uiHandler(approvalRequest);

    // Handle based on user's decision
    switch (userResponse.outcome) {
      case "approve":
        // Forward to orchestrator if handler is set
        if (this.forwardHandler) {
          try {
            const orchestratorResponse = await this.forwardHandler(
              escalation,
              agentId
            );
            return {
              escalationId: escalation.escalationId,
              resolution: "approved",
              content: orchestratorResponse,
              respondedBy: "orchestrator",
            };
          } catch (error) {
            return {
              escalationId: escalation.escalationId,
              resolution: "denied",
              respondedBy: "orchestrator",
              denialReason:
                error instanceof Error
                  ? error.message
                  : "Orchestrator failed to process request",
            };
          }
        } else {
          return {
            escalationId: escalation.escalationId,
            resolution: "denied",
            respondedBy: "user",
            denialReason: "No forward handler configured",
          };
        }

      case "deny":
        return {
          escalationId: escalation.escalationId,
          resolution: "denied",
          respondedBy: "user",
          denialReason: userResponse.denialReason,
        };

      case "direct_response":
        return {
          escalationId: escalation.escalationId,
          resolution: "direct_response",
          content: userResponse.directResponse,
          respondedBy: "user",
        };

      default:
        return {
          escalationId: escalation.escalationId,
          resolution: "denied",
          respondedBy: "user",
          denialReason: "Unknown response type",
        };
    }
  }
}

// Singleton instance
let _escalationService: EscalationService | null = null;

export function getEscalationService(): EscalationService {
  if (!_escalationService) {
    _escalationService = new EscalationService();
  }
  return _escalationService;
}

export function initEscalationService(): EscalationService {
  _escalationService = new EscalationService();
  return _escalationService;
}
