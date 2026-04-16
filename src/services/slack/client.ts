/**
 * Slack Web API Client
 *
 * HTTP client for the Slack Web API using xoxb-* bot token authentication.
 * Provides typed methods for the Slack operations needed by Zaru's READ and WRITE tools.
 */

import { loadConfig, saveConfig, type ZaruConfig } from "../google/base";
import type {
  SlackApiResponse,
  SlackAuthTestResponse,
  SlackChannelListResponse,
  SlackConversationHistoryResponse,
  SlackConversationRepliesResponse,
  SlackSearchResponse,
  SlackPostMessageResponse,
  SlackReactionAddResponse,
  SlackSetTopicResponse,
  ListChannelsParams,
  ConversationHistoryParams,
  ConversationRepliesParams,
  SearchMessagesParams,
  PostMessageParams,
  AddReactionParams,
  SetTopicParams,
} from "./types";

// ============================================================================
// Configuration
// ============================================================================

const SLACK_API_BASE = "https://slack.com/api";

export interface SlackServiceOptions {
  /** xoxb-* bot token */
  token?: string;
}

/**
 * Get the configured Slack bot token from ~/.zaru/config.json
 */
export function getSlackToken(): string | null {
  const config = loadConfig();
  return (config as ZaruConfig & { slack?: { botToken?: string } }).slack?.botToken || null;
}

/**
 * Check if Slack is configured
 */
export function isSlackConfigured(): boolean {
  return getSlackToken() !== null;
}

/**
 * Save Slack bot token to configuration
 */
export function saveSlackToken(token: string): void {
  const config = loadConfig() as ZaruConfig & { slack?: { botToken?: string } };
  config.slack = { ...config.slack, botToken: token };
  saveConfig(config);
}

// ============================================================================
// Slack Service
// ============================================================================

export class SlackService {
  private token: string;

  constructor(options?: SlackServiceOptions) {
    const configToken = getSlackToken();
    this.token = options?.token || configToken || "";

    if (!this.token) {
      throw new Error(
        "Slack bot token not configured. Set slack.botToken in ~/.zaru/config.json or pass token in options"
      );
    }

    if (!this.token.startsWith("xoxb-")) {
      throw new Error(
        "Invalid Slack token format. Expected xoxb-* bot token"
      );
    }
  }

  // ==========================================================================
  // HTTP Layer
  // ==========================================================================

  /**
   * Make an authenticated request to the Slack Web API
   */
  private async apiCall<T extends SlackApiResponse>(
    method: string,
    params?: Record<string, unknown>
  ): Promise<T> {
    const url = `${SLACK_API_BASE}/${method}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: params ? JSON.stringify(params) : undefined,
    });

    if (!response.ok) {
      throw new Error(
        `Slack API HTTP error: ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as T;

    if (!data.ok) {
      throw new Error(`Slack API error: ${data.error || "unknown error"}`);
    }

    return data;
  }

  // ==========================================================================
  // Auth
  // ==========================================================================

  /**
   * Test the bot token and return identity information
   */
  async authTest(): Promise<SlackAuthTestResponse> {
    return this.apiCall<SlackAuthTestResponse>("auth.test");
  }

  // ==========================================================================
  // READ Operations
  // ==========================================================================

  /**
   * List channels the bot has access to
   *
   * @param params - Filter and pagination options
   * @returns Channel list with pagination cursor
   */
  async listChannels(
    params?: ListChannelsParams
  ): Promise<SlackChannelListResponse> {
    return this.apiCall<SlackChannelListResponse>("conversations.list", {
      types: params?.types ?? "public_channel,private_channel",
      exclude_archived: params?.exclude_archived ?? true,
      limit: params?.limit ?? 100,
      ...(params?.cursor && { cursor: params.cursor }),
    });
  }

  /**
   * Get message history for a channel
   *
   * @param params - Channel ID and pagination/filter options
   * @returns Messages with pagination info
   */
  async getHistory(
    params: ConversationHistoryParams
  ): Promise<SlackConversationHistoryResponse> {
    return this.apiCall<SlackConversationHistoryResponse>(
      "conversations.history",
      {
        channel: params.channel,
        limit: params.limit ?? 20,
        ...(params.cursor && { cursor: params.cursor }),
        ...(params.oldest && { oldest: params.oldest }),
        ...(params.latest && { latest: params.latest }),
        ...(params.inclusive !== undefined && { inclusive: params.inclusive }),
      }
    );
  }

  /**
   * Get replies in a message thread
   *
   * @param params - Channel ID, thread timestamp, and pagination options
   * @returns Thread messages with pagination info
   */
  async getReplies(
    params: ConversationRepliesParams
  ): Promise<SlackConversationRepliesResponse> {
    return this.apiCall<SlackConversationRepliesResponse>(
      "conversations.replies",
      {
        channel: params.channel,
        ts: params.ts,
        limit: params.limit ?? 100,
        ...(params.cursor && { cursor: params.cursor }),
        ...(params.oldest && { oldest: params.oldest }),
        ...(params.latest && { latest: params.latest }),
        ...(params.inclusive !== undefined && { inclusive: params.inclusive }),
      }
    );
  }

  /**
   * Search messages across the workspace
   *
   * Note: Requires search:read scope on the bot token.
   *
   * @param params - Search query and pagination options
   * @returns Search results with matches and paging info
   */
  async searchMessages(
    params: SearchMessagesParams
  ): Promise<SlackSearchResponse> {
    return this.apiCall<SlackSearchResponse>("search.messages", {
      query: params.query,
      count: params.count ?? 20,
      ...(params.page && { page: params.page }),
      ...(params.sort && { sort: params.sort }),
      ...(params.sort_dir && { sort_dir: params.sort_dir }),
    });
  }

  // ==========================================================================
  // WRITE Operations
  // ==========================================================================

  /**
   * Send a message to a channel or thread
   *
   * @param params - Channel, text, and optional thread_ts for replies
   * @returns Posted message details
   */
  async postMessage(
    params: PostMessageParams
  ): Promise<SlackPostMessageResponse> {
    return this.apiCall<SlackPostMessageResponse>("chat.postMessage", {
      channel: params.channel,
      text: params.text,
      ...(params.thread_ts && { thread_ts: params.thread_ts }),
      ...(params.reply_broadcast !== undefined && {
        reply_broadcast: params.reply_broadcast,
      }),
      ...(params.unfurl_links !== undefined && {
        unfurl_links: params.unfurl_links,
      }),
      ...(params.unfurl_media !== undefined && {
        unfurl_media: params.unfurl_media,
      }),
    });
  }

  /**
   * Add a reaction (emoji) to a message
   *
   * @param params - Channel, message timestamp, and reaction name (without colons)
   */
  async addReaction(params: AddReactionParams): Promise<SlackReactionAddResponse> {
    return this.apiCall<SlackReactionAddResponse>("reactions.add", {
      channel: params.channel,
      timestamp: params.timestamp,
      name: params.name,
    });
  }

  /**
   * Set the topic of a channel
   *
   * @param params - Channel ID and new topic text
   * @returns The updated topic
   */
  async setTopic(params: SetTopicParams): Promise<SlackSetTopicResponse> {
    return this.apiCall<SlackSetTopicResponse>("conversations.setTopic", {
      channel: params.channel,
      topic: params.topic,
    });
  }

  // ==========================================================================
  // Utility
  // ==========================================================================

  /**
   * Get the bot token (masked for display)
   */
  getMaskedToken(): string {
    if (this.token.length <= 10) return "xoxb-***";
    return this.token.slice(0, 9) + "***" + this.token.slice(-4);
  }
}

// ============================================================================
// Singleton Pattern
// ============================================================================

let _slackService: SlackService | null = null;

/**
 * Get the Slack service instance (singleton)
 * Creates the service if not already initialized.
 *
 * @throws Error if Slack bot token is not configured
 */
export function getSlackService(): SlackService {
  if (!_slackService) {
    _slackService = new SlackService();
  }
  return _slackService;
}

/**
 * Reset the Slack service (for testing)
 */
export function resetSlackService(): void {
  _slackService = null;
}
