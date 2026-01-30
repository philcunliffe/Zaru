/**
 * Obsidian Service
 *
 * Wraps the Obsidian CLI (obs) for vault operations.
 * Uses Yakitrak's obsidian-cli: https://github.com/Yakitrak/obsidian-cli
 * Install with: brew install yakitrak/obsidian-cli/obs
 *
 * Configuration is loaded from ~/.zaru/config.json
 */

import { spawn } from "child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync, appendFileSync, unlinkSync, statSync } from "fs";
import { join, basename, dirname, relative } from "path";
import { loadConfig, type ZaruConfig } from "./gmail";

// ============================================================================
// Types
// ============================================================================

export interface ObsidianNote {
  path: string;
  name: string;
  content?: string;
  modifiedAt?: Date;
}

export interface ObsidianSearchResult {
  path: string;
  name: string;
  snippet?: string;
  score?: number;
}

export interface ObsidianVault {
  name: string;
  path: string;
}

// ============================================================================
// Configuration Helpers
// ============================================================================

/**
 * Get Obsidian configuration from ZaruConfig
 */
function getObsidianConfig(): ZaruConfig["obsidian"] {
  const config = loadConfig();
  return config.obsidian;
}

/**
 * Get the configured Obsidian vault path
 */
export function getObsidianVaultPath(): string | null {
  const config = getObsidianConfig();
  return config?.vaultPath || null;
}

/**
 * Check if Obsidian is configured
 */
export function isObsidianConfigured(): boolean {
  const vaultPath = getObsidianVaultPath();
  return vaultPath !== null && existsSync(vaultPath);
}

// ============================================================================
// Obsidian Service
// ============================================================================

export class ObsidianService {
  private vaultPath: string;
  private obsPath: string;

  constructor(options?: { vaultPath?: string; obsPath?: string }) {
    const configVaultPath = getObsidianVaultPath();
    this.vaultPath = options?.vaultPath || configVaultPath || "";
    this.obsPath = options?.obsPath || "obs";

    if (!this.vaultPath) {
      throw new Error(
        "Obsidian vault not configured. Please set obsidian.vaultPath in ~/.zaru/config.json"
      );
    }

    if (!existsSync(this.vaultPath)) {
      throw new Error(`Obsidian vault path does not exist: ${this.vaultPath}`);
    }
  }

  /**
   * Get the vault path
   */
  getVaultPath(): string {
    return this.vaultPath;
  }

  /**
   * Resolve a note path to an absolute path within the vault
   */
  private resolvePath(notePath: string): string {
    // If already absolute and within vault, use as-is
    if (notePath.startsWith(this.vaultPath)) {
      return notePath;
    }
    // Otherwise, treat as relative to vault root
    const resolved = join(this.vaultPath, notePath);
    // Ensure we don't escape the vault
    if (!resolved.startsWith(this.vaultPath)) {
      throw new Error(`Path escapes vault: ${notePath}`);
    }
    return resolved;
  }

  /**
   * Get relative path from vault root
   */
  private getRelativePath(absolutePath: string): string {
    return relative(this.vaultPath, absolutePath);
  }

  /**
   * Ensure path has .md extension
   */
  private ensureMdExtension(path: string): string {
    if (!path.endsWith(".md")) {
      return path + ".md";
    }
    return path;
  }

  /**
   * Execute an Obsidian CLI command
   */
  private async execObs(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.obsPath, args, {
        stdio: ["pipe", "pipe", "pipe"],
        cwd: this.vaultPath,
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
          reject(new Error(`Obsidian CLI failed (exit ${code}): ${stderr || stdout}`));
          return;
        }
        resolve(stdout);
      });

      proc.on("error", (error) => {
        reject(new Error(`Failed to execute Obsidian CLI: ${error.message}`));
      });
    });
  }

  // ==========================================================================
  // Read Operations
  // ==========================================================================

  /**
   * Read a note's content
   *
   * @param notePath - Path to the note (relative to vault root or absolute)
   * @returns The note with content
   */
  async readNote(notePath: string): Promise<ObsidianNote> {
    const fullPath = this.resolvePath(this.ensureMdExtension(notePath));

    if (!existsSync(fullPath)) {
      throw new Error(`Note not found: ${notePath}`);
    }

    const content = readFileSync(fullPath, "utf-8");
    const stats = statSync(fullPath);

    return {
      path: this.getRelativePath(fullPath),
      name: basename(fullPath, ".md"),
      content,
      modifiedAt: stats.mtime,
    };
  }

  /**
   * Search for notes by filename/title
   *
   * @param query - Search query
   * @param limit - Maximum number of results
   * @returns Matching notes (without content)
   */
  async searchNotes(query: string, limit = 20): Promise<ObsidianSearchResult[]> {
    const results: ObsidianSearchResult[] = [];
    const queryLower = query.toLowerCase();

    const searchDir = (dir: string) => {
      if (results.length >= limit) return;

      const entries = readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (results.length >= limit) break;

        const fullPath = join(dir, entry.name);

        // Skip hidden files/folders and .obsidian
        if (entry.name.startsWith(".")) continue;

        if (entry.isDirectory()) {
          searchDir(fullPath);
        } else if (entry.isFile() && entry.name.endsWith(".md")) {
          const name = basename(entry.name, ".md");
          if (name.toLowerCase().includes(queryLower)) {
            results.push({
              path: this.getRelativePath(fullPath),
              name,
            });
          }
        }
      }
    };

    searchDir(this.vaultPath);
    return results;
  }

  /**
   * Search within note content
   *
   * @param query - Search query
   * @param limit - Maximum number of results
   * @returns Matching notes with snippets
   */
  async searchNoteContent(query: string, limit = 20): Promise<ObsidianSearchResult[]> {
    const results: ObsidianSearchResult[] = [];
    const queryLower = query.toLowerCase();

    const searchDir = (dir: string) => {
      if (results.length >= limit) return;

      const entries = readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (results.length >= limit) break;

        const fullPath = join(dir, entry.name);

        // Skip hidden files/folders and .obsidian
        if (entry.name.startsWith(".")) continue;

        if (entry.isDirectory()) {
          searchDir(fullPath);
        } else if (entry.isFile() && entry.name.endsWith(".md")) {
          try {
            const content = readFileSync(fullPath, "utf-8");
            const contentLower = content.toLowerCase();
            const index = contentLower.indexOf(queryLower);

            if (index !== -1) {
              // Extract snippet around match
              const start = Math.max(0, index - 50);
              const end = Math.min(content.length, index + query.length + 50);
              const snippet = content.slice(start, end).replace(/\n/g, " ");

              results.push({
                path: this.getRelativePath(fullPath),
                name: basename(entry.name, ".md"),
                snippet: (start > 0 ? "..." : "") + snippet + (end < content.length ? "..." : ""),
              });
            }
          } catch {
            // Skip files that can't be read
          }
        }
      }
    };

    searchDir(this.vaultPath);
    return results;
  }

  /**
   * List notes in a folder
   *
   * @param folderPath - Path to folder (relative to vault root)
   * @returns Notes in the folder
   */
  async getNotesInFolder(folderPath: string): Promise<ObsidianNote[]> {
    const fullPath = this.resolvePath(folderPath);

    if (!existsSync(fullPath)) {
      throw new Error(`Folder not found: ${folderPath}`);
    }

    const stats = statSync(fullPath);
    if (!stats.isDirectory()) {
      throw new Error(`Path is not a folder: ${folderPath}`);
    }

    const entries = readdirSync(fullPath, { withFileTypes: true });
    const notes: ObsidianNote[] = [];

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;

      if (entry.isFile() && entry.name.endsWith(".md")) {
        const notePath = join(fullPath, entry.name);
        const noteStats = statSync(notePath);

        notes.push({
          path: this.getRelativePath(notePath),
          name: basename(entry.name, ".md"),
          modifiedAt: noteStats.mtime,
        });
      }
    }

    return notes;
  }

  /**
   * List available vaults
   * Note: This returns the configured vault. Multiple vaults would need
   * additional configuration.
   *
   * @returns Array of vaults
   */
  async listVaults(): Promise<ObsidianVault[]> {
    return [
      {
        name: basename(this.vaultPath),
        path: this.vaultPath,
      },
    ];
  }

  // ==========================================================================
  // Write Operations
  // ==========================================================================

  /**
   * Create a new note
   *
   * @param notePath - Path for the new note (relative to vault root)
   * @param content - Note content
   * @returns The created note
   */
  async createNote(notePath: string, content: string): Promise<ObsidianNote> {
    const fullPath = this.resolvePath(this.ensureMdExtension(notePath));

    if (existsSync(fullPath)) {
      throw new Error(`Note already exists: ${notePath}`);
    }

    // Ensure parent directory exists
    const parentDir = dirname(fullPath);
    if (!existsSync(parentDir)) {
      const { mkdirSync } = await import("fs");
      mkdirSync(parentDir, { recursive: true });
    }

    writeFileSync(fullPath, content, "utf-8");

    return {
      path: this.getRelativePath(fullPath),
      name: basename(fullPath, ".md"),
      content,
      modifiedAt: new Date(),
    };
  }

  /**
   * Update an existing note (replace content)
   *
   * @param notePath - Path to the note
   * @param content - New content
   * @returns The updated note
   */
  async updateNote(notePath: string, content: string): Promise<ObsidianNote> {
    const fullPath = this.resolvePath(this.ensureMdExtension(notePath));

    if (!existsSync(fullPath)) {
      throw new Error(`Note not found: ${notePath}`);
    }

    writeFileSync(fullPath, content, "utf-8");

    return {
      path: this.getRelativePath(fullPath),
      name: basename(fullPath, ".md"),
      content,
      modifiedAt: new Date(),
    };
  }

  /**
   * Append content to an existing note
   *
   * @param notePath - Path to the note
   * @param content - Content to append
   * @returns The updated note
   */
  async appendToNote(notePath: string, content: string): Promise<ObsidianNote> {
    const fullPath = this.resolvePath(this.ensureMdExtension(notePath));

    if (!existsSync(fullPath)) {
      throw new Error(`Note not found: ${notePath}`);
    }

    // Add newline before appending if needed
    const existingContent = readFileSync(fullPath, "utf-8");
    const separator = existingContent.endsWith("\n") ? "" : "\n";

    appendFileSync(fullPath, separator + content, "utf-8");

    const newContent = readFileSync(fullPath, "utf-8");

    return {
      path: this.getRelativePath(fullPath),
      name: basename(fullPath, ".md"),
      content: newContent,
      modifiedAt: new Date(),
    };
  }

  /**
   * Delete a note
   *
   * @param notePath - Path to the note
   * @returns Success status
   */
  async deleteNote(notePath: string): Promise<{ success: boolean }> {
    const fullPath = this.resolvePath(this.ensureMdExtension(notePath));

    if (!existsSync(fullPath)) {
      throw new Error(`Note not found: ${notePath}`);
    }

    unlinkSync(fullPath);

    return { success: true };
  }

  // ==========================================================================
  // Navigation Operations (opens in Obsidian app)
  // ==========================================================================

  /**
   * Open a note in the Obsidian app
   *
   * @param notePath - Path to the note
   * @returns Success status
   */
  async openNote(notePath: string): Promise<{ success: boolean }> {
    const fullPath = this.resolvePath(this.ensureMdExtension(notePath));
    const relativePath = this.getRelativePath(fullPath);

    try {
      // Use obs CLI to open the note
      await this.execObs(["open", relativePath]);
      return { success: true };
    } catch (error) {
      // Fallback: try using obsidian:// URI scheme
      const vaultName = basename(this.vaultPath);
      const uri = `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(relativePath)}`;

      const { exec } = await import("child_process");
      return new Promise((resolve) => {
        exec(`open "${uri}"`, (error) => {
          resolve({ success: !error });
        });
      });
    }
  }

  /**
   * Open the vault in the Obsidian app
   *
   * @param vaultName - Optional vault name (uses configured vault if not specified)
   * @returns Success status
   */
  async openVault(vaultName?: string): Promise<{ success: boolean }> {
    const name = vaultName || basename(this.vaultPath);

    try {
      // Use obs CLI to open the vault
      await this.execObs(["open", "--vault", name]);
      return { success: true };
    } catch (error) {
      // Fallback: try using obsidian:// URI scheme
      const uri = `obsidian://open?vault=${encodeURIComponent(name)}`;

      const { exec } = await import("child_process");
      return new Promise((resolve) => {
        exec(`open "${uri}"`, (error) => {
          resolve({ success: !error });
        });
      });
    }
  }
}

// ============================================================================
// Singleton Pattern
// ============================================================================

let _obsidianService: ObsidianService | null = null;

/**
 * Get the Obsidian service instance (singleton)
 * Creates the service if not already initialized.
 *
 * @throws Error if Obsidian vault is not configured
 */
export function getObsidianService(): ObsidianService {
  if (!_obsidianService) {
    _obsidianService = new ObsidianService();
  }
  return _obsidianService;
}

/**
 * Reset the Obsidian service (for testing)
 */
export function resetObsidianService(): void {
  _obsidianService = null;
}
