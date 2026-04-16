/**
 * Slack Web API Types
 *
 * TypeScript types for Slack Web API responses and request parameters.
 * Covers the subset needed by Zaru's READ and WRITE tools.
 */

// ============================================================================
// Core Slack Objects
// ============================================================================

export interface SlackChannel {
  id: string;
  name: string;
  is_channel: boolean;
  is_group: boolean;
  is_im: boolean;
  is_mpim: boolean;
  is_private: boolean;
  is_archived: boolean;
  is_member: boolean;
  topic: { value: string; creator: string; last_set: number };
  purpose: { value: string; creator: string; last_set: number };
  num_members: number;
  created: number;
}

export interface SlackMessage {
  type: string;
  subtype?: string;
  ts: string;
  user?: string;
  bot_id?: string;
  text: string;
  thread_ts?: string;
  reply_count?: number;
  reply_users_count?: number;
  latest_reply?: string;
  reactions?: SlackReaction[];
  attachments?: SlackAttachment[];
  blocks?: unknown[];
}

export interface SlackReaction {
  name: string;
  users: string[];
  count: number;
}

export interface SlackAttachment {
  fallback?: string;
  color?: string;
  pretext?: string;
  author_name?: string;
  title?: string;
  text?: string;
  fields?: Array<{ title: string; value: string; short: boolean }>;
  ts?: string;
}

export interface SlackUser {
  id: string;
  name: string;
  real_name: string;
  is_bot: boolean;
  is_admin: boolean;
  deleted: boolean;
  profile: {
    display_name: string;
    real_name: string;
    email?: string;
    image_48?: string;
  };
}

export interface SlackSearchMatch {
  iid: string;
  channel: { id: string; name: string };
  type: string;
  user: string;
  username: string;
  ts: string;
  text: string;
  permalink: string;
}

export interface SlackAuthTestResponse {
  ok: boolean;
  url: string;
  team: string;
  user: string;
  team_id: string;
  user_id: string;
  bot_id?: string;
}

// ============================================================================
// API Response Envelopes
// ============================================================================

/** Base response — every Slack API response includes ok + optional error */
export interface SlackApiResponse {
  ok: boolean;
  error?: string;
}

export interface SlackChannelListResponse extends SlackApiResponse {
  channels: SlackChannel[];
  response_metadata?: { next_cursor: string };
}

export interface SlackConversationHistoryResponse extends SlackApiResponse {
  messages: SlackMessage[];
  has_more: boolean;
  response_metadata?: { next_cursor: string };
}

export interface SlackConversationRepliesResponse extends SlackApiResponse {
  messages: SlackMessage[];
  has_more: boolean;
  response_metadata?: { next_cursor: string };
}

export interface SlackSearchResponse extends SlackApiResponse {
  messages: {
    total: number;
    matches: SlackSearchMatch[];
    paging: { count: number; total: number; page: number; pages: number };
  };
}

export interface SlackPostMessageResponse extends SlackApiResponse {
  channel: string;
  ts: string;
  message: SlackMessage;
}

export interface SlackReactionAddResponse extends SlackApiResponse {}

export interface SlackSetTopicResponse extends SlackApiResponse {
  topic: string;
}

// ============================================================================
// Request Parameter Types
// ============================================================================

export interface ListChannelsParams {
  types?: string;
  exclude_archived?: boolean;
  limit?: number;
  cursor?: string;
}

export interface ConversationHistoryParams {
  channel: string;
  limit?: number;
  cursor?: string;
  oldest?: string;
  latest?: string;
  inclusive?: boolean;
}

export interface ConversationRepliesParams {
  channel: string;
  ts: string;
  limit?: number;
  cursor?: string;
  oldest?: string;
  latest?: string;
  inclusive?: boolean;
}

export interface SearchMessagesParams {
  query: string;
  count?: number;
  page?: number;
  sort?: "score" | "timestamp";
  sort_dir?: "asc" | "desc";
}

export interface PostMessageParams {
  channel: string;
  text: string;
  thread_ts?: string;
  reply_broadcast?: boolean;
  unfurl_links?: boolean;
  unfurl_media?: boolean;
}

export interface AddReactionParams {
  channel: string;
  timestamp: string;
  name: string;
}

export interface SetTopicParams {
  channel: string;
  topic: string;
}
