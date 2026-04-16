/**
 * GitHub REST API v3 Types
 *
 * TypeScript types for GitHub REST API responses and request parameters.
 * Covers the subset needed by Zaru's READ and WRITE tools.
 *
 * Reference: https://docs.github.com/en/rest
 */

// ============================================================================
// Core GitHub Objects
// ============================================================================

export interface GithubUser {
  id: number;
  login: string;
  node_id: string;
  avatar_url: string;
  html_url: string;
  type: "User" | "Bot" | "Organization";
  site_admin: boolean;
  name?: string | null;
  email?: string | null;
}

export interface GithubLabel {
  id: number;
  node_id: string;
  name: string;
  description: string | null;
  color: string;
  default: boolean;
}

export interface GithubMilestone {
  id: number;
  number: number;
  title: string;
  description: string | null;
  state: "open" | "closed";
  due_on: string | null;
}

export interface GithubRepository {
  id: number;
  node_id: string;
  name: string;
  full_name: string;
  owner: GithubUser;
  private: boolean;
  html_url: string;
  description: string | null;
  fork: boolean;
  default_branch: string;
  archived: boolean;
  disabled: boolean;
  visibility: "public" | "private" | "internal";
  pushed_at: string | null;
  created_at: string;
  updated_at: string;
  open_issues_count: number;
  stargazers_count: number;
  forks_count: number;
  language: string | null;
}

export interface GithubIssue {
  id: number;
  node_id: string;
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  state_reason?: "completed" | "reopened" | "not_planned" | null;
  user: GithubUser | null;
  assignee: GithubUser | null;
  assignees: GithubUser[];
  labels: GithubLabel[];
  milestone: GithubMilestone | null;
  comments: number;
  html_url: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  pull_request?: { url: string; html_url: string; diff_url: string; patch_url: string };
  locked: boolean;
  author_association: string;
}

export interface GithubPullRequest {
  id: number;
  node_id: string;
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  user: GithubUser | null;
  assignee: GithubUser | null;
  assignees: GithubUser[];
  requested_reviewers: GithubUser[];
  labels: GithubLabel[];
  milestone: GithubMilestone | null;
  draft: boolean;
  merged: boolean;
  merged_at: string | null;
  merge_commit_sha: string | null;
  mergeable: boolean | null;
  mergeable_state?: string;
  comments: number;
  review_comments: number;
  commits: number;
  additions: number;
  deletions: number;
  changed_files: number;
  html_url: string;
  diff_url: string;
  patch_url: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  head: { label: string; ref: string; sha: string; repo: GithubRepository | null };
  base: { label: string; ref: string; sha: string; repo: GithubRepository };
}

export interface GithubComment {
  id: number;
  node_id: string;
  body: string;
  user: GithubUser | null;
  html_url: string;
  issue_url?: string;
  pull_request_url?: string;
  created_at: string;
  updated_at: string;
  author_association: string;
}

export interface GithubCommitAuthor {
  name: string;
  email: string;
  date: string;
}

export interface GithubCommit {
  sha: string;
  node_id: string;
  html_url: string;
  commit: {
    author: GithubCommitAuthor;
    committer: GithubCommitAuthor;
    message: string;
    tree: { sha: string; url: string };
    comment_count: number;
  };
  author: GithubUser | null;
  committer: GithubUser | null;
  parents: Array<{ sha: string; url: string; html_url: string }>;
}

// ============================================================================
// Search Response Envelopes
// ============================================================================

export interface GithubSearchResponse<T> {
  total_count: number;
  incomplete_results: boolean;
  items: T[];
}

// ============================================================================
// Rate Limit
// ============================================================================

export interface GithubRateLimit {
  limit: number;
  remaining: number;
  reset: number;
  used: number;
  resource: string;
}

// ============================================================================
// Request Parameter Types
// ============================================================================

export interface RepoRef {
  owner: string;
  repo: string;
}

export interface PaginationParams {
  per_page?: number;
  page?: number;
}

export interface ListIssuesParams extends RepoRef, PaginationParams {
  state?: "open" | "closed" | "all";
  labels?: string;
  sort?: "created" | "updated" | "comments";
  direction?: "asc" | "desc";
  since?: string;
  assignee?: string;
  creator?: string;
  mentioned?: string;
  milestone?: string;
}

export interface GetIssueParams extends RepoRef {
  issue_number: number;
}

export interface ListIssueCommentsParams extends RepoRef, PaginationParams {
  issue_number: number;
  since?: string;
}

export interface ListPullsParams extends RepoRef, PaginationParams {
  state?: "open" | "closed" | "all";
  head?: string;
  base?: string;
  sort?: "created" | "updated" | "popularity" | "long-running";
  direction?: "asc" | "desc";
}

export interface GetPullParams extends RepoRef {
  pull_number: number;
}

export interface ListPullCommentsParams extends RepoRef, PaginationParams {
  pull_number: number;
  since?: string;
}

export interface ListCommitsParams extends RepoRef, PaginationParams {
  sha?: string;
  path?: string;
  author?: string;
  committer?: string;
  since?: string;
  until?: string;
}

export interface SearchIssuesParams extends PaginationParams {
  q: string;
  sort?: "comments" | "reactions" | "created" | "updated";
  order?: "asc" | "desc";
}

export interface CreateIssueParams extends RepoRef {
  title: string;
  body?: string;
  assignees?: string[];
  labels?: string[];
  milestone?: number;
}

export interface UpdateIssueParams extends RepoRef {
  issue_number: number;
  title?: string;
  body?: string;
  state?: "open" | "closed";
  state_reason?: "completed" | "not_planned" | "reopened";
  assignees?: string[];
  labels?: string[];
  milestone?: number | null;
}

export interface CreateIssueCommentParams extends RepoRef {
  issue_number: number;
  body: string;
}

export interface CreatePullParams extends RepoRef {
  title: string;
  head: string;
  base: string;
  body?: string;
  draft?: boolean;
  maintainer_can_modify?: boolean;
}

export interface UpdatePullParams extends RepoRef {
  pull_number: number;
  title?: string;
  body?: string;
  state?: "open" | "closed";
  base?: string;
}

export interface AddLabelsParams extends RepoRef {
  issue_number: number;
  labels: string[];
}

export interface RemoveLabelParams extends RepoRef {
  issue_number: number;
  name: string;
}
