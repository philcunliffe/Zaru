/**
 * Email Writer Agent Worker
 *
 * WRITE agent that sends emails via Gmail.
 * Receives encrypted content from READ agents and executes send operations.
 *
 * SECURITY: This agent has write access but only receives pre-processed,
 * encrypted content. It never processes raw untrusted input directly.
 * This follows the "Rule of Two" separation.
 */

import { generateText, tool } from "ai";
import { z } from "zod";
import { BaseAgentWorker, type TaskResult } from "./base-worker";
import {
  GmailService,
  isGmailConfigured,
  type SendEmailResult,
} from "../../services/gmail";
import type { AgentPermission } from "../types";

class EmailWriterWorker extends BaseAgentWorker {
  private gmailService: GmailService | null = null;

  constructor() {
    super();
  }

  /**
   * Initialize Gmail service lazily (after config is loaded)
   */
  private getGmailService(): GmailService {
    if (!this.gmailService) {
      if (!isGmailConfigured()) {
        throw new Error(
          "Gmail not configured. Please add gmail.account to ~/.zaru/config.json"
        );
      }
      this.gmailService = new GmailService();
    }
    return this.gmailService;
  }

  protected getExpectedPermission(): AgentPermission {
    return "WRITE";
  }

  protected async processTask(
    taskDescription: string,
    inputContent: string,
    originalRequest: string
  ): Promise<TaskResult> {
    const openai = this.getOpenAI();
    const gmail = this.getGmailService();

    // Track email operations for outcome summary
    let emailsSent = 0;
    let emailsReplied = 0;
    let lastRecipient = "";
    let lastSubject = "";

    // Create tools for Gmail send operations
    const trackedTools = {
      sendEmail: tool({
        description: "Send a new email",
        parameters: z.object({
          to: z.array(z.string()).describe("Recipient email addresses"),
          cc: z.array(z.string()).optional().describe("CC recipients"),
          bcc: z.array(z.string()).optional().describe("BCC recipients"),
          subject: z.string().describe("Email subject"),
          body: z
            .string()
            .optional()
            .describe("Email body. If not provided, uses input content from previous agent."),
        }),
        execute: async ({ to, cc, bcc, subject, body }) => {
          // Validate tool call against intent
          this.validateToolCall("sendEmail", { to, cc, bcc, subject });

          const result = await gmail.sendEmail({
            to,
            cc,
            bcc,
            subject,
            body: body || inputContent,
          });

          if (result.success) {
            emailsSent++;
            lastRecipient = to[0];
            lastSubject = subject;
          }

          return result;
        },
      }),

      replyToEmail: tool({
        description: "Reply to an existing email by message ID",
        parameters: z.object({
          messageId: z.string().describe("Gmail message ID to reply to"),
          body: z
            .string()
            .optional()
            .describe("Reply body. If not provided, uses input content from previous agent."),
          replyAll: z
            .boolean()
            .optional()
            .describe("Reply to all recipients (default: false)"),
        }),
        execute: async ({ messageId, body, replyAll }) => {
          // Validate tool call against intent
          this.validateToolCall("replyToEmail", { messageId, replyAll });

          const result = await gmail.replyToEmail(
            messageId,
            body || inputContent,
            replyAll || false
          );

          if (result.success) {
            emailsReplied++;
          }

          return result;
        },
      }),

      forwardEmail: tool({
        description: "Forward an email to new recipients",
        parameters: z.object({
          messageId: z.string().describe("Gmail message ID to forward"),
          to: z.array(z.string()).describe("Recipients to forward to"),
          additionalComment: z
            .string()
            .optional()
            .describe("Optional comment to add before the forwarded content"),
        }),
        execute: async ({ messageId, to, additionalComment }) => {
          // Validate tool call against intent
          this.validateToolCall("forwardEmail", { messageId, to });

          // First get the original message
          const original = await gmail.getMessage(messageId);

          // Build forwarded content
          const forwardedContent = [
            additionalComment || "",
            "",
            "---------- Forwarded message ----------",
            `From: ${original.from}`,
            `Date: ${original.date.toISOString()}`,
            `Subject: ${original.subject}`,
            `To: ${original.to.join(", ")}`,
            "",
            original.body,
          ]
            .filter(Boolean)
            .join("\n");

          const result = await gmail.sendEmail({
            to,
            subject: `Fwd: ${original.subject}`,
            body: forwardedContent,
          });

          if (result.success) {
            emailsSent++;
            lastRecipient = to[0];
            lastSubject = `Fwd: ${original.subject}`;
          }

          return result;
        },
      }),
    };

    const result = await generateText({
      model: openai("gpt-4o-mini"),
      system: `You are an email sending assistant. Use the available tools to accomplish the task.

Available tools:
- sendEmail: Send a new email
- replyToEmail: Reply to an existing email by message ID
- forwardEmail: Forward an email to new recipients

The input content from a previous agent is available to use as the email body.
If no specific body is provided in the tool parameters, the input content will be used automatically.

IMPORTANT: Only send emails that are explicitly requested. Never send unsolicited emails.`,
      prompt: `Task: ${taskDescription}\nContext: ${originalRequest}\n\nInput content available:\n${inputContent.slice(0, 1000)}${inputContent.length > 1000 ? "..." : ""}`,
      tools: trackedTools,
      maxSteps: 5,
    });

    // Build outcome summary based on what was done
    let outcomeSummary = "";
    if (emailsSent > 0 && emailsReplied > 0) {
      outcomeSummary = `Sent ${emailsSent} email${emailsSent !== 1 ? "s" : ""} and replied to ${emailsReplied}`;
    } else if (emailsSent > 0) {
      outcomeSummary = `Sent email to ${lastRecipient}`;
      if (lastSubject) {
        outcomeSummary += `: "${lastSubject.slice(0, 30)}${lastSubject.length > 30 ? "..." : ""}"`;
      }
    } else if (emailsReplied > 0) {
      outcomeSummary = `Replied to ${emailsReplied} email${emailsReplied !== 1 ? "s" : ""}`;
    } else {
      outcomeSummary = "Email operation completed";
    }

    return {
      content: result.text,
      outcomeSummary,
    };
  }
}

// Initialize the worker
new EmailWriterWorker();
