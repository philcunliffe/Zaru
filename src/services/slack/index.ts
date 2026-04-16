/**
 * Slack Service Index
 *
 * Re-exports all Slack service components for convenient imports.
 */

// Client and configuration
export {
  SlackService,
  getSlackService,
  resetSlackService,
  getSlackToken,
  isSlackConfigured,
  saveSlackToken,
  type SlackServiceOptions,
} from "./client";

// Types
export type {
  // Core objects
  SlackChannel,
  SlackMessage,
  SlackReaction,
  SlackAttachment,
  SlackUser,
  SlackSearchMatch,
  SlackAuthTestResponse,
  // Response envelopes
  SlackApiResponse,
  SlackChannelListResponse,
  SlackConversationHistoryResponse,
  SlackConversationRepliesResponse,
  SlackSearchResponse,
  SlackPostMessageResponse,
  SlackReactionAddResponse,
  SlackSetTopicResponse,
  // Request params
  ListChannelsParams,
  ConversationHistoryParams,
  ConversationRepliesParams,
  SearchMessagesParams,
  PostMessageParams,
  AddReactionParams,
  SetTopicParams,
} from "./types";
