/**
 * Gmail Service
 *
 * Wraps the GOG CLI (gog gmail) for Gmail operations.
 * Handles JSON output parsing and provides a typed interface.
 */

import { GoogleBaseService, getGoogleAccount, type GoogleServiceOptions } from "./base";

// ============================================================================
// Types
// ============================================================================

export interface GmailMessage {
  id: string;
  threadId: string;
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  snippet?: string;
  date: Date;
  labels: string[];
  isRead: boolean;
}

export interface GmailThread {
  id: string;
  snippet: string;
  historyId?: string;
  messages?: GmailMessage[];
}

export interface GmailLabel {
  id: string;
  name: string;
  type?: string;
  messagesTotal?: number;
  messagesUnread?: number;
}

export interface SendEmailOptions {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  replyToMessageId?: string;
  threadId?: string;
}

export interface SendEmailResult {
  success: boolean;
  messageId?: string;
  threadId?: string;
  error?: string;
}

// ============================================================================
// Gmail Service
// ============================================================================

export class GmailService extends GoogleBaseService {
  protected readonly serviceCommand = "gmail";

  constructor(options?: GoogleServiceOptions) {
    super(options);
  }

  // ==========================================================================
  // Read Operations
  // ==========================================================================

  /**
   * Search for email threads using Gmail query syntax
   *
   * @param query - Gmail search query (e.g., "is:unread", "from:alice@example.com")
   * @param options - Search options
   * @returns Array of matching threads
   */
  async searchThreads(
    query: string,
    options?: { max?: number }
  ): Promise<GmailThread[]> {
    const args = ["search", query];
    if (options?.max) {
      args.push("--max", String(options.max));
    }

    const result = (await this.execGog(args)) as { threads?: unknown[] };
    const threads = result.threads || [];

    return threads.map((t: unknown) => this.parseThread(t));
  }

  /**
   * Get a single message by ID
   *
   * @param messageId - Gmail message ID
   * @returns The message
   */
  async getMessage(messageId: string): Promise<GmailMessage> {
    const result = await this.execGog(["get", messageId, "--format", "full"]);
    return this.parseMessage(result);
  }

  /**
   * Get a thread with all its messages
   *
   * @param threadId - Gmail thread ID
   * @returns The thread with messages
   */
  async getThread(threadId: string): Promise<GmailThread> {
    const result = await this.execGog(["thread", "get", threadId]) as { thread?: unknown };
    // GOG CLI returns { thread: {...}, downloaded: null } - extract the thread object
    const threadData = result.thread || result;
    return this.parseThreadWithMessages(threadData);
  }

  /**
   * List all labels
   *
   * @returns Array of labels
   */
  async listLabels(): Promise<GmailLabel[]> {
    const result = (await this.execGog(["labels", "list"])) as { labels?: unknown[] };
    const labels = result.labels || [];
    return labels.map((l: unknown) => this.parseLabel(l));
  }

  /**
   * Get label details including counts
   *
   * @param labelIdOrName - Label ID or name
   * @returns Label details
   */
  async getLabel(labelIdOrName: string): Promise<GmailLabel> {
    const result = await this.execGog(["labels", "get", labelIdOrName]);
    return this.parseLabel(result);
  }

  // ==========================================================================
  // Write Operations
  // ==========================================================================

  /**
   * Send an email
   *
   * @param options - Email options
   * @returns Send result with message ID
   */
  async sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
    const args: string[] = ["send"];

    // Recipients
    args.push("--to", options.to.join(","));
    if (options.cc?.length) {
      args.push("--cc", options.cc.join(","));
    }
    if (options.bcc?.length) {
      args.push("--bcc", options.bcc.join(","));
    }

    // Subject and body
    args.push("--subject", options.subject);
    args.push("--body", options.body);

    // Reply options
    if (options.replyToMessageId) {
      args.push("--reply-to-message-id", options.replyToMessageId);
    }
    if (options.threadId) {
      args.push("--thread-id", options.threadId);
    }

    try {
      const result = (await this.execGog(args)) as {
        id?: string;
        threadId?: string;
      };
      return {
        success: true,
        messageId: result.id,
        threadId: result.threadId,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Reply to an email (auto-populates recipients)
   *
   * @param messageId - Message ID to reply to
   * @param body - Reply body
   * @param replyAll - Whether to reply to all recipients
   * @returns Send result
   */
  async replyToEmail(
    messageId: string,
    body: string,
    replyAll = false
  ): Promise<SendEmailResult> {
    const args: string[] = ["send"];

    args.push("--reply-to-message-id", messageId);
    if (replyAll) {
      args.push("--reply-all");
    }
    args.push("--body", body);

    try {
      const result = (await this.execGog(args)) as {
        id?: string;
        threadId?: string;
      };
      return {
        success: true,
        messageId: result.id,
        threadId: result.threadId,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==========================================================================
  // Thread Operations
  // ==========================================================================

  /**
   * Modify labels on a thread (add/remove)
   *
   * @param threadId - Thread ID
   * @param options - Labels to add/remove
   */
  async modifyLabels(
    threadId: string,
    options: { addLabels?: string[]; removeLabels?: string[] }
  ): Promise<void> {
    const args = ["labels", "modify", threadId];

    if (options.addLabels?.length) {
      args.push("--add", options.addLabels.join(","));
    }
    if (options.removeLabels?.length) {
      args.push("--remove", options.removeLabels.join(","));
    }

    await this.execGog(args);
  }

  /**
   * Mark a thread as read (removes UNREAD label)
   *
   * @param threadId - Thread ID
   */
  async markAsRead(threadId: string): Promise<void> {
    await this.modifyLabels(threadId, { removeLabels: ["UNREAD"] });
  }

  /**
   * Mark a thread as unread (adds UNREAD label)
   *
   * @param threadId - Thread ID
   */
  async markAsUnread(threadId: string): Promise<void> {
    await this.modifyLabels(threadId, { addLabels: ["UNREAD"] });
  }

  /**
   * Archive a thread (removes INBOX label)
   *
   * @param threadId - Thread ID
   */
  async archive(threadId: string): Promise<void> {
    await this.modifyLabels(threadId, { removeLabels: ["INBOX"] });
  }

  // ==========================================================================
  // Parsing Helpers
  // ==========================================================================

  private parseThread(raw: unknown): GmailThread {
    const t = raw as Record<string, unknown>;
    return {
      id: String(t.id || t.threadId || ""),
      snippet: String(t.snippet || ""),
      historyId: t.historyId ? String(t.historyId) : undefined,
    };
  }

  private parseThreadWithMessages(raw: unknown): GmailThread {
    const t = raw as Record<string, unknown>;
    const thread = this.parseThread(t);

    if (Array.isArray(t.messages)) {
      thread.messages = t.messages.map((m: unknown) => this.parseMessage(m));
    }

    return thread;
  }

  private parseMessage(raw: unknown): GmailMessage {
    const m = raw as Record<string, unknown>;
    const headers = (m.payload as Record<string, unknown>)?.headers as
      | Array<{ name: string; value: string }>
      | undefined;
    const labelIds = (m.labelIds || []) as string[];

    // Extract headers
    const getHeader = (name: string): string => {
      const header = headers?.find(
        (h) => h.name.toLowerCase() === name.toLowerCase()
      );
      return header?.value || "";
    };

    // Parse body from payload
    let body = "";
    const payload = m.payload as Record<string, unknown> | undefined;
    if (payload) {
      body = this.extractBody(payload);
    }

    // Parse snippet if body is empty
    if (!body && m.snippet) {
      body = String(m.snippet);
    }

    // Parse date
    const dateStr = getHeader("Date") || String(m.internalDate || "");
    let date: Date;
    if (dateStr.match(/^\d+$/)) {
      date = new Date(parseInt(dateStr, 10));
    } else {
      date = new Date(dateStr);
    }

    // Parse recipients
    const to = getHeader("To")
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean);
    const cc = getHeader("Cc")
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean);

    return {
      id: String(m.id || ""),
      threadId: String(m.threadId || ""),
      from: getHeader("From"),
      to,
      cc: cc.length > 0 ? cc : undefined,
      subject: getHeader("Subject"),
      body,
      snippet: m.snippet ? String(m.snippet) : undefined,
      date,
      labels: labelIds,
      isRead: !labelIds.includes("UNREAD"),
    };
  }

  private extractBody(payload: Record<string, unknown>): string {
    // Try to get body directly
    const body = payload.body as Record<string, unknown> | undefined;
    if (body?.data) {
      return this.decodeBase64(String(body.data));
    }

    // Try parts (multipart messages)
    const parts = payload.parts as Array<Record<string, unknown>> | undefined;
    if (parts) {
      // Prefer text/plain
      for (const part of parts) {
        if (part.mimeType === "text/plain") {
          const partBody = part.body as Record<string, unknown> | undefined;
          if (partBody?.data) {
            return this.decodeBase64(String(partBody.data));
          }
        }
      }
      // Fall back to first part with data
      for (const part of parts) {
        const partBody = part.body as Record<string, unknown> | undefined;
        if (partBody?.data) {
          return this.decodeBase64(String(partBody.data));
        }
        // Recursive for nested parts
        if (part.parts) {
          const nested = this.extractBody(part as Record<string, unknown>);
          if (nested) return nested;
        }
      }
    }

    return "";
  }

  private decodeBase64(data: string): string {
    // Gmail uses URL-safe base64
    const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
    return Buffer.from(base64, "base64").toString("utf-8");
  }

  private parseLabel(raw: unknown): GmailLabel {
    const l = raw as Record<string, unknown>;
    return {
      id: String(l.id || ""),
      name: String(l.name || ""),
      type: l.type ? String(l.type) : undefined,
      messagesTotal: typeof l.messagesTotal === "number" ? l.messagesTotal : undefined,
      messagesUnread: typeof l.messagesUnread === "number" ? l.messagesUnread : undefined,
    };
  }
}

// ============================================================================
// Singleton Pattern
// ============================================================================

let _gmailService: GmailService | null = null;

/**
 * Get the Gmail service instance (singleton)
 * Creates the service if not already initialized.
 *
 * @throws Error if Gmail account is not configured
 */
export function getGmailService(): GmailService {
  if (!_gmailService) {
    _gmailService = new GmailService();
  }
  return _gmailService;
}

/**
 * Check if Gmail is configured
 */
export function isGmailConfigured(): boolean {
  return getGoogleAccount() !== null;
}

/**
 * Reset the Gmail service (for testing)
 */
export function resetGmailService(): void {
  _gmailService = null;
}
