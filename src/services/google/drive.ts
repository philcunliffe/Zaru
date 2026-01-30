/**
 * Google Drive Service
 *
 * Wraps the GOG CLI (gog drive) for Drive operations.
 * Provides typed interface for files and folders.
 */

import { GoogleBaseService, type GoogleServiceOptions } from "./base";

// ============================================================================
// Types
// ============================================================================

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  description?: string;
  starred?: boolean;
  trashed?: boolean;
  parents?: string[];
  createdTime?: string;
  modifiedTime?: string;
  viewedByMeTime?: string;
  size?: string;
  webViewLink?: string;
  webContentLink?: string;
  iconLink?: string;
  thumbnailLink?: string;
  owners?: Array<{
    displayName?: string;
    emailAddress?: string;
  }>;
  lastModifyingUser?: {
    displayName?: string;
    emailAddress?: string;
  };
  shared?: boolean;
  capabilities?: {
    canEdit?: boolean;
    canComment?: boolean;
    canShare?: boolean;
    canDownload?: boolean;
  };
}

// MIME types for common Google file types
export const DRIVE_MIME_TYPES = {
  FOLDER: "application/vnd.google-apps.folder",
  DOCUMENT: "application/vnd.google-apps.document",
  SPREADSHEET: "application/vnd.google-apps.spreadsheet",
  PRESENTATION: "application/vnd.google-apps.presentation",
  FORM: "application/vnd.google-apps.form",
  DRAWING: "application/vnd.google-apps.drawing",
  SCRIPT: "application/vnd.google-apps.script",
} as const;

// ============================================================================
// Google Drive Service
// ============================================================================

export class GoogleDriveService extends GoogleBaseService {
  protected readonly serviceCommand = "drive";

  constructor(options?: GoogleServiceOptions) {
    super(options);
  }

  // ==========================================================================
  // Read Operations
  // ==========================================================================

  /**
   * List files and folders
   *
   * @param options - Query options
   * @returns Array of files
   */
  async listFiles(options?: {
    folderId?: string;
    query?: string;
    pageSize?: number;
    pageToken?: string;
    orderBy?: string;
  }): Promise<DriveFile[]> {
    const args = ["files", "list"];

    if (options?.folderId) {
      args.push("--parent", options.folderId);
    }
    if (options?.query) {
      args.push("--query", options.query);
    }
    if (options?.pageSize) {
      args.push("--page-size", String(options.pageSize));
    }
    if (options?.pageToken) {
      args.push("--page-token", options.pageToken);
    }
    if (options?.orderBy) {
      args.push("--order-by", options.orderBy);
    }

    const result = (await this.execGog(args)) as { files?: unknown[] };
    const files = result.files || [];
    return files.map((f) => this.parseFile(f));
  }

  /**
   * Get a single file by ID
   *
   * @param fileId - File ID
   * @returns File metadata
   */
  async getFile(fileId: string): Promise<DriveFile> {
    const args = ["files", "get", fileId];
    const result = await this.execGog(args);
    return this.parseFile(result);
  }

  /**
   * Search for files
   *
   * @param query - Search query (name, content, etc.)
   * @param options - Additional options
   * @returns Matching files
   */
  async searchFiles(
    query: string,
    options?: {
      mimeType?: string;
      pageSize?: number;
    }
  ): Promise<DriveFile[]> {
    // Build a Drive query string
    let driveQuery = `name contains '${query.replace(/'/g, "\\'")}'`;
    if (options?.mimeType) {
      driveQuery += ` and mimeType = '${options.mimeType}'`;
    }
    driveQuery += " and trashed = false";

    return this.listFiles({
      query: driveQuery,
      pageSize: options?.pageSize || 20,
    });
  }

  /**
   * Get file content (for text files, Google Docs, etc.)
   *
   * @param fileId - File ID
   * @param exportMimeType - MIME type to export as (for Google Docs)
   * @returns File content as string
   */
  async getFileContent(
    fileId: string,
    exportMimeType?: string
  ): Promise<string> {
    const args = ["files", "download", fileId, "--stdout"];

    if (exportMimeType) {
      args.push("--export-mime-type", exportMimeType);
    }

    return this.execGogText(args);
  }

  /**
   * List only folders
   *
   * @param options - Query options
   * @returns Array of folders
   */
  async listFolders(options?: {
    parentId?: string;
    pageSize?: number;
  }): Promise<DriveFile[]> {
    const query = `mimeType = '${DRIVE_MIME_TYPES.FOLDER}' and trashed = false`;
    return this.listFiles({
      folderId: options?.parentId,
      query,
      pageSize: options?.pageSize,
    });
  }

  /**
   * List recent files
   *
   * @param pageSize - Number of files to return
   * @returns Recent files
   */
  async listRecentFiles(pageSize = 20): Promise<DriveFile[]> {
    return this.listFiles({
      pageSize,
      orderBy: "modifiedTime desc",
    });
  }

  // ==========================================================================
  // Parsing Helpers
  // ==========================================================================

  private parseFile(raw: unknown): DriveFile {
    const f = raw as Record<string, unknown>;
    return {
      id: String(f.id || ""),
      name: String(f.name || ""),
      mimeType: String(f.mimeType || ""),
      description: f.description ? String(f.description) : undefined,
      starred: typeof f.starred === "boolean" ? f.starred : undefined,
      trashed: typeof f.trashed === "boolean" ? f.trashed : undefined,
      parents: Array.isArray(f.parents)
        ? f.parents.map((p: unknown) => String(p))
        : undefined,
      createdTime: f.createdTime ? String(f.createdTime) : undefined,
      modifiedTime: f.modifiedTime ? String(f.modifiedTime) : undefined,
      viewedByMeTime: f.viewedByMeTime ? String(f.viewedByMeTime) : undefined,
      size: f.size ? String(f.size) : undefined,
      webViewLink: f.webViewLink ? String(f.webViewLink) : undefined,
      webContentLink: f.webContentLink ? String(f.webContentLink) : undefined,
      iconLink: f.iconLink ? String(f.iconLink) : undefined,
      thumbnailLink: f.thumbnailLink ? String(f.thumbnailLink) : undefined,
      owners: Array.isArray(f.owners)
        ? f.owners.map((o: unknown) => this.parseUser(o))
        : undefined,
      lastModifyingUser: f.lastModifyingUser
        ? this.parseUser(f.lastModifyingUser)
        : undefined,
      shared: typeof f.shared === "boolean" ? f.shared : undefined,
      capabilities: f.capabilities
        ? this.parseCapabilities(f.capabilities)
        : undefined,
    };
  }

  private parseUser(raw: unknown): {
    displayName?: string;
    emailAddress?: string;
  } {
    const u = raw as Record<string, unknown>;
    return {
      displayName: u.displayName ? String(u.displayName) : undefined,
      emailAddress: u.emailAddress ? String(u.emailAddress) : undefined,
    };
  }

  private parseCapabilities(raw: unknown): {
    canEdit?: boolean;
    canComment?: boolean;
    canShare?: boolean;
    canDownload?: boolean;
  } {
    const c = raw as Record<string, unknown>;
    return {
      canEdit: typeof c.canEdit === "boolean" ? c.canEdit : undefined,
      canComment: typeof c.canComment === "boolean" ? c.canComment : undefined,
      canShare: typeof c.canShare === "boolean" ? c.canShare : undefined,
      canDownload: typeof c.canDownload === "boolean" ? c.canDownload : undefined,
    };
  }
}

// ============================================================================
// Singleton Pattern
// ============================================================================

let _driveService: GoogleDriveService | null = null;

/**
 * Get the Drive service instance (singleton)
 */
export function getDriveService(): GoogleDriveService {
  if (!_driveService) {
    _driveService = new GoogleDriveService();
  }
  return _driveService;
}

/**
 * Reset the Drive service (for testing)
 */
export function resetDriveService(): void {
  _driveService = null;
}
