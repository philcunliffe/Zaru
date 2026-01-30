/**
 * User Approval Service
 *
 * Manages the user approval queue for actions that modify external state.
 * Implements the direct communication channel for agent-to-user approval requests.
 */

import type { ApprovalRequest, ApprovalResponse } from "../agents/types";
import { getLogger } from "./logger";

/**
 * Approval request handler type
 */
export type ApprovalHandler = (
  request: ApprovalRequest
) => Promise<ApprovalResponse>;

/**
 * Approval Service
 *
 * Manages approval requests and responses between agents and users.
 */
export class ApprovalService {
  private pendingRequests: Map<string, ApprovalRequest> = new Map();
  private completedRequests: Map<string, ApprovalResponse> = new Map();
  private handler: ApprovalHandler | null = null;
  private requestQueue: Array<{
    request: ApprovalRequest;
    resolve: (response: ApprovalResponse) => void;
  }> = [];
  private processing = false;

  /**
   * Set the approval handler (called by CLI to handle approval prompts)
   */
  setHandler(handler: ApprovalHandler): void {
    this.handler = handler;
  }

  /**
   * Request user approval for an action
   *
   * @param request - The approval request
   * @returns Promise resolving to the user's response
   */
  async requestApproval(request: ApprovalRequest): Promise<ApprovalResponse> {
    this.pendingRequests.set(request.id, request);

    // Log approval request
    getLogger().logChat({
      type: "approval_request",
      agentId: request.sourceAgentId,
      content: request.description,
      metadata: {
        requestId: request.id,
        targetAgentId: request.targetAgentId,
      },
    });

    return new Promise((resolve) => {
      this.requestQueue.push({ request, resolve });
      this.processQueue();
    });
  }

  /**
   * Process the approval queue sequentially
   */
  private async processQueue(): Promise<void> {
    if (this.processing || this.requestQueue.length === 0) {
      return;
    }

    this.processing = true;

    while (this.requestQueue.length > 0) {
      const item = this.requestQueue.shift()!;

      try {
        let response: ApprovalResponse;

        if (this.handler) {
          response = await this.handler(item.request);
        } else {
          // Auto-reject if no handler
          response = {
            requestId: item.request.id,
            approved: false,
            respondedAt: Date.now(),
          };
        }

        this.pendingRequests.delete(item.request.id);
        this.completedRequests.set(item.request.id, response);

        // Log approval response
        getLogger().logChat({
          type: "approval_response",
          agentId: item.request.sourceAgentId,
          content: response.approved ? "Approved" : "Rejected",
          metadata: {
            requestId: item.request.id,
            approved: response.approved,
            modifiedContent: response.modifiedContent,
          },
        });

        item.resolve(response);
      } catch (error) {
        // Reject on error
        const response: ApprovalResponse = {
          requestId: item.request.id,
          approved: false,
          respondedAt: Date.now(),
        };
        this.pendingRequests.delete(item.request.id);
        this.completedRequests.set(item.request.id, response);
        item.resolve(response);
      }
    }

    this.processing = false;
  }

  /**
   * Get a pending request by ID
   */
  getPendingRequest(id: string): ApprovalRequest | undefined {
    return this.pendingRequests.get(id);
  }

  /**
   * Get all pending requests
   */
  getAllPendingRequests(): ApprovalRequest[] {
    return Array.from(this.pendingRequests.values());
  }

  /**
   * Get a completed response by request ID
   */
  getCompletedResponse(requestId: string): ApprovalResponse | undefined {
    return this.completedRequests.get(requestId);
  }

  /**
   * Check if there are pending requests
   */
  hasPendingRequests(): boolean {
    return this.pendingRequests.size > 0;
  }

  /**
   * Clear all requests (for testing)
   */
  clear(): void {
    this.pendingRequests.clear();
    this.completedRequests.clear();
    this.requestQueue = [];
    this.processing = false;
  }
}

// Singleton instance
let _approvalService: ApprovalService | null = null;

export function getApprovalService(): ApprovalService {
  if (!_approvalService) {
    _approvalService = new ApprovalService();
  }
  return _approvalService;
}

export function initApprovalService(): ApprovalService {
  _approvalService = new ApprovalService();
  return _approvalService;
}
