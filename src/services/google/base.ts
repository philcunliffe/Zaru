/**
 * Google Base Service
 *
 * Base class for Google services that use the GOG CLI.
 * Provides shared command execution logic with JSON output parsing.
 */

import { spawn } from "child_process";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

// ============================================================================
// Configuration
// ============================================================================

const CONFIG_DIR = join(homedir(), ".zaru");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export interface ZaruConfig {
  google?: {
    account: string;
  };
  // Backward compatibility
  gmail?: {
    account: string;
  };
  obsidian?: {
    vaultPath: string;
    cliPath?: string;
  };
}

/**
 * Load configuration from ~/.zaru/config.json
 */
export function loadConfig(): ZaruConfig {
  if (!existsSync(CONFIG_FILE)) {
    return {};
  }
  try {
    const content = readFileSync(CONFIG_FILE, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    console.warn(`[Config] Failed to parse config file: ${error}`);
    return {};
  }
}

/**
 * Save configuration to ~/.zaru/config.json
 */
export function saveConfig(config: ZaruConfig): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

/**
 * Get the configured Google account (with backward compatibility for gmail.account)
 */
export function getGoogleAccount(): string | null {
  const config = loadConfig();
  return config.google?.account || config.gmail?.account || null;
}

/**
 * Check if Google services are configured
 */
export function isGoogleConfigured(): boolean {
  return getGoogleAccount() !== null;
}

// ============================================================================
// Google Base Service
// ============================================================================

export interface GoogleServiceOptions {
  account?: string;
  gogPath?: string;
}

/**
 * Base class for Google services using GOG CLI
 */
export abstract class GoogleBaseService {
  protected account: string;
  protected gogPath: string;

  /** GOG subcommand for this service (e.g., "gmail", "calendar", "drive") */
  protected abstract readonly serviceCommand: string;

  constructor(options?: GoogleServiceOptions) {
    const configAccount = getGoogleAccount();
    this.account = options?.account || configAccount || "";
    this.gogPath = options?.gogPath || "gog";

    if (!this.account) {
      throw new Error(
        "Google account not configured. Please set google.account in ~/.zaru/config.json"
      );
    }
  }

  /**
   * Execute a GOG command and return parsed JSON output
   */
  protected async execGog(args: string[]): Promise<unknown> {
    const fullArgs = [this.serviceCommand, "--json", "--account", this.account, ...args];

    return new Promise((resolve, reject) => {
      const proc = spawn(this.gogPath, fullArgs, {
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`GOG ${this.serviceCommand} command failed (exit ${code}): ${stderr || stdout}`));
          return;
        }

        try {
          const parsed = JSON.parse(stdout);
          resolve(parsed);
        } catch {
          reject(new Error(`Failed to parse GOG output: ${stdout}`));
        }
      });

      proc.on("error", (error) => {
        reject(new Error(`Failed to execute GOG: ${error.message}`));
      });
    });
  }

  /**
   * Execute a GOG command and return raw text output (for commands that don't return JSON)
   */
  protected async execGogText(args: string[]): Promise<string> {
    const fullArgs = [this.serviceCommand, "--account", this.account, ...args];

    return new Promise((resolve, reject) => {
      const proc = spawn(this.gogPath, fullArgs, {
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`GOG ${this.serviceCommand} command failed (exit ${code}): ${stderr || stdout}`));
          return;
        }
        resolve(stdout);
      });

      proc.on("error", (error) => {
        reject(new Error(`Failed to execute GOG: ${error.message}`));
      });
    });
  }

  /**
   * Get the configured account
   */
  getAccount(): string {
    return this.account;
  }
}
