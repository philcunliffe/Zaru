/**
 * GitHub Service Index
 *
 * Re-exports all GitHub service components for convenient imports.
 */

// Client and configuration
export {
  GithubService,
  getGithubClient,
  resetGithubClient,
  getGithubToken,
  isGithubConfigured,
  saveGithubToken,
  parseLinkHeader,
  type GithubServiceOptions,
} from "./client";

// Types
export type {
  // Core objects
  GithubUser,
  GithubLabel,
  GithubMilestone,
  GithubRepository,
  GithubIssue,
  GithubPullRequest,
  GithubComment,
  GithubCommit,
  GithubCommitAuthor,
  GithubRateLimit,
  // Response envelopes
  GithubSearchResponse,
  // Request params
  RepoRef,
  PaginationParams,
  ListIssuesParams,
  GetIssueParams,
  ListIssueCommentsParams,
  ListPullsParams,
  GetPullParams,
  ListPullCommentsParams,
  ListCommitsParams,
  SearchIssuesParams,
  CreateIssueParams,
  UpdateIssueParams,
  CreateIssueCommentParams,
  CreatePullParams,
  UpdatePullParams,
  AddLabelsParams,
  RemoveLabelParams,
} from "./types";
