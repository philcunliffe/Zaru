/**
 * Interactive Chat REPL
 *
 * Command-line interface for interacting with the secure AI assistant.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as readline from "readline";
import { OrchestrationAgent } from "../agents/orchestration";
import { getPackageRouter, initPackageRouter } from "../services/package-router";
import { getApprovalService, initApprovalService } from "../services/approval";
import { initEscalationService } from "../services/escalation";
import { getKeyRegistry, initKeyRegistry } from "../crypto";
import {
  decryptAndDisplay,
  formatDecryptedDisplay,
  formatVerificationSummary,
} from "./encrypted-display";
import {
  promptApproval,
  promptClarification,
  promptDecryptedContentShare,
  promptEscalationApproval,
  showProgress,
  showSuccess,
  showError,
  showInfo,
  showWarning,
} from "./approval";
import type { ExecutionPlan, PlanStep, DecryptedContentResponse } from "../agents/types";
import { getLogger, initLogger } from "../services/logger";
import { initAuditLedger, getAuditLedger } from "../audit/ledger";
import { verifyAuditFile } from "../audit/verifier";
import type { VerificationReport } from "../audit/verifier";
import { sessionStarted, sessionEnded } from "../audit/events";
import { setIntentAuditContext } from "../agents/intent";
import type { EncryptedPackage, AgentMetadata } from "../agents/types";
import type { KeyPair } from "../crypto";
import { isGoogleConfigured, getGoogleAccount } from "../services/google/base";
import { isObsidianConfigured, getObsidianVaultPath } from "../services/obsidian";
import {
  loadAndGenerateAgents,
  initConfigChecks,
  specToMetadata,
  type GeneratedAgentSpec,
} from "../generation";

/**
 * Chat session state
 */
interface ChatSession {
  userKeyPair: KeyPair;
  orchestrator: OrchestrationAgent;
  receivedPackages: EncryptedPackage[];
  lastRequest: string;
}

/**
 * Initialize the chat session
 */
async function initSession(): Promise<ChatSession> {
  showInfo("Initializing secure chat session...");

  // Initialize key registry
  const keyRegistry = initKeyRegistry();

  // Generate user keys
  const userKeyPair = keyRegistry.initUserKeys();
  showSuccess("User keys generated");

  // Initialize services
  const packageRouter = initPackageRouter();
  const approvalService = initApprovalService();

  // Register orchestrator with key registry (needed for conditional decryption)
  const orchestratorIdentity = keyRegistry.registerAgent(
    "orchestrator",
    "Orchestrator"
  );
  showSuccess("Orchestrator keys generated");

  // Initialize audit ledger for this session
  const sessionId = crypto.randomUUID();
  initAuditLedger(sessionId);
  getAuditLedger().append(
    sessionStarted("user"),
    "orchestrator",
    orchestratorIdentity.keyPair.secretKey,
  );

  // Set signing context for intent validation audit events
  setIntentAuditContext("orchestrator", orchestratorIdentity.keyPair.secretKey);

  // ============================================================================
  // Dynamic Agent Generation from JSON configs
  // ============================================================================

  // Initialize config checks (registers functions like isGmailConfigured)
  await initConfigChecks();

  // Load and generate agents from JSON configs
  const { agentSpecs } = await loadAndGenerateAgents({ verbose: false });
  const dynamicAgentSpecs: GeneratedAgentSpec[] = [];
  const dynamicMetadata: AgentMetadata[] = [];

  // Register and spawn dynamic agents
  for (const spec of agentSpecs) {
    try {
      // Register in key registry
      const identity = keyRegistry.registerAgent(spec.id, spec.name);
      spec.publicKey = identity.keyPair.publicKey;

      // Store for later use
      dynamicAgentSpecs.push(spec);
      dynamicMetadata.push(specToMetadata(spec));

      showSuccess(`Registered dynamic agent: ${spec.name}`);
    } catch (error) {
      showWarning(
        `Failed to register dynamic agent ${spec.id}: ${
          error instanceof Error ? error.message : "unknown error"
        }`
      );
    }
  }

  // ============================================================================
  // Static Agents (not yet migrated to JSON configs)
  // ============================================================================

  const browserAgentMetadata: AgentMetadata = {
    id: "browser-agent",
    name: "BrowserAgent",
    permission: "READ_WRITE",
    capabilities: [
      { name: "browse-web", description: "Navigate and interact with web pages" },
      { name: "fill-forms", description: "Fill out web forms" },
      { name: "click-buttons", description: "Click buttons and links" },
      { name: "extract-content", description: "Extract content from web pages" },
    ],
    publicKey: "",
  };

  const obsidianAgentMetadata: AgentMetadata = {
    id: "obsidian-agent",
    name: "ObsidianAgent",
    permission: "READ_WRITE",
    capabilities: [
      { name: "read-notes", description: "Read and search notes in Obsidian vault" },
      { name: "create-notes", description: "Create new notes in Obsidian vault" },
      { name: "update-notes", description: "Update or append to existing notes" },
      { name: "delete-notes", description: "Delete notes from vault" },
      { name: "search-vault", description: "Search across vault by title or content" },
    ],
    publicKey: "",
  };

  // Register static agents in key registry
  const browserAgentIdentity = keyRegistry.registerAgent(
    browserAgentMetadata.id,
    browserAgentMetadata.name
  );
  browserAgentMetadata.publicKey = browserAgentIdentity.keyPair.publicKey;

  const obsidianAgentIdentity = keyRegistry.registerAgent(
    obsidianAgentMetadata.id,
    obsidianAgentMetadata.name
  );
  obsidianAgentMetadata.publicKey = obsidianAgentIdentity.keyPair.publicKey;

  showSuccess("Static agents registered");

  // ============================================================================
  // Spawn Workers
  // ============================================================================

  // Spawn dynamic workers (from JSON configs)
  for (const spec of dynamicAgentSpecs) {
    try {
      await packageRouter.spawnDynamicWorker(spec);
      showSuccess(`${spec.name} dynamic worker spawned`);
    } catch (error) {
      showWarning(
        `${spec.name} dynamic worker spawn failed: ${
          error instanceof Error ? error.message : "unknown error"
        }`
      );
    }
  }

  // Spawn static workers
  const browserAgentPath = new URL(
    "../agents/workers/browser-agent.ts",
    import.meta.url
  ).pathname;
  const obsidianAgentPath = new URL(
    "../agents/workers/obsidian-agent.ts",
    import.meta.url
  ).pathname;

  try {
    await packageRouter.spawnWorker(browserAgentMetadata, browserAgentPath);
    showSuccess("BrowserAgent worker spawned");
  } catch (error) {
    showWarning(
      `BrowserAgent worker spawn failed: ${error instanceof Error ? error.message : "unknown error"}`
    );
  }

  try {
    await packageRouter.spawnWorker(obsidianAgentMetadata, obsidianAgentPath);
    showSuccess("ObsidianAgent worker spawned");
  } catch (error) {
    showWarning(
      `ObsidianAgent worker spawn failed: ${error instanceof Error ? error.message : "unknown error"}`
    );
  }

  // Set up approval handler
  approvalService.setHandler(promptApproval);

  // Initialize escalation service
  const escalationService = initEscalationService();

  // Register all agents with escalation service
  for (const metadata of dynamicMetadata) {
    escalationService.registerAgent(metadata.id, metadata.name);
  }
  escalationService.registerAgent(browserAgentMetadata.id, browserAgentMetadata.name);
  escalationService.registerAgent(obsidianAgentMetadata.id, obsidianAgentMetadata.name);

  // Set UI handler for escalation prompts
  escalationService.setUIHandler(promptEscalationApproval);

  // Track received packages
  const receivedPackages: EncryptedPackage[] = [];

  // Get logger for use in callbacks
  const logger = getLogger();

  // Create orchestration agent with handlers
  const orchestrator = new OrchestrationAgent({
    onDelegateTask: async (
      agentId: string,
      task: string,
      originalRequest: string,
      outputRecipients: string[]
    ) => {
      // Log agent task
      logger.logChat({
        type: "agent_task",
        agentId,
        content: task,
        metadata: { originalRequest, outputRecipients },
      });

      const stopProgress = showProgress(`Delegating to ${agentId}...`);
      try {
        const { package: pkg, outcomeSummary } = await packageRouter.delegateToReader(
          agentId,
          task,
          originalRequest,
          outputRecipients
        );
        stopProgress();
        const successMsg = outcomeSummary
          ? `${agentId}: ${outcomeSummary}`
          : `Task completed by ${agentId}`;
        showSuccess(successMsg);
        receivedPackages.push(pkg);

        // Log agent result
        logger.logChat({
          type: "agent_result",
          agentId,
          content: outcomeSummary || "Task completed",
          metadata: { packageId: pkg.id, outcomeSummary },
        });

        return { package: pkg, outcomeSummary };
      } catch (error) {
        stopProgress();
        logger.logError(
          "ERROR",
          `agent:${agentId}`,
          "Task delegation failed",
          error instanceof Error ? error : undefined,
          { task, originalRequest }
        );
        throw error;
      }
    },

    onRoutePackage: async (
      agentId: string,
      pkg: EncryptedPackage,
      taskDescription: string,
      originalRequest: string
    ) => {
      // Log routing
      logger.logChat({
        type: "agent_task",
        agentId,
        content: "Routing package",
        metadata: { packageId: pkg.id, sourceAgentId: pkg.sourceAgentId, taskDescription },
      });

      const stopProgress = showProgress(`Routing to ${agentId}...`);
      try {
        const resultPkg = await packageRouter.routeToWriter(agentId, pkg, taskDescription, originalRequest);
        stopProgress();
        showSuccess(`Package processed by ${agentId}`);
        receivedPackages.push(resultPkg);

        // Log result
        logger.logChat({
          type: "agent_result",
          agentId,
          content: "Package processed",
          metadata: { packageId: resultPkg.id },
        });

        return resultPkg;
      } catch (error) {
        stopProgress();
        logger.logError(
          "ERROR",
          `agent:${agentId}`,
          "Package routing failed",
          error instanceof Error ? error : undefined,
          { packageId: pkg.id }
        );
        throw error;
      }
    },

    onRequestApproval: async (description: string, preview: string, encryptedPackage?: EncryptedPackage) => {
      let contentPreview = preview;

      // If we have an encrypted package, try to decrypt it for the preview
      if (encryptedPackage) {
        try {
          const decrypted = decryptAndDisplay(encryptedPackage, userKeyPair, "");
          // Show decrypted content with an indicator that it was encrypted
          contentPreview = `\x1b[36m🔓 Decrypted content:\x1b[0m\n${decrypted.content}`;
          if (decrypted.verification.valid) {
            contentPreview += `\n\n\x1b[32m✓ Integrity verified\x1b[0m (from ${decrypted.sourceAgent})`;
          } else {
            contentPreview += `\n\n\x1b[33m⚠ Could not verify integrity\x1b[0m`;
          }
        } catch (error) {
          // Decryption failed, keep original preview
          contentPreview = preview;
        }
      }

      const response = await approvalService.requestApproval({
        id: crypto.randomUUID(),
        description,
        contentPreview,
        sourceAgentId: "orchestrator",
        targetAgentId: "user",
        planStepId: "",
        createdAt: Date.now(),
      });
      return response.approved;
    },

    onSendToUser: async (pkg: EncryptedPackage) => {
      receivedPackages.push(pkg);
      try {
        const display = decryptAndDisplay(pkg, userKeyPair, "");
        console.log(formatDecryptedDisplay(display));
      } catch (error) {
        showError(
          `Decryption failed: ${error instanceof Error ? error.message : "unknown error"}`
        );
        showInfo("Use /decrypt to retry");
      }
    },

    onRequestDecryptedContent: async (
      packageId: string,
      reason: string,
      persistToContext?: boolean
    ): Promise<DecryptedContentResponse | null> => {
      // Find package by ID or prefix
      const pkg = receivedPackages.find(
        (p) => p.id === packageId || p.id.startsWith(packageId)
      );
      if (!pkg) {
        return null;
      }

      // Decrypt locally using user's keys
      // Use the last request for verification (stored in session)
      try {
        const display = decryptAndDisplay(pkg, userKeyPair, "");

        // Prompt user for consent (with different messaging for planning context)
        const response = await promptDecryptedContentShare(
          crypto.randomUUID(),
          reason,
          display.content,
          display.verification.valid,
          persistToContext
        );

        // Log request (but NOT content)
        logger.logChat({
          type: "decryption_request",
          content: `Package ${pkg.id.slice(0, 8)}... - ${response.granted ? "GRANTED" : "DENIED"}${persistToContext ? " (planning context)" : ""}`,
          metadata: { packageId: pkg.id, reason, granted: response.granted, persistToContext },
        });

        // If approved and persistToContext, add to orchestrator context
        if (response.granted && persistToContext && response.content) {
          orchestrator.addToContext({
            id: crypto.randomUUID(),
            packageId: pkg.id,
            content: response.content,
            sourceAgentId: pkg.sourceAgentId,
            verified: response.verified || false,
            approvedAt: Date.now(),
          });
        }

        return response;
      } catch (error) {
        showError(
          `Failed to decrypt package: ${error instanceof Error ? error.message : "unknown error"}`
        );
        return null;
      }
    },

    onPlanCreated: (plan) => {
      // Display the plan immediately after creation (before execution)
      console.log(formatExecutionPlan(plan));
    },

    onRequestClarification: async (originalMessage: string, reason: string) => {
      // Log clarification request
      logger.logChat({
        type: "clarification_request",
        content: `Clarification needed: ${reason}`,
        metadata: { originalMessage, reason },
      });

      const clarified = await promptClarification(originalMessage, reason);

      // Log result
      logger.logChat({
        type: "clarification_response",
        content: clarified ? `User clarified: ${clarified}` : "User cancelled",
        metadata: { originalMessage, clarifiedMessage: clarified },
      });

      return clarified;
    },

    // Pass orchestrator's secret key for conditional decryption
    secretKey: orchestratorIdentity.keyPair.secretKey,
  });

  // Register agents with orchestrator
  // Register dynamic agents
  for (const metadata of dynamicMetadata) {
    orchestrator.registerAgent(metadata);
  }
  // Register static agents
  orchestrator.registerAgent(browserAgentMetadata);
  orchestrator.registerAgent(obsidianAgentMetadata);

  // Set forward handler for escalation - passes approved requests to orchestrator
  escalationService.setForwardHandler(async (escalation, sourceAgentId) => {
    return orchestrator.handleSubAgentRequest(
      escalation.requestText,
      sourceAgentId
    );
  });

  // Set escalation handler on package router
  packageRouter.setEscalationHandler((agentId, escalation) =>
    escalationService.processEscalation(agentId, escalation)
  );

  showSuccess("Orchestration agent initialized");

  // Show Google configuration status
  if (isGoogleConfigured()) {
    showSuccess(`Google services configured: ${getGoogleAccount()}`);
  } else {
    showWarning("Google services not configured. Add google.account to ~/.zaru/config.json");
  }

  // Show Obsidian configuration status
  if (isObsidianConfigured()) {
    showSuccess(`Obsidian configured: ${getObsidianVaultPath()}`);
  } else {
    showWarning("Obsidian not configured. Add obsidian.vaultPath to ~/.zaru/config.json");
  }

  return {
    userKeyPair,
    orchestrator,
    receivedPackages,
    lastRequest: "",
  };
}

/**
 * Format an execution plan for display
 */
function formatExecutionPlan(plan: ExecutionPlan): string {
  const statusEmoji: Record<string, string> = {
    pending: "⏳",
    executing: "🔄",
    waiting_approval: "⏸️",
    completed: "✅",
    failed: "❌",
  };

  const stepTypeEmoji: Record<string, string> = {
    delegate: "📤",
    route: "➡️",
    approve: "👤",
    respond: "💬",
    gather: "🔍",
    unknown: "❓",
  };

  const lines: string[] = [
    "",
    "┌─────────────────────────────────────────────────────────────┐",
    "│                    EXECUTION PLAN                           │",
    "├─────────────────────────────────────────────────────────────┤",
    `│ ID: ${plan.id.slice(0, 8)}...                                        │`,
    `│ Status: ${statusEmoji[plan.status] || "?"} ${plan.status.padEnd(20)}                       │`,
    `│ Steps: ${plan.steps.length}                                                   │`,
    "├─────────────────────────────────────────────────────────────┤",
  ];

  // Helper to wrap text into lines of max width
  const wrapText = (text: string, maxWidth: number): string[] => {
    const words = text.split(" ");
    const result: string[] = [];
    let currentLine = "";
    for (const word of words) {
      if ((currentLine + " " + word).trim().length > maxWidth) {
        if (currentLine) result.push(currentLine);
        currentLine = word;
      } else {
        currentLine = currentLine ? currentLine + " " + word : word;
      }
    }
    if (currentLine) result.push(currentLine);
    return result;
  };

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    const isCurrent = i === plan.currentStepIndex;
    const marker = isCurrent ? "▶" : " ";
    const emoji = stepTypeEmoji[step.type] || "•";

    let stepHeader = `${step.type}`;
    if (step.targetAgentId) {
      stepHeader += ` → ${step.targetAgentId}`;
    }

    lines.push(`│ ${marker} ${emoji} Step ${i}: ${stepHeader.padEnd(45).slice(0, 45)} │`);

    // Show full task text wrapped across multiple lines
    if (step.task) {
      const taskLines = wrapText(step.task, 53);
      for (const taskLine of taskLines) {
        lines.push(`│     "${taskLine.padEnd(53)}" │`);
      }
    }

    // Show unknownReason for unknown steps
    if (step.type === "unknown" && step.unknownReason) {
      lines.push(`│     \x1b[33mTBD:\x1b[0m ${step.unknownReason.slice(0, 48).padEnd(48)} │`);
    }

    if (step.dependsOn && step.dependsOn.length > 0) {
      const depsText = step.dependsOn.join(", ");
      const depsLines = wrapText(depsText, 35);
      lines.push(`│     📎 Depends on: ${depsLines[0].padEnd(35)} │`);
      for (let j = 1; j < depsLines.length; j++) {
        lines.push(`│                    ${depsLines[j].padEnd(35)} │`);
      }
    }
  }

  lines.push("└─────────────────────────────────────────────────────────────┘");
  lines.push("");

  return lines.join("\n");
}

/**
 * Format a verification report for CLI display
 */
export function formatVerificationReport(report: VerificationReport): string {
  const lines: string[] = [
    "",
    "┌─────────────────────────────────────────────────────────────┐",
    "│                  AUDIT CHAIN VERIFICATION                   │",
    "├─────────────────────────────────────────────────────────────┤",
  ];

  // Overall status
  const statusIcon = report.valid ? "\x1b[32m✓ VALID\x1b[0m" : "\x1b[31m✗ INVALID\x1b[0m";
  lines.push(`│ Status: ${statusIcon}                                            │`);
  lines.push(`│ Total entries: ${String(report.totalEntries).padEnd(43)}│`);
  lines.push("├─────────────────────────────────────────────────────────────┤");

  // Chain integrity
  const chainIcon = report.chainIntact
    ? "\x1b[32m✓\x1b[0m intact"
    : "\x1b[31m✗\x1b[0m BROKEN";
  lines.push(`│ Hash chain: ${chainIcon.padEnd(51)}│`);

  if (!report.chainIntact && report.firstBrokenLink !== null) {
    lines.push(
      `│   \x1b[31m⚠ First broken link at sequence ${report.firstBrokenLink}\x1b[0m${" ".repeat(Math.max(0, 24 - String(report.firstBrokenLink).length))}│`,
    );
  }

  // Signature validity
  const sigIcon = report.signaturesValid
    ? "\x1b[32m✓\x1b[0m all valid"
    : `\x1b[31m✗\x1b[0m ${report.invalidSignatures.length} failed`;
  lines.push(`│ Signatures: ${sigIcon.padEnd(51)}│`);

  if (!report.signaturesValid && report.invalidSignatures.length > 0) {
    const seqList = report.invalidSignatures.slice(0, 10).join(", ");
    const suffix = report.invalidSignatures.length > 10
      ? ` (+${report.invalidSignatures.length - 10} more)`
      : "";
    lines.push(
      `│   \x1b[31m⚠ Failed at: ${(seqList + suffix).slice(0, 43)}\x1b[0m${" ".repeat(Math.max(0, 43 - (seqList + suffix).length))}│`,
    );
  }

  // Event breakdown
  lines.push("├─────────────────────────────────────────────────────────────┤");
  lines.push("│ Event Breakdown:                                            │");

  const eventEntries = Object.entries(report.eventCounts)
    .sort(([, a], [, b]) => (b ?? 0) - (a ?? 0));

  if (eventEntries.length === 0) {
    lines.push("│   (no events)                                               │");
  } else {
    for (const [eventType, count] of eventEntries) {
      const label = `  ${eventType}`;
      const countStr = String(count ?? 0);
      const padding = 59 - label.length - countStr.length - 1;
      lines.push(`│${label}${" ".repeat(Math.max(1, padding))}${countStr} │`);
    }
  }

  // Session summary
  lines.push("├─────────────────────────────────────────────────────────────┤");
  lines.push("│ Session Summary:                                            │");

  const { sessionIds, actorIds, firstTimestamp, lastTimestamp } = report.sessionSummary;

  if (sessionIds.length > 0) {
    for (const sid of sessionIds) {
      const truncated = sid.length > 50 ? sid.slice(0, 47) + "..." : sid;
      lines.push(`│   Session: ${truncated.padEnd(47)}│`);
    }
  }

  if (actorIds.length > 0) {
    const actorList = actorIds.join(", ");
    const truncated = actorList.length > 47 ? actorList.slice(0, 44) + "..." : actorList;
    lines.push(`│   Actors:  ${truncated.padEnd(47)}│`);
  }

  if (firstTimestamp) {
    const start = new Date(firstTimestamp).toLocaleString();
    lines.push(`│   Start:   ${start.padEnd(47)}│`);
  }
  if (lastTimestamp) {
    const end = new Date(lastTimestamp).toLocaleString();
    lines.push(`│   End:     ${end.padEnd(47)}│`);
  }

  lines.push("└─────────────────────────────────────────────────────────────┘");
  lines.push("");

  return lines.join("\n");
}

/**
 * Display help information
 */
function showHelp(): void {
  console.log(`
┌─────────────────────────────────────────────────────────────┐
│                       ZARU HELP                             │
├─────────────────────────────────────────────────────────────┤
│ Commands:                                                   │
│   /help     - Show this help message                        │
│   /packages - List received encrypted packages              │
│   /decrypt  - Decrypt and display the latest package        │
│   /decrypt <id> - Decrypt a specific package                │
│   /verify   - Verify audit chain integrity                  │
│   /logs     - Show current log directory                    │
│   /clear    - Clear the screen                              │
│   /quit     - Exit the chat                                 │
│                                                             │
│ Flags:                                                      │
│   --log, -l - Enable session logging                        │
│                                                             │
│ Example requests:                                           │
│   "Summarize my last 10 emails"                             │
│   "Summarize my emails and write to Google Doc"             │
│   "List my unread emails"                                   │
│   "Use the browser to buy event tickets"                    │
│   "Log in to the website" (tests 2FA escalation)            │
└─────────────────────────────────────────────────────────────┘
`);
}

/**
 * Handle a user command
 */
async function handleCommand(
  command: string,
  session: ChatSession
): Promise<boolean> {
  const parts = command.slice(1).split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1);

  switch (cmd) {
    case "help":
      showHelp();
      break;

    case "packages":
      if (session.receivedPackages.length === 0) {
        showInfo("No encrypted packages received yet");
      } else {
        console.log("\nReceived Packages:");
        for (const pkg of session.receivedPackages) {
          console.log(
            `  - ${pkg.id.slice(0, 8)}... from ${pkg.sourceAgentId} at ${new Date(pkg.createdAt).toLocaleString()}`
          );
        }
        console.log("");
      }
      break;

    case "decrypt":
      if (session.receivedPackages.length === 0) {
        showError("No packages to decrypt");
      } else {
        let pkg: EncryptedPackage | undefined;

        if (args[0]) {
          // Find package by ID prefix
          pkg = session.receivedPackages.find((p) =>
            p.id.startsWith(args[0])
          );
          if (!pkg) {
            showError(`Package starting with "${args[0]}" not found`);
            break;
          }
        } else {
          // Use the latest package
          pkg = session.receivedPackages[session.receivedPackages.length - 1];
        }

        try {
          const display = decryptAndDisplay(
            pkg,
            session.userKeyPair,
            session.lastRequest
          );
          console.log(formatDecryptedDisplay(display));
        } catch (error) {
          showError(
            `Decryption failed: ${error instanceof Error ? error.message : "unknown error"}`
          );
        }
      }
      break;

    case "logs": {
      const logger = getLogger();
      if (logger.isEnabled()) {
        showInfo(`Log directory: ${logger.getLogDir()}`);
      } else {
        showInfo("Logging is not enabled. Use --log flag to enable.");
      }
      break;
    }

    case "verify": {
      const ledger = getAuditLedger();
      if (!ledger.isEnabled()) {
        showError("Audit ledger is not active. Enable logging with --log flag.");
        break;
      }

      const sessionId = ledger.getSessionId();
      const auditPath = path.join(
        os.homedir(), ".zaru", "logs", sessionId, "audit.jsonl",
      );

      if (!fs.existsSync(auditPath)) {
        showInfo("No audit entries recorded yet in this session.");
        break;
      }

      try {
        const report = verifyAuditFile(auditPath);
        console.log(formatVerificationReport(report));
      } catch (error) {
        showError(
          `Verification failed: ${error instanceof Error ? error.message : "unknown error"}`,
        );
      }
      break;
    }

    case "clear":
      console.clear();
      break;

    case "quit":
    case "exit": {
      // Audit: session ended by user
      try {
        const ledger = getAuditLedger();
        const orchAgent = getKeyRegistry().getAgent("orchestrator");
        if (orchAgent) {
          ledger.append(
            sessionEnded("user_exit"),
            "orchestrator",
            orchAgent.keyPair.secretKey,
          );
        }
        ledger.close();
      } catch {
        // fail-open
      }
      return true;
    }

    default:
      showError(`Unknown command: /${cmd}. Type /help for available commands.`);
  }

  return false;
}

/**
 * Chat options
 */
interface ChatOptions {
  logEnabled: boolean;
}

/**
 * Run the interactive chat REPL
 */
export async function runChat(options: ChatOptions = { logEnabled: false }): Promise<void> {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║        🙈          🙉          🙊                             ║
║       .--.        .--.        .--.                            ║
║      ( oo )      (    )      (    )                           ║
║      _\\==/_      _\\==/_      _\\==/_                           ║
║     /      \\    /      \\    /      \\                          ║
║    |  \\  /  |  |   ||   |  |  ----  |                         ║
║     \\      /    \\      /    \\      /                          ║
║      '----'      '----'      '----'                           ║
║     SEE NONE    HEAR NONE   SPEAK NONE                        ║
║                                                               ║
║   ███████╗ █████╗ ██████╗ ██╗   ██╗                           ║
║   ╚══███╔╝██╔══██╗██╔══██╗██║   ██║                           ║
║     ███╔╝ ███████║██████╔╝██║   ██║                           ║
║    ███╔╝  ██╔══██║██╔══██╗██║   ██║                           ║
║   ███████╗██║  ██║██║  ██║╚██████╔╝                           ║
║   ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝                            ║
║                                                               ║
║   Secure AI Assistant with Isolated Agent Architecture        ║
║   Named after the Sanzaru (三猿) - the three wise monkeys     ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
`);

  // Initialize logger
  const logger = initLogger(options.logEnabled);
  if (logger.isEnabled()) {
    showInfo(`Session logging enabled: ${logger.getLogDir()}`);
  }

  // Check for API key
  if (!process.env.OPENAI_API_KEY) {
    showError("OPENAI_API_KEY environment variable is not set");
    showInfo("Please set your OpenAI API key and restart");
    process.exit(1);
  }

  let session: ChatSession;
  try {
    session = await initSession();
  } catch (error) {
    showError(
      `Failed to initialize session: ${error instanceof Error ? error.message : "unknown error"}`
    );
    process.exit(1);
  }

  showInfo("Type /help for available commands");
  console.log("");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = () => {
    rl.question("\x1b[36mYou:\x1b[0m ", async (input) => {
      const trimmed = input.trim();

      if (!trimmed) {
        prompt();
        return;
      }

      // Handle commands
      if (trimmed.startsWith("/")) {
        const shouldExit = await handleCommand(trimmed, session);
        if (shouldExit) {
          console.log("\nGoodbye!\n");
          rl.close();
          // Clean up logger and workers
          getLogger().close();
          await getPackageRouter().shutdown();
          process.exit(0);
        }
        prompt();
        return;
      }

      // Log user message
      const chatLogger = getLogger();
      chatLogger.logChat({
        type: "user_message",
        content: trimmed,
      });

      // Process the message
      session.lastRequest = trimmed;
      const stopProgress = showProgress("Processing...");

      try {
        const response = await session.orchestrator.processMessage(trimmed);
        stopProgress();
        if (response) {
          console.log(`\n\x1b[33mAssistant:\x1b[0m ${response}\n`);
        }

        // Log assistant response
        chatLogger.logChat({
          type: "assistant_response",
          agentId: "orchestrator",
          content: response,
        });
      } catch (error) {
        stopProgress();
        // Log error
        chatLogger.logChat({
          type: "error",
          content: error instanceof Error ? error.message : "unknown error",
        });
        chatLogger.logError(
          "ERROR",
          "orchestrator",
          "Message processing failed",
          error instanceof Error ? error : undefined,
          { userMessage: trimmed }
        );
        showError(
          `Error: ${error instanceof Error ? error.message : "unknown error"}`
        );
      }

      prompt();
    });
  };

  prompt();
}
