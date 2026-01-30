/**
 * Google Chat Service
 *
 * Wraps the GOG CLI (gog chat) for Chat operations.
 * Provides typed interface for reading messages from spaces.
 */

import { GoogleBaseService, type GoogleServiceOptions } from "./base";

// ============================================================================
// Types
// ============================================================================

export interface ChatSpace {
  name: string;
  type?: string;
  displayName?: string;
  spaceThreadingState?: string;
  spaceType?: string;
  spaceHistoryState?: string;
  adminInstalled?: boolean;
  membershipCount?: {
    joinedDirectHumanUserCount?: number;
    joinedGroupCount?: number;
  };
  createTime?: string;
}

export interface ChatMessage {
  name: string;
  sender?: {
    name?: string;
    displayName?: string;
    domainId?: string;
    type?: string;
    isAnonymous?: boolean;
  };
  createTime?: string;
  text?: string;
  formattedText?: string;
  cards?: unknown[];
  annotations?: MessageAnnotation[];
  thread?: {
    name?: string;
    threadKey?: string;
  };
  space?: {
    name?: string;
  };
  fallbackText?: string;
  actionResponse?: {
    type?: string;
    url?: string;
  };
  argumentText?: string;
  slashCommand?: {
    commandId?: string;
  };
  attachment?: Attachment[];
  matchedUrl?: {
    url?: string;
  };
  threadReply?: boolean;
  clientAssignedMessageId?: string;
  emojiReactionSummaries?: EmojiReactionSummary[];
  privateMessageViewer?: {
    name?: string;
    displayName?: string;
  };
  deletionMetadata?: {
    deletionType?: string;
  };
}

export interface MessageAnnotation {
  type?: string;
  startIndex?: number;
  length?: number;
  userMention?: {
    user?: {
      name?: string;
      displayName?: string;
    };
    type?: string;
  };
  slashCommand?: {
    bot?: {
      name?: string;
      displayName?: string;
    };
    type?: string;
    commandName?: string;
    commandId?: string;
    triggersDialog?: boolean;
  };
}

export interface Attachment {
  name?: string;
  contentName?: string;
  contentType?: string;
  attachmentDataRef?: {
    resourceName?: string;
  };
  driveDataRef?: {
    driveFileId?: string;
  };
  thumbnailUri?: string;
  downloadUri?: string;
  source?: string;
}

export interface EmojiReactionSummary {
  emoji?: {
    unicode?: string;
    customEmoji?: {
      uid?: string;
    };
  };
  reactionCount?: number;
}

// ============================================================================
// Google Chat Service
// ============================================================================

export class GoogleChatService extends GoogleBaseService {
  protected readonly serviceCommand = "chat";

  constructor(options?: GoogleServiceOptions) {
    super(options);
  }

  // ==========================================================================
  // Read Operations
  // ==========================================================================

  /**
   * List all spaces the user has access to
   *
   * @param options - Query options
   * @returns Array of spaces
   */
  async listSpaces(options?: {
    filter?: string;
    pageSize?: number;
    pageToken?: string;
  }): Promise<ChatSpace[]> {
    const args = ["spaces", "list"];

    if (options?.filter) {
      args.push("--filter", options.filter);
    }
    if (options?.pageSize) {
      args.push("--page-size", String(options.pageSize));
    }
    if (options?.pageToken) {
      args.push("--page-token", options.pageToken);
    }

    const result = (await this.execGog(args)) as { spaces?: unknown[] };
    const spaces = result.spaces || [];
    return spaces.map((s) => this.parseSpace(s));
  }

  /**
   * Get a single space by name
   *
   * @param spaceName - Space resource name (e.g., "spaces/ABC123")
   * @returns Space details
   */
  async getSpace(spaceName: string): Promise<ChatSpace> {
    const args = ["spaces", "get", spaceName];
    const result = await this.execGog(args);
    return this.parseSpace(result);
  }

  /**
   * List messages from a space
   *
   * @param spaceName - Space resource name
   * @param options - Query options
   * @returns Array of messages
   */
  async getMessages(
    spaceName: string,
    options?: {
      pageSize?: number;
      pageToken?: string;
      filter?: string;
      orderBy?: string;
      showDeleted?: boolean;
    }
  ): Promise<ChatMessage[]> {
    const args = ["messages", "list", spaceName];

    if (options?.pageSize) {
      args.push("--page-size", String(options.pageSize));
    }
    if (options?.pageToken) {
      args.push("--page-token", options.pageToken);
    }
    if (options?.filter) {
      args.push("--filter", options.filter);
    }
    if (options?.orderBy) {
      args.push("--order-by", options.orderBy);
    }
    if (options?.showDeleted) {
      args.push("--show-deleted");
    }

    const result = (await this.execGog(args)) as { messages?: unknown[] };
    const messages = result.messages || [];
    return messages.map((m) => this.parseMessage(m));
  }

  /**
   * Search messages across spaces
   *
   * @param query - Search query
   * @param options - Additional options
   * @returns Matching messages
   */
  async searchMessages(
    query: string,
    options?: {
      spaceName?: string;
      pageSize?: number;
    }
  ): Promise<ChatMessage[]> {
    // Chat API uses filter syntax for search
    const filter = `text contains "${query.replace(/"/g, '\\"')}"`;

    if (options?.spaceName) {
      return this.getMessages(options.spaceName, {
        filter,
        pageSize: options.pageSize || 20,
      });
    }

    // Search across all spaces
    const spaces = await this.listSpaces();
    const allMessages: ChatMessage[] = [];

    for (const space of spaces.slice(0, 10)) {
      // Limit to first 10 spaces
      try {
        const messages = await this.getMessages(space.name, {
          filter,
          pageSize: Math.ceil((options?.pageSize || 20) / spaces.length),
        });
        allMessages.push(...messages);
      } catch {
        // Skip spaces where search fails (permission issues, etc.)
      }
    }

    return allMessages.slice(0, options?.pageSize || 20);
  }

  /**
   * Get a single message by name
   *
   * @param messageName - Message resource name
   * @returns Message details
   */
  async getMessage(messageName: string): Promise<ChatMessage> {
    const args = ["messages", "get", messageName];
    const result = await this.execGog(args);
    return this.parseMessage(result);
  }

  // ==========================================================================
  // Parsing Helpers
  // ==========================================================================

  private parseSpace(raw: unknown): ChatSpace {
    const s = raw as Record<string, unknown>;
    return {
      name: String(s.name || ""),
      type: s.type ? String(s.type) : undefined,
      displayName: s.displayName ? String(s.displayName) : undefined,
      spaceThreadingState: s.spaceThreadingState
        ? String(s.spaceThreadingState)
        : undefined,
      spaceType: s.spaceType ? String(s.spaceType) : undefined,
      spaceHistoryState: s.spaceHistoryState
        ? String(s.spaceHistoryState)
        : undefined,
      adminInstalled:
        typeof s.adminInstalled === "boolean" ? s.adminInstalled : undefined,
      membershipCount: s.membershipCount
        ? this.parseMembershipCount(s.membershipCount)
        : undefined,
      createTime: s.createTime ? String(s.createTime) : undefined,
    };
  }

  private parseMembershipCount(raw: unknown): {
    joinedDirectHumanUserCount?: number;
    joinedGroupCount?: number;
  } {
    const m = raw as Record<string, unknown>;
    return {
      joinedDirectHumanUserCount:
        typeof m.joinedDirectHumanUserCount === "number"
          ? m.joinedDirectHumanUserCount
          : undefined,
      joinedGroupCount:
        typeof m.joinedGroupCount === "number" ? m.joinedGroupCount : undefined,
    };
  }

  private parseMessage(raw: unknown): ChatMessage {
    const m = raw as Record<string, unknown>;
    return {
      name: String(m.name || ""),
      sender: m.sender ? this.parseSender(m.sender) : undefined,
      createTime: m.createTime ? String(m.createTime) : undefined,
      text: m.text ? String(m.text) : undefined,
      formattedText: m.formattedText ? String(m.formattedText) : undefined,
      cards: Array.isArray(m.cards) ? m.cards : undefined,
      annotations: Array.isArray(m.annotations)
        ? m.annotations.map((a: unknown) => this.parseAnnotation(a))
        : undefined,
      thread: m.thread ? this.parseThread(m.thread) : undefined,
      space: m.space
        ? { name: String((m.space as Record<string, unknown>).name || "") }
        : undefined,
      fallbackText: m.fallbackText ? String(m.fallbackText) : undefined,
      actionResponse: m.actionResponse
        ? this.parseActionResponse(m.actionResponse)
        : undefined,
      argumentText: m.argumentText ? String(m.argumentText) : undefined,
      slashCommand: m.slashCommand
        ? this.parseSlashCommand(m.slashCommand)
        : undefined,
      attachment: Array.isArray(m.attachment)
        ? m.attachment.map((a: unknown) => this.parseAttachment(a))
        : undefined,
      matchedUrl: m.matchedUrl
        ? { url: String((m.matchedUrl as Record<string, unknown>).url || "") }
        : undefined,
      threadReply:
        typeof m.threadReply === "boolean" ? m.threadReply : undefined,
      clientAssignedMessageId: m.clientAssignedMessageId
        ? String(m.clientAssignedMessageId)
        : undefined,
      emojiReactionSummaries: Array.isArray(m.emojiReactionSummaries)
        ? m.emojiReactionSummaries.map((e: unknown) =>
            this.parseEmojiReactionSummary(e)
          )
        : undefined,
      privateMessageViewer: m.privateMessageViewer
        ? this.parseUser(m.privateMessageViewer)
        : undefined,
      deletionMetadata: m.deletionMetadata
        ? this.parseDeletionMetadata(m.deletionMetadata)
        : undefined,
    };
  }

  private parseSender(raw: unknown): {
    name?: string;
    displayName?: string;
    domainId?: string;
    type?: string;
    isAnonymous?: boolean;
  } {
    const s = raw as Record<string, unknown>;
    return {
      name: s.name ? String(s.name) : undefined,
      displayName: s.displayName ? String(s.displayName) : undefined,
      domainId: s.domainId ? String(s.domainId) : undefined,
      type: s.type ? String(s.type) : undefined,
      isAnonymous: typeof s.isAnonymous === "boolean" ? s.isAnonymous : undefined,
    };
  }

  private parseAnnotation(raw: unknown): MessageAnnotation {
    const a = raw as Record<string, unknown>;
    return {
      type: a.type ? String(a.type) : undefined,
      startIndex: typeof a.startIndex === "number" ? a.startIndex : undefined,
      length: typeof a.length === "number" ? a.length : undefined,
      userMention: a.userMention
        ? this.parseUserMention(a.userMention)
        : undefined,
      slashCommand: a.slashCommand
        ? this.parseAnnotationSlashCommand(a.slashCommand)
        : undefined,
    };
  }

  private parseUserMention(raw: unknown): {
    user?: { name?: string; displayName?: string };
    type?: string;
  } {
    const u = raw as Record<string, unknown>;
    return {
      user: u.user ? this.parseUser(u.user) : undefined,
      type: u.type ? String(u.type) : undefined,
    };
  }

  private parseAnnotationSlashCommand(raw: unknown): {
    bot?: { name?: string; displayName?: string };
    type?: string;
    commandName?: string;
    commandId?: string;
    triggersDialog?: boolean;
  } {
    const s = raw as Record<string, unknown>;
    return {
      bot: s.bot ? this.parseUser(s.bot) : undefined,
      type: s.type ? String(s.type) : undefined,
      commandName: s.commandName ? String(s.commandName) : undefined,
      commandId: s.commandId ? String(s.commandId) : undefined,
      triggersDialog:
        typeof s.triggersDialog === "boolean" ? s.triggersDialog : undefined,
    };
  }

  private parseUser(raw: unknown): {
    name?: string;
    displayName?: string;
  } {
    const u = raw as Record<string, unknown>;
    return {
      name: u.name ? String(u.name) : undefined,
      displayName: u.displayName ? String(u.displayName) : undefined,
    };
  }

  private parseThread(raw: unknown): {
    name?: string;
    threadKey?: string;
  } {
    const t = raw as Record<string, unknown>;
    return {
      name: t.name ? String(t.name) : undefined,
      threadKey: t.threadKey ? String(t.threadKey) : undefined,
    };
  }

  private parseActionResponse(raw: unknown): {
    type?: string;
    url?: string;
  } {
    const a = raw as Record<string, unknown>;
    return {
      type: a.type ? String(a.type) : undefined,
      url: a.url ? String(a.url) : undefined,
    };
  }

  private parseSlashCommand(raw: unknown): {
    commandId?: string;
  } {
    const s = raw as Record<string, unknown>;
    return {
      commandId: s.commandId ? String(s.commandId) : undefined,
    };
  }

  private parseAttachment(raw: unknown): Attachment {
    const a = raw as Record<string, unknown>;
    return {
      name: a.name ? String(a.name) : undefined,
      contentName: a.contentName ? String(a.contentName) : undefined,
      contentType: a.contentType ? String(a.contentType) : undefined,
      attachmentDataRef: a.attachmentDataRef
        ? {
            resourceName: String(
              (a.attachmentDataRef as Record<string, unknown>).resourceName || ""
            ),
          }
        : undefined,
      driveDataRef: a.driveDataRef
        ? {
            driveFileId: String(
              (a.driveDataRef as Record<string, unknown>).driveFileId || ""
            ),
          }
        : undefined,
      thumbnailUri: a.thumbnailUri ? String(a.thumbnailUri) : undefined,
      downloadUri: a.downloadUri ? String(a.downloadUri) : undefined,
      source: a.source ? String(a.source) : undefined,
    };
  }

  private parseEmojiReactionSummary(raw: unknown): EmojiReactionSummary {
    const e = raw as Record<string, unknown>;
    return {
      emoji: e.emoji ? this.parseEmoji(e.emoji) : undefined,
      reactionCount:
        typeof e.reactionCount === "number" ? e.reactionCount : undefined,
    };
  }

  private parseEmoji(raw: unknown): {
    unicode?: string;
    customEmoji?: { uid?: string };
  } {
    const e = raw as Record<string, unknown>;
    return {
      unicode: e.unicode ? String(e.unicode) : undefined,
      customEmoji: e.customEmoji
        ? { uid: String((e.customEmoji as Record<string, unknown>).uid || "") }
        : undefined,
    };
  }

  private parseDeletionMetadata(raw: unknown): {
    deletionType?: string;
  } {
    const d = raw as Record<string, unknown>;
    return {
      deletionType: d.deletionType ? String(d.deletionType) : undefined,
    };
  }
}

// ============================================================================
// Singleton Pattern
// ============================================================================

let _chatService: GoogleChatService | null = null;

/**
 * Get the Chat service instance (singleton)
 */
export function getChatService(): GoogleChatService {
  if (!_chatService) {
    _chatService = new GoogleChatService();
  }
  return _chatService;
}

/**
 * Reset the Chat service (for testing)
 */
export function resetChatService(): void {
  _chatService = null;
}
