/**
 * Session Logger Service
 *
 * Handles logging of chat messages and errors for debugging and auditing.
 * Creates three log files per session:
 * - error.log: Plain text file for exceptions and errors
 * - chat.jsonl: JSONL file of all messages from each agent
 * - permissions.jsonl: JSONL file of all permission and security checks
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

/**
 * Chat log entry types
 */
export type ChatLogType =
  | "user_message"
  | "assistant_response"
  | "agent_task"
  | "agent_result"
  | "worker_message"
  | "approval_request"
  | "approval_response"
  | "decryption_request"
  | "clarification_request"
  | "clarification_response"
  | "error";

/**
 * Permission log entry types
 */
export type PermissionLogType =
  | "intent_extraction"
  | "intent_validation"
  | "step_validation"
  | "tool_validation"
  | "sub_intent_extraction"
  | "sub_intent_validation"
  | "permission_check"
  | "agent_registration"
  | "package_routing"
  | "escalation_request"
  | "escalation_response"
  | "user_approval"
  | "content_share"
  | "security_warning"
  | "security_block";

/**
 * Permission log entry structure
 */
export interface PermissionLogEntry {
  timestamp: number;
  sessionId: string;
  type: PermissionLogType;
  source: string;
  agentId?: string;
  allowed?: boolean;
  severity?: "info" | "warn" | "block";
  details: Record<string, unknown>;
}

/**
 * Chat log entry structure
 */
export interface ChatLogEntry {
  timestamp: number;
  sessionId: string;
  type: ChatLogType;
  agentId?: string;
  content: string;
  metadata?: Record<string, unknown>;
}

/**
 * Error log levels
 */
export type ErrorLevel = "DEBUG" | "INFO" | "WARN" | "ERROR" | "FATAL";

/**
 * Logger Service
 *
 * Manages log files for a session. Follows the singleton pattern.
 */
export class LoggerService {
  private enabled: boolean = false;
  private sessionId: string = "";
  private logDir: string = "";
  private errorStream: fs.WriteStream | null = null;
  private chatStream: fs.WriteStream | null = null;
  private permissionsStream: fs.WriteStream | null = null;

  /**
   * Generate a unique session ID
   */
  private generateSessionId(): string {
    const now = new Date();
    const dateStr = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const randomStr = Math.random().toString(36).substring(2, 8);
    return `${dateStr}-${randomStr}`;
  }

  /**
   * Initialize the logger service
   */
  init(enabled: boolean): void {
    this.enabled = enabled;

    if (!enabled) {
      return;
    }

    // Generate session ID
    this.sessionId = this.generateSessionId();

    // Create log directory
    const baseDir = path.join(os.homedir(), ".zaru", "logs");
    this.logDir = path.join(baseDir, this.sessionId);

    try {
      fs.mkdirSync(this.logDir, { recursive: true });
    } catch (error) {
      console.error(`Failed to create log directory: ${error instanceof Error ? error.message : error}`);
      this.enabled = false;
      return;
    }

    // Open file streams
    const errorLogPath = path.join(this.logDir, "error.log");
    const chatLogPath = path.join(this.logDir, "chat.jsonl");
    const permissionsLogPath = path.join(this.logDir, "permissions.jsonl");

    try {
      this.errorStream = fs.createWriteStream(errorLogPath, { flags: "a" });
      this.chatStream = fs.createWriteStream(chatLogPath, { flags: "a" });
      this.permissionsStream = fs.createWriteStream(permissionsLogPath, { flags: "a" });
    } catch (error) {
      console.error(`Failed to create log files: ${error instanceof Error ? error.message : error}`);
      this.enabled = false;
      return;
    }

    // Write session header to error log
    const header = [
      "=== Zaru Session Started ===",
      `Session ID: ${this.sessionId}`,
      `Started: ${new Date().toISOString()}`,
      "========================================",
      "",
    ].join("\n");

    this.errorStream.write(header);
  }

  /**
   * Log an error to error.log
   */
  logError(
    level: ErrorLevel,
    source: string,
    message: string,
    error?: Error,
    context?: Record<string, unknown>
  ): void {
    if (!this.enabled || !this.errorStream) {
      return;
    }

    const timestamp = new Date().toISOString();
    let logLine = `[${timestamp}] [${level}] [${source}] ${message}`;

    if (error) {
      logLine += `\nError: ${error.message}`;
      if (error.stack) {
        logLine += `\n${error.stack}`;
      }
    }

    if (context) {
      logLine += `\nContext: ${JSON.stringify(context)}`;
    }

    logLine += "\n\n";

    this.errorStream.write(logLine);
  }

  /**
   * Log a chat message to chat.jsonl
   */
  logChat(entry: Omit<ChatLogEntry, "timestamp" | "sessionId">): void {
    if (!this.enabled || !this.chatStream) {
      return;
    }

    const fullEntry: ChatLogEntry = {
      timestamp: Date.now(),
      sessionId: this.sessionId,
      ...entry,
    };

    const jsonLine = JSON.stringify(fullEntry) + "\n";
    this.chatStream.write(jsonLine);
  }

  /**
   * Log a permission/security check to permissions.jsonl
   */
  logPermission(entry: Omit<PermissionLogEntry, "timestamp" | "sessionId">): void {
    if (!this.enabled || !this.permissionsStream) {
      return;
    }

    const fullEntry: PermissionLogEntry = {
      timestamp: Date.now(),
      sessionId: this.sessionId,
      ...entry,
    };

    const jsonLine = JSON.stringify(fullEntry) + "\n";
    this.permissionsStream.write(jsonLine);
  }

  /**
   * Close log streams and finalize session
   */
  close(): void {
    if (!this.enabled) {
      return;
    }

    // Write session footer to error log
    if (this.errorStream) {
      const footer = `\n=== Session Ended: ${new Date().toISOString()} ===\n`;
      this.errorStream.write(footer);
      this.errorStream.end();
      this.errorStream = null;
    }

    if (this.chatStream) {
      this.chatStream.end();
      this.chatStream = null;
    }

    if (this.permissionsStream) {
      this.permissionsStream.end();
      this.permissionsStream = null;
    }
  }

  /**
   * Get the log directory path
   */
  getLogDir(): string {
    return this.logDir;
  }

  /**
   * Check if logging is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Get the session ID
   */
  getSessionId(): string {
    return this.sessionId;
  }
}

// Singleton instance
let _logger: LoggerService | null = null;

/**
 * Get the logger service singleton
 */
export function getLogger(): LoggerService {
  if (!_logger) {
    _logger = new LoggerService();
  }
  return _logger;
}

/**
 * Initialize the logger service
 */
export function initLogger(enabled: boolean): LoggerService {
  _logger = new LoggerService();
  _logger.init(enabled);
  return _logger;
}
