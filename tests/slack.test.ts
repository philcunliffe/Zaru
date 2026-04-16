/**
 * Slack Service Tests
 *
 * Tests for the Slack Web API client.
 * Uses mocked fetch to test API call construction and response parsing.
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { SlackService, resetSlackService } from "../src/services/slack";

const TEST_TOKEN = "xoxb-test-token-12345";

// Store original fetch
const originalFetch = globalThis.fetch;

/**
 * Create a mock fetch that returns a Slack API response
 */
function mockSlackApi(responseBody: unknown, httpStatus = 200) {
  globalThis.fetch = mock(async (_url: string | URL | Request, _init?: RequestInit) => {
    return new Response(JSON.stringify(responseBody), {
      status: httpStatus,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

/**
 * Create a mock fetch that captures the request for assertion
 */
function mockSlackApiCapture(responseBody: unknown) {
  const calls: Array<{ url: string; init: RequestInit }> = [];

  globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init || {} });
    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  return calls;
}

describe("SlackService", () => {
  let slack: SlackService;

  beforeEach(() => {
    resetSlackService();
    slack = new SlackService({ token: TEST_TOKEN });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ==========================================================================
  // Construction & Configuration
  // ==========================================================================

  describe("construction", () => {
    test("should construct with a valid xoxb token", () => {
      const service = new SlackService({ token: "xoxb-valid-token" });
      expect(service).toBeInstanceOf(SlackService);
    });

    test("should reject missing token", () => {
      expect(() => new SlackService({ token: "" })).toThrow(
        "Slack bot token not configured"
      );
    });

    test("should reject non-xoxb token", () => {
      expect(() => new SlackService({ token: "xoxp-user-token" })).toThrow(
        "Invalid Slack token format"
      );
    });

    test("should mask token for display", () => {
      const service = new SlackService({ token: "xoxb-1234567890-abcdef" });
      const masked = service.getMaskedToken();
      expect(masked).toStartWith("xoxb-");
      expect(masked).toContain("***");
      expect(masked).not.toContain("1234567890");
    });
  });

  // ==========================================================================
  // HTTP Layer
  // ==========================================================================

  describe("HTTP layer", () => {
    test("should send Authorization header with Bearer token", async () => {
      const calls = mockSlackApiCapture({ ok: true, url: "", team: "", user: "", team_id: "", user_id: "" });

      await slack.authTest();

      expect(calls).toHaveLength(1);
      expect(calls[0].init.headers).toEqual(
        expect.objectContaining({
          Authorization: `Bearer ${TEST_TOKEN}`,
        })
      );
    });

    test("should POST to correct API endpoint", async () => {
      const calls = mockSlackApiCapture({ ok: true, url: "", team: "", user: "", team_id: "", user_id: "" });

      await slack.authTest();

      expect(calls[0].url).toBe("https://slack.com/api/auth.test");
    });

    test("should send JSON content type", async () => {
      const calls = mockSlackApiCapture({ ok: true, url: "", team: "", user: "", team_id: "", user_id: "" });

      await slack.authTest();

      expect(calls[0].init.headers).toEqual(
        expect.objectContaining({
          "Content-Type": "application/json; charset=utf-8",
        })
      );
    });

    test("should throw on HTTP error", async () => {
      mockSlackApi({}, 500);

      await expect(slack.authTest()).rejects.toThrow("Slack API HTTP error: 500");
    });

    test("should throw on Slack API error response", async () => {
      mockSlackApi({ ok: false, error: "invalid_auth" });

      await expect(slack.authTest()).rejects.toThrow("Slack API error: invalid_auth");
    });
  });

  // ==========================================================================
  // Auth
  // ==========================================================================

  describe("authTest", () => {
    test("should return auth info", async () => {
      mockSlackApi({
        ok: true,
        url: "https://myteam.slack.com/",
        team: "My Team",
        user: "bot",
        team_id: "T12345",
        user_id: "U12345",
        bot_id: "B12345",
      });

      const result = await slack.authTest();

      expect(result.ok).toBe(true);
      expect(result.team).toBe("My Team");
      expect(result.user_id).toBe("U12345");
      expect(result.bot_id).toBe("B12345");
    });
  });

  // ==========================================================================
  // READ Operations
  // ==========================================================================

  describe("listChannels", () => {
    test("should list channels with defaults", async () => {
      const calls = mockSlackApiCapture({
        ok: true,
        channels: [
          { id: "C001", name: "general", is_channel: true, num_members: 50 },
          { id: "C002", name: "random", is_channel: true, num_members: 45 },
        ],
      });

      const result = await slack.listChannels();

      expect(result.channels).toHaveLength(2);
      expect(result.channels[0].id).toBe("C001");
      expect(result.channels[0].name).toBe("general");

      // Verify default params
      const body = JSON.parse(calls[0].init.body as string);
      expect(body.types).toBe("public_channel,private_channel");
      expect(body.exclude_archived).toBe(true);
      expect(body.limit).toBe(100);
    });

    test("should pass pagination cursor", async () => {
      const calls = mockSlackApiCapture({
        ok: true,
        channels: [],
        response_metadata: { next_cursor: "" },
      });

      await slack.listChannels({ cursor: "dGVhbQ==" });

      const body = JSON.parse(calls[0].init.body as string);
      expect(body.cursor).toBe("dGVhbQ==");
    });

    test("should pass custom types filter", async () => {
      const calls = mockSlackApiCapture({ ok: true, channels: [] });

      await slack.listChannels({ types: "public_channel" });

      const body = JSON.parse(calls[0].init.body as string);
      expect(body.types).toBe("public_channel");
    });
  });

  describe("getHistory", () => {
    test("should fetch channel history", async () => {
      const calls = mockSlackApiCapture({
        ok: true,
        messages: [
          { type: "message", ts: "1234567890.123456", user: "U001", text: "Hello" },
          { type: "message", ts: "1234567891.123456", user: "U002", text: "Hi there" },
        ],
        has_more: false,
      });

      const result = await slack.getHistory({ channel: "C001" });

      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].text).toBe("Hello");
      expect(result.has_more).toBe(false);

      const body = JSON.parse(calls[0].init.body as string);
      expect(body.channel).toBe("C001");
      expect(body.limit).toBe(20);
    });

    test("should pass time range filters", async () => {
      const calls = mockSlackApiCapture({
        ok: true,
        messages: [],
        has_more: false,
      });

      await slack.getHistory({
        channel: "C001",
        oldest: "1234567890.000000",
        latest: "1234567899.000000",
        inclusive: true,
      });

      const body = JSON.parse(calls[0].init.body as string);
      expect(body.oldest).toBe("1234567890.000000");
      expect(body.latest).toBe("1234567899.000000");
      expect(body.inclusive).toBe(true);
    });
  });

  describe("getReplies", () => {
    test("should fetch thread replies", async () => {
      const calls = mockSlackApiCapture({
        ok: true,
        messages: [
          { type: "message", ts: "1234567890.123456", user: "U001", text: "Thread parent" },
          { type: "message", ts: "1234567891.123456", user: "U002", text: "Reply 1", thread_ts: "1234567890.123456" },
        ],
        has_more: false,
      });

      const result = await slack.getReplies({
        channel: "C001",
        ts: "1234567890.123456",
      });

      expect(result.messages).toHaveLength(2);
      expect(result.messages[1].text).toBe("Reply 1");

      const body = JSON.parse(calls[0].init.body as string);
      expect(body.channel).toBe("C001");
      expect(body.ts).toBe("1234567890.123456");
    });
  });

  describe("searchMessages", () => {
    test("should search messages", async () => {
      const calls = mockSlackApiCapture({
        ok: true,
        messages: {
          total: 1,
          matches: [
            {
              iid: "1",
              channel: { id: "C001", name: "general" },
              type: "message",
              user: "U001",
              username: "alice",
              ts: "1234567890.123456",
              text: "deploy the thing",
              permalink: "https://team.slack.com/archives/C001/p1234567890123456",
            },
          ],
          paging: { count: 20, total: 1, page: 1, pages: 1 },
        },
      });

      const result = await slack.searchMessages({ query: "deploy" });

      expect(result.messages.total).toBe(1);
      expect(result.messages.matches[0].text).toBe("deploy the thing");

      const body = JSON.parse(calls[0].init.body as string);
      expect(body.query).toBe("deploy");
      expect(body.count).toBe(20);
    });

    test("should pass sort options", async () => {
      const calls = mockSlackApiCapture({
        ok: true,
        messages: { total: 0, matches: [], paging: { count: 20, total: 0, page: 1, pages: 0 } },
      });

      await slack.searchMessages({
        query: "test",
        sort: "timestamp",
        sort_dir: "desc",
        count: 5,
      });

      const body = JSON.parse(calls[0].init.body as string);
      expect(body.sort).toBe("timestamp");
      expect(body.sort_dir).toBe("desc");
      expect(body.count).toBe(5);
    });
  });

  // ==========================================================================
  // WRITE Operations
  // ==========================================================================

  describe("postMessage", () => {
    test("should post a message to a channel", async () => {
      const calls = mockSlackApiCapture({
        ok: true,
        channel: "C001",
        ts: "1234567890.123456",
        message: { type: "message", ts: "1234567890.123456", text: "Hello world" },
      });

      const result = await slack.postMessage({
        channel: "C001",
        text: "Hello world",
      });

      expect(result.channel).toBe("C001");
      expect(result.ts).toBe("1234567890.123456");

      const body = JSON.parse(calls[0].init.body as string);
      expect(body.channel).toBe("C001");
      expect(body.text).toBe("Hello world");
      expect(body.thread_ts).toBeUndefined();
    });

    test("should reply to a thread", async () => {
      const calls = mockSlackApiCapture({
        ok: true,
        channel: "C001",
        ts: "1234567891.123456",
        message: { type: "message", ts: "1234567891.123456", text: "Thread reply" },
      });

      await slack.postMessage({
        channel: "C001",
        text: "Thread reply",
        thread_ts: "1234567890.123456",
      });

      const body = JSON.parse(calls[0].init.body as string);
      expect(body.thread_ts).toBe("1234567890.123456");
    });

    test("should broadcast a thread reply", async () => {
      const calls = mockSlackApiCapture({
        ok: true,
        channel: "C001",
        ts: "1234567891.123456",
        message: { type: "message", ts: "1234567891.123456", text: "Also to channel" },
      });

      await slack.postMessage({
        channel: "C001",
        text: "Also to channel",
        thread_ts: "1234567890.123456",
        reply_broadcast: true,
      });

      const body = JSON.parse(calls[0].init.body as string);
      expect(body.reply_broadcast).toBe(true);
    });
  });

  describe("addReaction", () => {
    test("should add a reaction to a message", async () => {
      const calls = mockSlackApiCapture({ ok: true });

      await slack.addReaction({
        channel: "C001",
        timestamp: "1234567890.123456",
        name: "thumbsup",
      });

      expect(calls[0].url).toBe("https://slack.com/api/reactions.add");

      const body = JSON.parse(calls[0].init.body as string);
      expect(body.channel).toBe("C001");
      expect(body.timestamp).toBe("1234567890.123456");
      expect(body.name).toBe("thumbsup");
    });
  });

  describe("setTopic", () => {
    test("should set channel topic", async () => {
      const calls = mockSlackApiCapture({
        ok: true,
        topic: "New topic",
      });

      const result = await slack.setTopic({
        channel: "C001",
        topic: "New topic",
      });

      expect(result.topic).toBe("New topic");

      const body = JSON.parse(calls[0].init.body as string);
      expect(body.channel).toBe("C001");
      expect(body.topic).toBe("New topic");
    });
  });

  // ==========================================================================
  // Optional params omission
  // ==========================================================================

  describe("parameter omission", () => {
    test("should omit undefined optional params from request body", async () => {
      const calls = mockSlackApiCapture({
        ok: true,
        messages: [],
        has_more: false,
      });

      await slack.getHistory({ channel: "C001" });

      const body = JSON.parse(calls[0].init.body as string);
      expect(body).not.toHaveProperty("cursor");
      expect(body).not.toHaveProperty("oldest");
      expect(body).not.toHaveProperty("latest");
      expect(body).not.toHaveProperty("inclusive");
    });
  });
});
