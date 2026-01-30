/**
 * Google Docs Writer Agent Worker
 *
 * WRITE-only agent that creates/updates Google Docs.
 * Receives encrypted content from READ agents and executes write operations.
 *
 * SECURITY: This agent has write access but only receives pre-processed,
 * encrypted content. It never processes raw untrusted input directly.
 * This follows the "Rule of Two" separation.
 */

import { generateText, tool } from "ai";
import { z } from "zod";
import { BaseAgentWorker, type TaskResult } from "./base-worker";
import { getMockGDocsService } from "../../mocks/gdocs";
import type { AgentPermission } from "../types";

class GDocsWriterWorker extends BaseAgentWorker {
  protected getExpectedPermission(): AgentPermission {
    return "WRITE";
  }

  protected async processTask(
    taskDescription: string,
    inputContent: string,
    originalRequest: string
  ): Promise<TaskResult> {
    const openai = this.getOpenAI();

    // Track document operations for outcome summary
    let docTitle = "";
    let docOperation = "";

    // Create tools that track metadata for outcome summary
    const trackedTools = {
      createDocument: tool({
        description: "Create a new Google Doc",
        parameters: z.object({
          title: z.string(),
          content: z.string().optional().describe("Content for the document. If not provided, uses the input content from the previous agent."),
        }),
        execute: async ({ title, content }) => {
          const gdocs = getMockGDocsService();
          const docContent = content || inputContent;
          const doc = gdocs.createDocument(title, docContent);
          // Track metadata
          docTitle = title;
          docOperation = "created";
          return { success: true, docId: doc.id, title: doc.title };
        },
      }),

      updateDocument: tool({
        description: "Update an existing document with new content",
        parameters: z.object({
          docId: z.string(),
          content: z.string().optional().describe("New content for the document. If not provided, uses the input content from the previous agent."),
        }),
        execute: async ({ docId, content }) => {
          const gdocs = getMockGDocsService();
          const docContent = content || inputContent;
          const doc = gdocs.updateDocument(docId, docContent);
          if (!doc) {
            return { success: false, error: `Document ${docId} not found` };
          }
          // Track metadata
          docOperation = "updated";
          return { success: true, docId: doc.id };
        },
      }),

      appendToDocument: tool({
        description: "Append content to an existing document",
        parameters: z.object({
          docId: z.string(),
          content: z.string().optional().describe("Content to append. If not provided, uses the input content from the previous agent."),
        }),
        execute: async ({ docId, content }) => {
          const gdocs = getMockGDocsService();
          const docContent = content || inputContent;
          const doc = gdocs.appendToDocument(docId, docContent);
          if (!doc) {
            return { success: false, error: `Document ${docId} not found` };
          }
          // Track metadata
          docOperation = "appended to";
          return { success: true, docId: doc.id };
        },
      }),

      listDocuments: tool({
        description: "List available documents",
        parameters: z.object({}),
        execute: async () => {
          const gdocs = getMockGDocsService();
          return gdocs.listDocuments();
        },
      }),
    };

    const result = await generateText({
      model: openai("gpt-4o-mini"),
      system: `You are a document management assistant. Use the available tools to accomplish the task.

The input content from a previous agent is available to use when creating or updating documents.
If no specific content is provided in the tool parameters, the input content will be used automatically.`,
      prompt: `Task: ${taskDescription}\nContext: ${originalRequest}\n\nInput content available:\n${inputContent.slice(0, 500)}${inputContent.length > 500 ? "..." : ""}`,
      tools: trackedTools,
      maxSteps: 5,
    });

    // Build outcome summary based on what was done
    let outcomeSummary = "";
    if (docOperation && docTitle) {
      outcomeSummary = `${docOperation.charAt(0).toUpperCase() + docOperation.slice(1)} document "${docTitle}"`;
    } else if (docOperation) {
      outcomeSummary = `Document ${docOperation} successfully`;
    } else {
      outcomeSummary = "Document operation completed";
    }

    return {
      content: result.text,
      outcomeSummary,
    };
  }
}

// Initialize the worker
new GDocsWriterWorker();
