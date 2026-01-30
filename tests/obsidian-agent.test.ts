/**
 * Obsidian Agent Worker Tests
 *
 * Tests for the Obsidian agent worker security and validation.
 * These tests verify that:
 * 1. The worker has correct permission type (READ_WRITE)
 * 2. Tool categories match the security controller configuration
 * 3. Security validation works correctly with obsidian tools
 */

import { describe, it, expect, beforeEach } from "bun:test";
import {
  ReadWriteSecurityController,
} from "../src/agents/read-write-security";
import type {
  IntentContext,
  UserIntent,
  AgentSubIntent,
} from "../src/agents/types";

// Mock OpenAI provider for testing
const createMockOpenAI = () => {
  return (modelName: string) => ({
    modelId: modelName,
  });
};

// Create mock intent context for Obsidian operations
function createObsidianIntentContext(overrides?: Partial<UserIntent>): IntentContext {
  const intent: UserIntent = {
    id: "test-obsidian-intent",
    originalMessage: "Search my notes for project ideas",
    messageHash: "hash123",
    extractedAt: Date.now(),
    category: "read_only",
    confidence: "high",
    summary: "Search notes in Obsidian vault",
    permissions: {
      allowedDataSources: ["obsidian-vault"],
      allowedWriteDestinations: [],
      explicitlyAllowed: {
        sendEmail: false,
        createDocument: false,
        submitForm: false,
        makePayment: false,
        deleteContent: false,
        shareContent: false,
      },
      explicitlyForbidden: [],
    },
    goals: ["search notes"],
    constraints: [],
    entities: [],
    scope: {},
    canExtractIntent: true,
    ...overrides,
  };

  return {
    intent,
    taskPermissions: {
      readsFrom: ["obsidian-vault"],
      writesTo: [],
      operations: ["searchNotes", "readNote"],
    },
    strictness: "moderate",
  };
}

// Create mock sub-intent for Obsidian testing
function createObsidianSubIntent(overrides?: Partial<AgentSubIntent>): AgentSubIntent {
  return {
    id: "test-obsidian-sub-intent",
    taskDescription: "Search notes for project ideas",
    summary: "Search vault for notes containing project ideas",
    expectedToolCategories: ["read"],
    expectedTools: ["searchNotes", "searchNoteContent", "readNote"],
    forbiddenOperations: ["deleteNote", "createNote", "updateNote"],
    toolLimits: {
      searchNotes: 5,
      readNote: 10,
    },
    scope: {
      allowedPaths: ["projects/", "ideas/"],
    },
    extractedAt: Date.now(),
    ...overrides,
  };
}

describe("Obsidian Agent Security Controller", () => {
  describe("tool categories", () => {
    it("should use correct default tool categories for obsidian agent", () => {
      const controller = new ReadWriteSecurityController({
        orchestratorIntent: createObsidianIntentContext(),
        llmProvider: createMockOpenAI() as any,
        agentType: "obsidian",
        strictness: "moderate",
      });

      // Access the internal tool categories (for testing)
      const toolCategories = (controller as any).toolCategories;

      // Verify obsidian-specific tool categories from read-write-security.ts
      expect(toolCategories.read).toContain("readNote");
      expect(toolCategories.read).toContain("searchNotes");
      expect(toolCategories.read).toContain("getNotesInFolder");
      expect(toolCategories.read).toContain("listVaults");

      expect(toolCategories.write).toContain("appendToNote");
      expect(toolCategories.write).toContain("updateNote");
      expect(toolCategories.write).toContain("createNote");
      expect(toolCategories.write).toContain("deleteNote");

      expect(toolCategories.navigate).toContain("openVault");
      expect(toolCategories.navigate).toContain("changeFolder");
      expect(toolCategories.navigate).toContain("openNote");

      expect(toolCategories.input).toContain("requestUserInput");
    });
  });

  describe("read-only operations", () => {
    it("should allow read operations for read-only intent", () => {
      const controller = new ReadWriteSecurityController({
        orchestratorIntent: createObsidianIntentContext(),
        llmProvider: createMockOpenAI() as any,
        agentType: "obsidian",
        strictness: "moderate",
      });

      (controller as any).subIntent = createObsidianSubIntent();

      // searchNotes should be allowed
      const searchResult = controller.validateToolCall("searchNotes", { query: "project" });
      expect(searchResult.allowed).toBe(true);

      // readNote should be allowed
      const readResult = controller.validateToolCall("readNote", { path: "projects/idea.md" });
      expect(readResult.allowed).toBe(true);
    });

    it("should block write operations for read-only intent", () => {
      const controller = new ReadWriteSecurityController({
        orchestratorIntent: createObsidianIntentContext({
          category: "read_only",
        }),
        llmProvider: createMockOpenAI() as any,
        agentType: "obsidian",
        strictness: "moderate",
      });

      (controller as any).subIntent = createObsidianSubIntent({
        expectedToolCategories: ["read"], // Only read allowed
        forbiddenOperations: ["deleteNote", "createNote", "updateNote", "appendToNote"],
      });

      // createNote should be blocked (forbidden + category mismatch)
      const createResult = controller.validateToolCall("createNote", {
        path: "new-note.md",
        content: "test",
      });
      expect(createResult.allowed).toBe(false);

      // deleteNote should be blocked
      const deleteResult = controller.validateToolCall("deleteNote", { path: "note.md" });
      expect(deleteResult.allowed).toBe(false);
    });
  });

  describe("write operations", () => {
    it("should allow write operations when explicitly permitted", () => {
      // Use null orchestrator intent to test sub-intent directly
      const controller = new ReadWriteSecurityController({
        orchestratorIntent: null,
        llmProvider: createMockOpenAI() as any,
        agentType: "obsidian",
        strictness: "moderate",
      });

      (controller as any).subIntent = createObsidianSubIntent({
        expectedToolCategories: ["read", "write"],
        expectedTools: ["searchNotes", "createNote", "appendToNote"],
        forbiddenOperations: ["deleteNote"], // Only delete forbidden
        scope: {}, // Clear path restrictions for this test
      });

      // createNote should be allowed
      const createResult = controller.validateToolCall("createNote", {
        path: "new-note.md",
        content: "test",
      });
      expect(createResult.allowed).toBe(true);

      // appendToNote should be allowed
      const appendResult = controller.validateToolCall("appendToNote", {
        path: "existing.md",
        content: "appended",
      });
      expect(appendResult.allowed).toBe(true);
    });

    it("should block delete even when writes are allowed if explicitly forbidden", () => {
      // Use null orchestrator intent to test sub-intent directly
      const controller = new ReadWriteSecurityController({
        orchestratorIntent: null,
        llmProvider: createMockOpenAI() as any,
        agentType: "obsidian",
        strictness: "moderate",
      });

      (controller as any).subIntent = createObsidianSubIntent({
        expectedToolCategories: ["read", "write"],
        forbiddenOperations: ["deleteNote"], // Explicitly forbidden
        scope: {}, // Clear path restrictions for this test
      });

      const deleteResult = controller.validateToolCall("deleteNote", { path: "note.md" });
      expect(deleteResult.allowed).toBe(false);
      expect(deleteResult.violations.some((v) => v.code === "FORBIDDEN_OPERATION")).toBe(true);
    });
  });

  describe("tool limits", () => {
    it("should enforce tool call limits", () => {
      // Use null orchestrator intent to test sub-intent directly
      const controller = new ReadWriteSecurityController({
        orchestratorIntent: null,
        llmProvider: createMockOpenAI() as any,
        agentType: "obsidian",
        strictness: "moderate",
      });

      (controller as any).subIntent = createObsidianSubIntent({
        expectedToolCategories: ["read", "write", "navigate", "input"],
        toolLimits: { readNote: 2 },
        scope: {}, // Clear path restrictions for this test
      });

      // First two calls should succeed
      expect(controller.validateToolCall("readNote", { path: "note1.md" }).allowed).toBe(true);
      expect(controller.validateToolCall("readNote", { path: "note2.md" }).allowed).toBe(true);

      // Third call should be blocked
      const result = controller.validateToolCall("readNote", { path: "note3.md" });
      expect(result.allowed).toBe(false);
      expect(result.violations.some((v) => v.code === "SCOPE_VIOLATION")).toBe(true);
    });
  });

  describe("path constraints", () => {
    it("should enforce allowed paths for file operations", () => {
      const controller = new ReadWriteSecurityController({
        orchestratorIntent: createObsidianIntentContext(),
        llmProvider: createMockOpenAI() as any,
        agentType: "obsidian",
        strictness: "moderate",
      });

      (controller as any).subIntent = createObsidianSubIntent({
        scope: {
          allowedPaths: ["projects/", "ideas/"],
        },
      });

      // Allowed path
      const allowedResult = controller.validateToolCall("readNote", {
        path: "projects/my-project.md",
      });
      expect(allowedResult.allowed).toBe(true);

      // Blocked path
      const blockedResult = controller.validateToolCall("readNote", {
        path: "private/secrets.md",
      });
      expect(blockedResult.allowed).toBe(false);
      expect(blockedResult.violations.some((v) => v.code === "SCOPE_VIOLATION")).toBe(true);
    });
  });

  describe("security prompt", () => {
    it("should generate security prompt with obsidian context", () => {
      const controller = new ReadWriteSecurityController({
        orchestratorIntent: createObsidianIntentContext(),
        llmProvider: createMockOpenAI() as any,
        agentType: "obsidian",
      });

      (controller as any).subIntent = createObsidianSubIntent({
        summary: "Search notes for project ideas",
        forbiddenOperations: ["deleteNote"],
      });

      const prompt = controller.getSecurityPrompt();

      expect(prompt).toContain("SECURITY DIRECTIVES");
      expect(prompt).toContain("Search notes for project ideas");
      expect(prompt).toContain("deleteNote");
    });
  });

  describe("tool call tracking", () => {
    it("should track tool call counts", () => {
      const controller = new ReadWriteSecurityController({
        orchestratorIntent: createObsidianIntentContext(),
        llmProvider: createMockOpenAI() as any,
        agentType: "obsidian",
      });

      (controller as any).subIntent = createObsidianSubIntent();

      controller.validateToolCall("searchNotes", { query: "test" });
      controller.validateToolCall("searchNotes", { query: "test2" });
      controller.validateToolCall("readNote", { path: "note.md" });

      const counts = controller.getToolCallCounts();

      expect(counts.searchNotes).toBe(2);
      expect(counts.readNote).toBe(1);
    });
  });
});
