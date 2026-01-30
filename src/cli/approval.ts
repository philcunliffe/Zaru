/**
 * CLI Approval Prompts
 *
 * Terminal-based user approval interface for agent actions.
 */

import * as readline from "readline";
import * as tty from "tty";
import type {
  ApprovalRequest,
  ApprovalResponse,
  DecryptedContentResponse,
  EscalationApprovalRequest,
  EscalationApprovalResponse,
} from "../agents/types";
import { getLogger } from "../services/logger";

/**
 * Check if stdin is interactive (a TTY)
 */
function isInteractive(): boolean {
  return tty.isatty(process.stdin.fd);
}

/**
 * Create a readline interface for user input
 */
function createReadlineInterface(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

/**
 * Prompt user for approval of an action
 */
export async function promptApproval(
  request: ApprovalRequest
): Promise<ApprovalResponse> {
  const rl = createReadlineInterface();

  console.log("\n┌─────────────────────────────────────────────────────────────┐");
  console.log("│                   APPROVAL REQUIRED                         │");
  console.log("├─────────────────────────────────────────────────────────────┤");
  console.log(`│ From: ${request.sourceAgentId.padEnd(52)}│`);
  console.log(`│ To: ${request.targetAgentId.padEnd(54)}│`);
  console.log("├─────────────────────────────────────────────────────────────┤");
  console.log("│ Description:                                                │");
  console.log(`│ ${request.description.slice(0, 58).padEnd(58)}│`);
  console.log("├─────────────────────────────────────────────────────────────┤");
  console.log("│ Content Preview:                                            │");
  console.log("└─────────────────────────────────────────────────────────────┘");
  console.log(request.contentPreview.slice(0, 500));
  if (request.contentPreview.length > 500) {
    console.log("... (truncated)");
  }
  console.log("─────────────────────────────────────────────────────────────────\n");

  return new Promise((resolve) => {
    const askQuestion = () => {
      rl.question("Approve this action? [y/n/e(dit)]: ", (answer) => {
        const normalized = answer.trim().toLowerCase();

        if (normalized === "y" || normalized === "yes") {
          rl.close();
          getLogger().logPermission({
            type: "user_approval",
            source: "approval",
            allowed: true,
            severity: "info",
            details: {
              requestId: request.id,
              action: "approved",
              sourceAgentId: request.sourceAgentId,
              targetAgentId: request.targetAgentId,
              description: request.description,
            },
          });
          resolve({
            requestId: request.id,
            approved: true,
            respondedAt: Date.now(),
          });
        } else if (normalized === "n" || normalized === "no") {
          rl.close();
          getLogger().logPermission({
            type: "user_approval",
            source: "approval",
            allowed: false,
            severity: "info",
            details: {
              requestId: request.id,
              action: "denied",
              sourceAgentId: request.sourceAgentId,
              targetAgentId: request.targetAgentId,
              description: request.description,
            },
          });
          resolve({
            requestId: request.id,
            approved: false,
            respondedAt: Date.now(),
          });
        } else if (normalized === "e" || normalized === "edit") {
          // Allow user to edit the content
          console.log("\nEnter modified content (end with empty line):");
          let modifiedContent = "";
          const collectLines = () => {
            rl.question("", (line) => {
              if (line === "") {
                rl.close();
                getLogger().logPermission({
                  type: "user_approval",
                  source: "approval",
                  allowed: true,
                  severity: "info",
                  details: {
                    requestId: request.id,
                    action: "approved_with_edits",
                    sourceAgentId: request.sourceAgentId,
                    targetAgentId: request.targetAgentId,
                    description: request.description,
                    hasModifiedContent: true,
                  },
                });
                resolve({
                  requestId: request.id,
                  approved: true,
                  modifiedContent,
                  respondedAt: Date.now(),
                });
              } else {
                modifiedContent += (modifiedContent ? "\n" : "") + line;
                collectLines();
              }
            });
          };
          collectLines();
        } else {
          console.log("Please enter 'y' (yes), 'n' (no), or 'e' (edit)");
          askQuestion();
        }
      });
    };

    askQuestion();
  });
}

/**
 * Simple yes/no confirmation prompt
 */
export async function confirm(message: string): Promise<boolean> {
  const rl = createReadlineInterface();

  return new Promise((resolve) => {
    const askQuestion = () => {
      rl.question(`${message} [y/n]: `, (answer) => {
        const normalized = answer.trim().toLowerCase();

        if (normalized === "y" || normalized === "yes") {
          rl.close();
          resolve(true);
        } else if (normalized === "n" || normalized === "no") {
          rl.close();
          resolve(false);
        } else {
          console.log("Please enter 'y' (yes) or 'n' (no)");
          askQuestion();
        }
      });
    };

    askQuestion();
  });
}

// Singleton progress manager - ensures only one spinner at a time
let activeProgress: { stop: () => void; message: string } | null = null;

/**
 * Display a simple progress indicator
 *
 * Uses a singleton pattern to ensure only one spinner runs at a time,
 * preventing flickering when multiple spinners are started simultaneously.
 */
export function showProgress(message: string): () => void {
  // Stop any existing spinner first
  if (activeProgress) {
    activeProgress.stop();
  }

  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let frameIndex = 0;
  let running = true;

  const interval = setInterval(() => {
    if (running) {
      process.stdout.write(`\r${frames[frameIndex]} ${message}`);
      frameIndex = (frameIndex + 1) % frames.length;
    }
  }, 80);

  const stop = () => {
    if (!running) return; // Already stopped
    running = false;
    clearInterval(interval);
    // \x1b[2K clears entire line, \r moves cursor to start
    process.stdout.write("\x1b[2K\r");
    if (activeProgress?.stop === stop) {
      activeProgress = null;
    }
  };

  activeProgress = { stop, message };
  return stop;
}

/**
 * Display a success message
 */
export function showSuccess(message: string): void {
  console.log(`\x1b[32m✓\x1b[0m ${message}`);
}

/**
 * Display an error message
 */
export function showError(message: string): void {
  console.log(`\x1b[31m✗\x1b[0m ${message}`);
}

/**
 * Display an info message
 */
export function showInfo(message: string): void {
  console.log(`\x1b[34mℹ\x1b[0m ${message}`);
}

/**
 * Display a warning message
 */
export function showWarning(message: string): void {
  console.log(`\x1b[33m⚠\x1b[0m ${message}`);
}

/**
 * Prompt user for escalation approval from a sub-agent
 *
 * Displays the agent's request and lets user:
 * - [a] Approve - Forward to orchestrator
 * - [d] Deny - Reject request
 * - [r] Respond - Provide the answer directly
 *
 * In non-interactive mode (piped stdin), auto-denies with a message.
 */
export async function promptEscalationApproval(
  request: EscalationApprovalRequest
): Promise<EscalationApprovalResponse> {
  // Handle non-interactive mode (piped stdin)
  if (!isInteractive()) {
    console.log("\n[Non-interactive mode] Auto-denying escalation from " + request.sourceAgentName);
    getLogger().logPermission({
      type: "escalation_response",
      source: "approval",
      allowed: false,
      severity: "warn",
      details: {
        requestId: request.id,
        outcome: "deny",
        sourceAgentName: request.sourceAgentName,
        escalationReason: request.escalation.reason,
        requestText: request.escalation.requestText,
        denialReason: "Non-interactive mode - stdin is not a TTY",
      },
    });
    return {
      requestId: request.id,
      outcome: "deny",
      denialReason: "Non-interactive mode - stdin is not a TTY",
      respondedAt: Date.now(),
    };
  }

  const rl = createReadlineInterface();

  // Truncate or pad strings for fixed-width display
  const pad = (str: string, len: number) => str.slice(0, len).padEnd(len);
  const wrapText = (text: string, maxLen: number): string[] => {
    const words = text.split(" ");
    const lines: string[] = [];
    let current = "";
    for (const word of words) {
      if ((current + " " + word).trim().length > maxLen) {
        if (current) lines.push(current);
        current = word;
      } else {
        current = current ? current + " " + word : word;
      }
    }
    if (current) lines.push(current);
    return lines;
  };

  console.log("\n\x1b[1m┌─────────────────────────────────────────────────────────────┐\x1b[0m");
  console.log("\x1b[1m│                    SUB-AGENT REQUEST                         │\x1b[0m");
  console.log("\x1b[1m├─────────────────────────────────────────────────────────────┤\x1b[0m");
  console.log(`\x1b[1m│\x1b[0m From: \x1b[36m${pad(request.sourceAgentName, 52)}\x1b[0m\x1b[1m│\x1b[0m`);
  console.log("\x1b[1m├─────────────────────────────────────────────────────────────┤\x1b[0m");
  console.log("\x1b[1m│\x1b[0m Context:                                                    \x1b[1m│\x1b[0m");

  // Wrap reason text
  const reasonLines = wrapText(request.escalation.reason, 57);
  for (const line of reasonLines.slice(0, 3)) {
    console.log(`\x1b[1m│\x1b[0m  \x1b[90m${pad(line, 57)}\x1b[0m\x1b[1m│\x1b[0m`);
  }

  console.log("\x1b[1m├─────────────────────────────────────────────────────────────┤\x1b[0m");
  console.log("\x1b[1m│\x1b[0m Agent wants to send this message:                           \x1b[1m│\x1b[0m");
  console.log("\x1b[1m└─────────────────────────────────────────────────────────────┘\x1b[0m");

  // Display the request text prominently (what the user is approving)
  console.log("");
  const requestLines = wrapText(request.escalation.requestText, 60);
  for (const line of requestLines) {
    console.log(`  \x1b[33m"${line}"\x1b[0m`);
  }
  console.log("");

  console.log("\x1b[1m┌─────────────────────────────────────────────────────────────┐\x1b[0m");
  console.log("\x1b[1m│\x1b[0m Options:                                                    \x1b[1m│\x1b[0m");
  console.log("\x1b[1m│\x1b[0m   \x1b[32m[a]\x1b[0m Approve - Forward to orchestrator                    \x1b[1m│\x1b[0m");
  console.log("\x1b[1m│\x1b[0m   \x1b[31m[d]\x1b[0m Deny    - Reject request                             \x1b[1m│\x1b[0m");
  console.log("\x1b[1m│\x1b[0m   \x1b[34m[r]\x1b[0m Respond - Provide the answer directly                \x1b[1m│\x1b[0m");
  console.log("\x1b[1m└─────────────────────────────────────────────────────────────┘\x1b[0m\n");

  return new Promise((resolve) => {
    const askQuestion = () => {
      rl.question("Your choice [a/d/r]: ", async (answer) => {
        const normalized = answer.trim().toLowerCase();

        if (normalized === "a" || normalized === "approve") {
          rl.close();
          getLogger().logPermission({
            type: "escalation_response",
            source: "approval",
            allowed: true,
            severity: "info",
            details: {
              requestId: request.id,
              outcome: "approve",
              sourceAgentName: request.sourceAgentName,
              escalationReason: request.escalation.reason,
              requestText: request.escalation.requestText,
            },
          });
          resolve({
            requestId: request.id,
            outcome: "approve",
            respondedAt: Date.now(),
          });
        } else if (normalized === "d" || normalized === "deny") {
          // Optionally collect denial reason
          rl.question("Reason (optional, press Enter to skip): ", (reason) => {
            rl.close();
            getLogger().logPermission({
              type: "escalation_response",
              source: "approval",
              allowed: false,
              severity: "info",
              details: {
                requestId: request.id,
                outcome: "deny",
                sourceAgentName: request.sourceAgentName,
                escalationReason: request.escalation.reason,
                requestText: request.escalation.requestText,
                denialReason: reason.trim() || undefined,
              },
            });
            resolve({
              requestId: request.id,
              outcome: "deny",
              denialReason: reason.trim() || undefined,
              respondedAt: Date.now(),
            });
          });
        } else if (normalized === "r" || normalized === "respond") {
          // Collect multi-line response
          console.log("\nEnter your response (end with an empty line):");
          let response = "";
          const collectLines = () => {
            rl.question("", (line) => {
              if (line === "") {
                rl.close();
                getLogger().logPermission({
                  type: "escalation_response",
                  source: "approval",
                  allowed: true,
                  severity: "info",
                  details: {
                    requestId: request.id,
                    outcome: "direct_response",
                    sourceAgentName: request.sourceAgentName,
                    escalationReason: request.escalation.reason,
                    requestText: request.escalation.requestText,
                    hasDirectResponse: true,
                  },
                });
                resolve({
                  requestId: request.id,
                  outcome: "direct_response",
                  directResponse: response,
                  respondedAt: Date.now(),
                });
              } else {
                response += (response ? "\n" : "") + line;
                collectLines();
              }
            });
          };
          collectLines();
        } else {
          console.log("Please enter 'a' (approve), 'd' (deny), or 'r' (respond)");
          askQuestion();
        }
      });
    };

    askQuestion();
  });
}

/**
 * Prompt user for clarification when their message is too vague
 *
 * @param originalMessage - The user's original vague message
 * @param reason - Why clarification is needed (shown to user)
 * @returns Clarified message from user, or null if cancelled
 */
export async function promptClarification(
  originalMessage: string,
  reason: string
): Promise<string | null> {
  const rl = createReadlineInterface();

  console.log("\n┌─────────────────────────────────────────────────────────────┐");
  console.log("│                  CLARIFICATION NEEDED                        │");
  console.log("├─────────────────────────────────────────────────────────────┤");
  console.log("│ Your message:                                               │");
  // Wrap the original message
  const msgLines = originalMessage.match(/.{1,55}/g) || [originalMessage];
  for (const line of msgLines.slice(0, 2)) {
    console.log(`│   \x1b[33m"${line.padEnd(55)}"\x1b[0m │`);
  }
  console.log("├─────────────────────────────────────────────────────────────┤");
  console.log("│ \x1b[36mℹ Why clarification is needed:\x1b[0m                              │");
  const reasonLines = reason.match(/.{1,55}/g) || [reason];
  for (const line of reasonLines.slice(0, 3)) {
    console.log(`│   ${line.padEnd(55)} │`);
  }
  console.log("├─────────────────────────────────────────────────────────────┤");
  console.log("│ \x1b[33m⚠ SECURITY\x1b[0m: For your protection, I need to understand       │");
  console.log("│ your intent BEFORE accessing any content.                   │");
  console.log("├─────────────────────────────────────────────────────────────┤");
  console.log("│ Please be more specific about what you want to do.          │");
  console.log("│ (Or type 'cancel' to abort)                                 │");
  console.log("└─────────────────────────────────────────────────────────────┘\n");

  return new Promise((resolve) => {
    rl.question("\x1b[36mYour clarification:\x1b[0m ", (answer) => {
      rl.close();
      const trimmed = answer.trim();

      if (!trimmed || trimmed.toLowerCase() === "cancel") {
        resolve(null);
      } else {
        resolve(trimmed);
      }
    });
  });
}

/**
 * Prompt user for consent to share decrypted content with the orchestrator
 * @param persistToContext - If true, shows messaging for persistent planning context
 */
export async function promptDecryptedContentShare(
  requestId: string,
  reason: string,
  content: string,
  verified: boolean,
  persistToContext?: boolean
): Promise<DecryptedContentResponse> {
  const rl = createReadlineInterface();

  const verificationStatus = verified
    ? "\x1b[32m✓ VERIFIED\x1b[0m - Content integrity confirmed"
    : "\x1b[31m✗ UNVERIFIED\x1b[0m - Content may have been tampered with";

  const headerTitle = persistToContext
    ? "│           SHARE CONTENT FOR PLANNING CONTEXT               │"
    : "│              DECRYPTED CONTENT SHARE REQUEST                │";

  const headerDescription = persistToContext
    ? "│ The AI needs this content to plan the next steps.          │"
    : "│ The AI assistant is requesting to view decrypted content.  │";

  console.log("\n┌─────────────────────────────────────────────────────────────┐");
  console.log(headerTitle);
  console.log("├─────────────────────────────────────────────────────────────┤");
  console.log(headerDescription);
  console.log("├─────────────────────────────────────────────────────────────┤");
  console.log("│ Reason:                                                     │");
  // Wrap reason text
  const reasonLines = reason.match(/.{1,57}/g) || [reason];
  for (const line of reasonLines.slice(0, 3)) {
    console.log(`│  ${line.padEnd(57)}│`);
  }
  console.log("├─────────────────────────────────────────────────────────────┤");
  console.log(`│ Verification: ${verificationStatus.padEnd(44)}│`);
  console.log("├─────────────────────────────────────────────────────────────┤");
  console.log("│ Content Preview:                                            │");
  console.log("└─────────────────────────────────────────────────────────────┘");

  // Show content preview (truncated)
  const preview = content.slice(0, 500);
  console.log("\x1b[90m" + preview + "\x1b[0m");
  if (content.length > 500) {
    console.log("\x1b[90m... (truncated)\x1b[0m");
  }

  console.log("\n┌─────────────────────────────────────────────────────────────┐");
  if (persistToContext) {
    console.log("│ \x1b[36mℹ PLANNING CONTEXT\x1b[0m                                          │");
    console.log("│ This content will be stored in the planning context to     │");
    console.log("│ help the AI determine next steps. It will be used for      │");
    console.log("│ the remainder of this task.                                │");
  } else {
    console.log("│ \x1b[33m⚠ SECURITY NOTICE\x1b[0m                                          │");
    console.log("│ Sharing this content allows the AI to use it in its        │");
    console.log("│ response. The content will NOT be stored or used in        │");
    console.log("│ future conversations.                                      │");
  }
  console.log("└─────────────────────────────────────────────────────────────┘\n");

  const promptText = persistToContext
    ? "Share this content for planning? [y/n]: "
    : "Share this content with the AI? [y/n]: ";

  return new Promise((resolve) => {
    const askQuestion = () => {
      rl.question(promptText, (answer) => {
        const normalized = answer.trim().toLowerCase();

        if (normalized === "y" || normalized === "yes") {
          rl.close();
          getLogger().logPermission({
            type: "content_share",
            source: "approval",
            allowed: true,
            severity: "info",
            details: {
              requestId,
              action: "granted",
              verified,
              reason,
              persistToContext: persistToContext || false,
              contentLength: content.length,
            },
          });
          resolve({
            requestId,
            granted: true,
            content,
            verified,
            respondedAt: Date.now(),
          });
        } else if (normalized === "n" || normalized === "no") {
          rl.close();
          getLogger().logPermission({
            type: "content_share",
            source: "approval",
            allowed: false,
            severity: "info",
            details: {
              requestId,
              action: "denied",
              verified,
              reason,
              persistToContext: persistToContext || false,
            },
          });
          resolve({
            requestId,
            granted: false,
            respondedAt: Date.now(),
          });
        } else {
          console.log("Please enter 'y' (yes) or 'n' (no)");
          askQuestion();
        }
      });
    };

    askQuestion();
  });
}