/**
 * Filesystem Executor
 *
 * Executes filesystem operations based on JSON configuration.
 * Provides secure file access with path validation to prevent directory traversal.
 */

import {
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  unlinkSync,
  statSync,
  mkdirSync,
} from "fs";
import { join, dirname, relative, basename, resolve, normalize } from "path";
import type { ServiceFilesystem, ToolFilesystem } from "./schema";
import { getConfigValue } from "./cli-executor";

// ============================================================================
// Types
// ============================================================================

export interface FilesystemResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface FileInfo {
  path: string;
  name: string;
  isDirectory: boolean;
  modifiedAt?: Date;
  size?: number;
}

export interface FileWithContent extends FileInfo {
  content?: string;
}

export interface SearchResult {
  path: string;
  name: string;
  snippet?: string;
}

// ============================================================================
// Path Validation
// ============================================================================

/**
 * Resolve the base path from configuration
 */
export function resolveBasePath(filesystem: ServiceFilesystem): string {
  const configValue = getConfigValue(filesystem.basePath);
  if (!configValue || typeof configValue !== "string") {
    throw new Error(`Config path "${filesystem.basePath}" not found or not a string`);
  }
  return configValue;
}

/**
 * Validate and resolve a path to ensure it stays within the base directory
 * @throws Error if the path would escape the base directory
 */
export function validatePath(basePath: string, relativePath: string): string {
  // Normalize and resolve the full path
  const normalizedBase = normalize(resolve(basePath));
  const fullPath = normalize(resolve(basePath, relativePath));

  // Ensure the resolved path starts with the base path
  if (!fullPath.startsWith(normalizedBase)) {
    throw new Error(`Path escapes base directory: ${relativePath}`);
  }

  return fullPath;
}

/**
 * Get the relative path from the base directory
 */
function getRelativePath(basePath: string, fullPath: string): string {
  return relative(basePath, fullPath);
}

/**
 * Ensure the file has the configured extension
 */
function ensureExtension(path: string, extension?: string): string {
  if (!extension) {
    return path;
  }
  if (!path.endsWith(extension)) {
    return path + extension;
  }
  return path;
}

// ============================================================================
// Filesystem Operations
// ============================================================================

/**
 * Read a file's content
 */
async function readFile(
  basePath: string,
  filePath: string,
  extension?: string
): Promise<FileWithContent> {
  const pathWithExt = ensureExtension(filePath, extension);
  const fullPath = validatePath(basePath, pathWithExt);

  if (!existsSync(fullPath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const content = readFileSync(fullPath, "utf-8");
  const stats = statSync(fullPath);

  return {
    path: getRelativePath(basePath, fullPath),
    name: basename(fullPath, extension || ""),
    isDirectory: false,
    content,
    modifiedAt: stats.mtime,
    size: stats.size,
  };
}

/**
 * Write content to a file (creates or overwrites)
 */
async function writeFile(
  basePath: string,
  filePath: string,
  content: string,
  extension?: string
): Promise<FileWithContent> {
  const pathWithExt = ensureExtension(filePath, extension);
  const fullPath = validatePath(basePath, pathWithExt);

  // Ensure parent directory exists
  const parentDir = dirname(fullPath);
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
  }

  writeFileSync(fullPath, content, "utf-8");

  return {
    path: getRelativePath(basePath, fullPath),
    name: basename(fullPath, extension || ""),
    isDirectory: false,
    content,
    modifiedAt: new Date(),
  };
}

/**
 * Append content to a file
 */
async function appendToFile(
  basePath: string,
  filePath: string,
  content: string,
  extension?: string
): Promise<FileWithContent> {
  const pathWithExt = ensureExtension(filePath, extension);
  const fullPath = validatePath(basePath, pathWithExt);

  if (!existsSync(fullPath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  // Add newline separator if needed
  const existingContent = readFileSync(fullPath, "utf-8");
  const separator = existingContent.endsWith("\n") ? "" : "\n";

  appendFileSync(fullPath, separator + content, "utf-8");

  const newContent = readFileSync(fullPath, "utf-8");

  return {
    path: getRelativePath(basePath, fullPath),
    name: basename(fullPath, extension || ""),
    isDirectory: false,
    content: newContent,
    modifiedAt: new Date(),
  };
}

/**
 * Delete a file
 */
async function deleteFile(
  basePath: string,
  filePath: string,
  extension?: string
): Promise<{ success: boolean }> {
  const pathWithExt = ensureExtension(filePath, extension);
  const fullPath = validatePath(basePath, pathWithExt);

  if (!existsSync(fullPath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  unlinkSync(fullPath);

  return { success: true };
}

/**
 * List files in a directory
 */
async function listDirectory(
  basePath: string,
  dirPath: string,
  extension?: string
): Promise<FileInfo[]> {
  const fullPath = validatePath(basePath, dirPath || ".");

  if (!existsSync(fullPath)) {
    throw new Error(`Directory not found: ${dirPath}`);
  }

  const stats = statSync(fullPath);
  if (!stats.isDirectory()) {
    throw new Error(`Path is not a directory: ${dirPath}`);
  }

  const entries = readdirSync(fullPath, { withFileTypes: true });
  const files: FileInfo[] = [];

  for (const entry of entries) {
    // Skip hidden files
    if (entry.name.startsWith(".")) {
      continue;
    }

    // Filter by extension if specified
    if (extension && entry.isFile() && !entry.name.endsWith(extension)) {
      continue;
    }

    const entryPath = join(fullPath, entry.name);
    const entryStats = statSync(entryPath);

    files.push({
      path: getRelativePath(basePath, entryPath),
      name: entry.isFile() ? basename(entry.name, extension || "") : entry.name,
      isDirectory: entry.isDirectory(),
      modifiedAt: entryStats.mtime,
      size: entryStats.size,
    });
  }

  return files;
}

/**
 * Search for files by name
 */
async function searchByName(
  basePath: string,
  query: string,
  extension?: string,
  limit = 20
): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  const queryLower = query.toLowerCase();

  function searchDir(dir: string): void {
    if (results.length >= limit) return;

    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (results.length >= limit) break;

      const fullPath = join(dir, entry.name);

      // Skip hidden files/folders
      if (entry.name.startsWith(".")) continue;

      if (entry.isDirectory()) {
        searchDir(fullPath);
      } else if (entry.isFile()) {
        // Check extension if specified
        if (extension && !entry.name.endsWith(extension)) continue;

        const name = basename(entry.name, extension || "");
        if (name.toLowerCase().includes(queryLower)) {
          results.push({
            path: getRelativePath(basePath, fullPath),
            name,
          });
        }
      }
    }
  }

  searchDir(basePath);
  return results;
}

/**
 * Search within file content
 */
async function searchContent(
  basePath: string,
  query: string,
  extension?: string,
  limit = 20
): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  const queryLower = query.toLowerCase();

  function searchDir(dir: string): void {
    if (results.length >= limit) return;

    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (results.length >= limit) break;

      const fullPath = join(dir, entry.name);

      // Skip hidden files/folders
      if (entry.name.startsWith(".")) continue;

      if (entry.isDirectory()) {
        searchDir(fullPath);
      } else if (entry.isFile()) {
        // Check extension if specified
        if (extension && !entry.name.endsWith(extension)) continue;

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
              path: getRelativePath(basePath, fullPath),
              name: basename(entry.name, extension || ""),
              snippet: (start > 0 ? "..." : "") + snippet + (end < content.length ? "..." : ""),
            });
          }
        } catch {
          // Skip files that can't be read
        }
      }
    }
  }

  searchDir(basePath);
  return results;
}

// ============================================================================
// Main Executor
// ============================================================================

/**
 * Execute a filesystem operation based on configuration
 *
 * @param serviceFilesystem - Service-level filesystem configuration
 * @param toolFilesystem - Tool-level filesystem configuration
 * @param params - Parameter values from the tool call
 * @returns Operation result
 */
export async function executeFilesystemOperation(
  serviceFilesystem: ServiceFilesystem,
  toolFilesystem: ToolFilesystem,
  params: Record<string, unknown>
): Promise<unknown> {
  // Resolve base path from config
  const basePath = resolveBasePath(serviceFilesystem);
  const extension = serviceFilesystem.extension;

  // Extract parameters
  const pathParam = toolFilesystem.path
    ? String(params[toolFilesystem.path.replace(/[{}]/g, "")] || "")
    : "";
  const contentParam = toolFilesystem.contentParam
    ? String(params[toolFilesystem.contentParam] || "")
    : "";
  const queryParam = toolFilesystem.queryParam
    ? String(params[toolFilesystem.queryParam] || "")
    : "";
  const limitParam = toolFilesystem.limitParam
    ? Number(params[toolFilesystem.limitParam]) || 20
    : 20;

  switch (toolFilesystem.operation) {
    case "read":
      return readFile(basePath, pathParam, extension);

    case "write":
      return writeFile(basePath, pathParam, contentParam, extension);

    case "append":
      return appendToFile(basePath, pathParam, contentParam, extension);

    case "delete":
      return deleteFile(basePath, pathParam, extension);

    case "list":
      return listDirectory(basePath, pathParam, extension);

    case "search":
      return searchByName(basePath, queryParam, extension, limitParam);

    case "searchContent":
      return searchContent(basePath, queryParam, extension, limitParam);

    default:
      throw new Error(`Unknown filesystem operation: ${toolFilesystem.operation}`);
  }
}
