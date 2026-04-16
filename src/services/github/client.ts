/**
 * GitHub REST API Client
 *
 * Fetch-based HTTP client for the GitHub REST API v3 with PAT authentication.
 * Handles retries with exponential backoff for 429 (rate limit) and 5xx responses,
 * and provides a pagination helper that follows Link headers.
 */

import { loadConfig, saveConfig, type ZaruConfig } from "../google/base";
import type {
  GithubRateLimit,
  GithubIssue,
  GithubPullRequest,
  GithubComment,
  GithubCommit,
  GithubRepository,
  GithubUser,
  GithubSearchResponse,
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

// ============================================================================
// Configuration
// ============================================================================

const GITHUB_API_BASE = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";
const DEFAULT_USER_AGENT = "zaru-github-client";

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;

export interface GithubServiceOptions {
  /** GitHub Personal Access Token. Falls back to config, then GITHUB_TOKEN env. */
  token?: string;
  /** Override API base URL (primarily for testing). */
  baseUrl?: string;
  /** Override User-Agent header. */
  userAgent?: string;
  /** Max retry attempts for 429/5xx (default 3). */
  maxRetries?: number;
}

/**
 * Resolve the GitHub token from config or environment.
 * Priority: explicit arg > config.github.token > GITHUB_TOKEN env var.
 */
export function getGithubToken(): string | null {
  const config = loadConfig();
  if (config.github?.token) return config.github.token;
  const envToken = process.env.GITHUB_TOKEN;
  return envToken && envToken.length > 0 ? envToken : null;
}

/**
 * Check whether GitHub is configured (token available from any source).
 */
export function isGithubConfigured(): boolean {
  return getGithubToken() !== null;
}

/**
 * Persist a GitHub PAT to ~/.zaru/config.json.
 */
export function saveGithubToken(token: string): void {
  const config: ZaruConfig = loadConfig();
  config.github = { ...config.github, token };
  saveConfig(config);
}

// ============================================================================
// Internal helpers
// ============================================================================

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
}

interface RawResponse<T> {
  data: T;
  headers: Headers;
  status: number;
}

function buildUrl(base: string, path: string, query?: RequestOptions["query"]): string {
  const url = new URL(path.startsWith("/") ? path : `/${path}`, base);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

/**
 * Parse RFC 5988 Link header into a map of rel → URL.
 */
export function parseLinkHeader(header: string | null): Record<string, string> {
  if (!header) return {};
  const links: Record<string, string> = {};
  for (const part of header.split(",")) {
    const match = part.trim().match(/^<([^>]+)>;\s*rel="([^"]+)"/);
    if (match) links[match[2]] = match[1];
  }
  return links;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Compute backoff delay in ms. Honours Retry-After header when present,
 * otherwise exponential backoff with jitter capped at MAX_BACKOFF_MS.
 */
function computeBackoff(attempt: number, retryAfterHeader: string | null): number {
  if (retryAfterHeader) {
    const seconds = Number(retryAfterHeader);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.min(seconds * 1000, MAX_BACKOFF_MS);
    }
  }
  const base = Math.min(INITIAL_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
  const jitter = Math.random() * base * 0.25;
  return base + jitter;
}

// ============================================================================
// GitHub Service
// ============================================================================

export class GithubService {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly userAgent: string;
  private readonly maxRetries: number;

  constructor(options?: GithubServiceOptions) {
    const token = options?.token ?? getGithubToken();
    if (!token) {
      throw new Error(
        "GitHub token not configured. Set github.token in ~/.zaru/config.json, " +
          "export GITHUB_TOKEN, or pass token in options.",
      );
    }
    this.token = token;
    this.baseUrl = options?.baseUrl ?? GITHUB_API_BASE;
    this.userAgent = options?.userAgent ?? DEFAULT_USER_AGENT;
    this.maxRetries = options?.maxRetries ?? MAX_RETRIES;
  }

  // --------------------------------------------------------------------------
  // Low-level request layer
  // --------------------------------------------------------------------------

  /**
   * Execute a single authenticated request against the GitHub API, with retry
   * on 429 and 5xx responses. Returns parsed body + headers so callers can
   * inspect pagination links.
   */
  async request<T>(path: string, options?: RequestOptions): Promise<RawResponse<T>> {
    const method = options?.method ?? "GET";
    const url = buildUrl(this.baseUrl, path, options?.query);
    const hasBody = options?.body !== undefined;

    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      let response: Response;
      try {
        response = await fetch(url, {
          method,
          headers: {
            "Authorization": `Bearer ${this.token}`,
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": GITHUB_API_VERSION,
            "User-Agent": this.userAgent,
            ...(hasBody ? { "Content-Type": "application/json" } : {}),
          },
          body: hasBody ? JSON.stringify(options?.body) : undefined,
        });
      } catch (err) {
        lastError = err;
        if (attempt >= this.maxRetries) {
          throw new Error(
            `GitHub request failed (${method} ${path}): ${(err as Error).message}`,
          );
        }
        await sleep(computeBackoff(attempt, null));
        continue;
      }

      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt < this.maxRetries) {
        await sleep(computeBackoff(attempt, response.headers.get("retry-after")));
        continue;
      }

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(
          `GitHub API error ${response.status} ${response.statusText} ` +
            `(${method} ${path}): ${text || "<no body>"}`,
        );
      }

      // 204 No Content or empty body
      if (response.status === 204 || response.headers.get("content-length") === "0") {
        return {
          data: undefined as unknown as T,
          headers: response.headers,
          status: response.status,
        };
      }

      const data = (await response.json()) as T;
      return { data, headers: response.headers, status: response.status };
    }

    throw new Error(
      `GitHub request exhausted retries (${method} ${path}): ${String(lastError)}`,
    );
  }

  /**
   * Iterate every page of a list endpoint following GitHub's Link headers.
   * Yields one item at a time across all pages. Respects per_page when provided.
   */
  async *paginate<T>(
    path: string,
    options?: RequestOptions,
  ): AsyncGenerator<T, void, void> {
    let nextUrl: string | null = buildUrl(this.baseUrl, path, options?.query);
    const method = options?.method ?? "GET";
    const body = options?.body;

    while (nextUrl) {
      // Strip base to build relative path for request(); keeps query intact.
      const parsed: URL = new URL(nextUrl);
      const relPath: string = parsed.pathname + parsed.search;
      const { data, headers }: RawResponse<T[]> = await this.request<T[]>(relPath, {
        method,
        body,
      });

      if (Array.isArray(data)) {
        for (const item of data) yield item;
      }

      const links = parseLinkHeader(headers.get("link"));
      nextUrl = links.next ?? null;
    }
  }

  /**
   * Collect all pages of a list endpoint into a single array.
   * Convenience wrapper over paginate() for cases where streaming is not needed.
   */
  async paginateAll<T>(path: string, options?: RequestOptions): Promise<T[]> {
    const out: T[] = [];
    for await (const item of this.paginate<T>(path, options)) out.push(item);
    return out;
  }

  // --------------------------------------------------------------------------
  // Meta / auth
  // --------------------------------------------------------------------------

  /**
   * Fetch the authenticated user (equivalent to auth.test for Slack).
   */
  async getAuthenticatedUser(): Promise<GithubUser> {
    const { data } = await this.request<GithubUser>("/user");
    return data;
  }

  /**
   * Fetch the current rate-limit status for core, search, and graphql resources.
   */
  async getRateLimit(): Promise<{ resources: Record<string, GithubRateLimit> }> {
    const { data } = await this.request<{ resources: Record<string, GithubRateLimit> }>(
      "/rate_limit",
    );
    return data;
  }

  // --------------------------------------------------------------------------
  // Repository
  // --------------------------------------------------------------------------

  async getRepository(params: RepoRef): Promise<GithubRepository> {
    const { data } = await this.request<GithubRepository>(
      `/repos/${params.owner}/${params.repo}`,
    );
    return data;
  }

  // --------------------------------------------------------------------------
  // Issues — READ
  // --------------------------------------------------------------------------

  async listIssues(params: ListIssuesParams): Promise<GithubIssue[]> {
    const { owner, repo, ...query } = params;
    const { data } = await this.request<GithubIssue[]>(
      `/repos/${owner}/${repo}/issues`,
      { query: query as Record<string, string | number | boolean | undefined> },
    );
    return data;
  }

  async getIssue(params: GetIssueParams): Promise<GithubIssue> {
    const { data } = await this.request<GithubIssue>(
      `/repos/${params.owner}/${params.repo}/issues/${params.issue_number}`,
    );
    return data;
  }

  async listIssueComments(params: ListIssueCommentsParams): Promise<GithubComment[]> {
    const { owner, repo, issue_number, ...query } = params;
    const { data } = await this.request<GithubComment[]>(
      `/repos/${owner}/${repo}/issues/${issue_number}/comments`,
      { query: query as Record<string, string | number | boolean | undefined> },
    );
    return data;
  }

  async searchIssues(
    params: SearchIssuesParams,
  ): Promise<GithubSearchResponse<GithubIssue>> {
    const { data } = await this.request<GithubSearchResponse<GithubIssue>>(
      "/search/issues",
      { query: { ...params } as Record<string, string | number | boolean | undefined> },
    );
    return data;
  }

  // --------------------------------------------------------------------------
  // Pull Requests — READ
  // --------------------------------------------------------------------------

  async listPulls(params: ListPullsParams): Promise<GithubPullRequest[]> {
    const { owner, repo, ...query } = params;
    const { data } = await this.request<GithubPullRequest[]>(
      `/repos/${owner}/${repo}/pulls`,
      { query: query as Record<string, string | number | boolean | undefined> },
    );
    return data;
  }

  async getPull(params: GetPullParams): Promise<GithubPullRequest> {
    const { data } = await this.request<GithubPullRequest>(
      `/repos/${params.owner}/${params.repo}/pulls/${params.pull_number}`,
    );
    return data;
  }

  async listPullComments(params: ListPullCommentsParams): Promise<GithubComment[]> {
    const { owner, repo, pull_number, ...query } = params;
    const { data } = await this.request<GithubComment[]>(
      `/repos/${owner}/${repo}/pulls/${pull_number}/comments`,
      { query: query as Record<string, string | number | boolean | undefined> },
    );
    return data;
  }

  // --------------------------------------------------------------------------
  // Commits — READ
  // --------------------------------------------------------------------------

  async listCommits(params: ListCommitsParams): Promise<GithubCommit[]> {
    const { owner, repo, ...query } = params;
    const { data } = await this.request<GithubCommit[]>(
      `/repos/${owner}/${repo}/commits`,
      { query: query as Record<string, string | number | boolean | undefined> },
    );
    return data;
  }

  // --------------------------------------------------------------------------
  // Issues — WRITE
  // --------------------------------------------------------------------------

  async createIssue(params: CreateIssueParams): Promise<GithubIssue> {
    const { owner, repo, ...body } = params;
    const { data } = await this.request<GithubIssue>(
      `/repos/${owner}/${repo}/issues`,
      { method: "POST", body },
    );
    return data;
  }

  async updateIssue(params: UpdateIssueParams): Promise<GithubIssue> {
    const { owner, repo, issue_number, ...body } = params;
    const { data } = await this.request<GithubIssue>(
      `/repos/${owner}/${repo}/issues/${issue_number}`,
      { method: "PATCH", body },
    );
    return data;
  }

  async createIssueComment(params: CreateIssueCommentParams): Promise<GithubComment> {
    const { owner, repo, issue_number, body } = params;
    const { data } = await this.request<GithubComment>(
      `/repos/${owner}/${repo}/issues/${issue_number}/comments`,
      { method: "POST", body: { body } },
    );
    return data;
  }

  async addLabels(params: AddLabelsParams): Promise<Array<{ id: number; name: string }>> {
    const { owner, repo, issue_number, labels } = params;
    const { data } = await this.request<Array<{ id: number; name: string }>>(
      `/repos/${owner}/${repo}/issues/${issue_number}/labels`,
      { method: "POST", body: { labels } },
    );
    return data;
  }

  async removeLabel(params: RemoveLabelParams): Promise<void> {
    const { owner, repo, issue_number, name } = params;
    await this.request<void>(
      `/repos/${owner}/${repo}/issues/${issue_number}/labels/${encodeURIComponent(name)}`,
      { method: "DELETE" },
    );
  }

  // --------------------------------------------------------------------------
  // Pull Requests — WRITE
  // --------------------------------------------------------------------------

  async createPull(params: CreatePullParams): Promise<GithubPullRequest> {
    const { owner, repo, ...body } = params;
    const { data } = await this.request<GithubPullRequest>(
      `/repos/${owner}/${repo}/pulls`,
      { method: "POST", body },
    );
    return data;
  }

  async updatePull(params: UpdatePullParams): Promise<GithubPullRequest> {
    const { owner, repo, pull_number, ...body } = params;
    const { data } = await this.request<GithubPullRequest>(
      `/repos/${owner}/${repo}/pulls/${pull_number}`,
      { method: "PATCH", body },
    );
    return data;
  }

  // --------------------------------------------------------------------------
  // Utility
  // --------------------------------------------------------------------------

  /** Masked token for display. */
  getMaskedToken(): string {
    if (this.token.length <= 8) return "***";
    return this.token.slice(0, 4) + "***" + this.token.slice(-4);
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _githubService: GithubService | null = null;

/**
 * Return the process-wide GithubService, constructing it on first use.
 *
 * @throws if no token is available from config or GITHUB_TOKEN env.
 */
export function getGithubClient(): GithubService {
  if (!_githubService) _githubService = new GithubService();
  return _githubService;
}

/** Reset the cached singleton (test-only). */
export function resetGithubClient(): void {
  _githubService = null;
}

// Re-export Pagination type so callers don't need to import from ./types.
export type { PaginationParams };
