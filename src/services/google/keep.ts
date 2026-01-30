/**
 * Google Keep Service
 *
 * Wraps the GOG CLI (gog keep) for Keep operations.
 * Provides typed interface for reading notes.
 */

import { GoogleBaseService, type GoogleServiceOptions } from "./base";

// ============================================================================
// Types
// ============================================================================

export interface KeepNote {
  name: string;
  createTime?: string;
  updateTime?: string;
  trashTime?: string;
  trashed?: boolean;
  title?: string;
  body?: NoteBody;
  color?: string;
  permissions?: Permission[];
  attachments?: Attachment[];
}

export interface NoteBody {
  text?: TextContent;
  list?: ListContent;
}

export interface TextContent {
  text?: string;
}

export interface ListContent {
  listItems?: ListItem[];
}

export interface ListItem {
  text?: TextContent;
  checked?: boolean;
  childListItems?: ListItem[];
}

export interface Permission {
  email?: string;
  name?: string;
  role?: string;
  deleted?: boolean;
}

export interface Attachment {
  name?: string;
  mimeType?: string[];
}

export interface KeepLabel {
  name: string;
  labelName?: string;
}

// ============================================================================
// Google Keep Service
// ============================================================================

export class GoogleKeepService extends GoogleBaseService {
  protected readonly serviceCommand = "keep";

  constructor(options?: GoogleServiceOptions) {
    super(options);
  }

  // ==========================================================================
  // Read Operations
  // ==========================================================================

  /**
   * List all notes
   *
   * @param options - Query options
   * @returns Array of notes
   */
  async listNotes(options?: {
    filter?: string;
    pageSize?: number;
    pageToken?: string;
  }): Promise<KeepNote[]> {
    const args = ["notes", "list"];

    if (options?.filter) {
      args.push("--filter", options.filter);
    }
    if (options?.pageSize) {
      args.push("--page-size", String(options.pageSize));
    }
    if (options?.pageToken) {
      args.push("--page-token", options.pageToken);
    }

    const result = (await this.execGog(args)) as { notes?: unknown[] };
    const notes = result.notes || [];
    return notes.map((n) => this.parseNote(n));
  }

  /**
   * Get a single note by name
   *
   * @param noteName - Note resource name (e.g., "notes/abc123")
   * @returns Note details
   */
  async getNote(noteName: string): Promise<KeepNote> {
    const args = ["notes", "get", noteName];
    const result = await this.execGog(args);
    return this.parseNote(result);
  }

  /**
   * Search notes by content or title
   *
   * @param query - Search query
   * @param options - Additional options
   * @returns Matching notes
   */
  async searchNotes(
    query: string,
    options?: {
      pageSize?: number;
    }
  ): Promise<KeepNote[]> {
    // Keep API uses filter syntax for search
    // We search in title and body text
    const filter = `contains("${query.replace(/"/g, '\\"')}")`;
    return this.listNotes({
      filter,
      pageSize: options?.pageSize || 20,
    });
  }

  /**
   * List all labels
   *
   * @returns Array of labels
   */
  async listLabels(): Promise<KeepLabel[]> {
    const args = ["labels", "list"];
    const result = (await this.execGog(args)) as { labels?: unknown[] };
    const labels = result.labels || [];
    return labels.map((l) => this.parseLabel(l));
  }

  /**
   * List notes by label
   *
   * @param labelName - Label name
   * @param options - Additional options
   * @returns Notes with the specified label
   */
  async listNotesByLabel(
    labelName: string,
    options?: {
      pageSize?: number;
    }
  ): Promise<KeepNote[]> {
    const filter = `label:"${labelName.replace(/"/g, '\\"')}"`;
    return this.listNotes({
      filter,
      pageSize: options?.pageSize,
    });
  }

  // ==========================================================================
  // Parsing Helpers
  // ==========================================================================

  private parseNote(raw: unknown): KeepNote {
    const n = raw as Record<string, unknown>;
    return {
      name: String(n.name || ""),
      createTime: n.createTime ? String(n.createTime) : undefined,
      updateTime: n.updateTime ? String(n.updateTime) : undefined,
      trashTime: n.trashTime ? String(n.trashTime) : undefined,
      trashed: typeof n.trashed === "boolean" ? n.trashed : undefined,
      title: n.title ? String(n.title) : undefined,
      body: n.body ? this.parseBody(n.body) : undefined,
      color: n.color ? String(n.color) : undefined,
      permissions: Array.isArray(n.permissions)
        ? n.permissions.map((p: unknown) => this.parsePermission(p))
        : undefined,
      attachments: Array.isArray(n.attachments)
        ? n.attachments.map((a: unknown) => this.parseAttachment(a))
        : undefined,
    };
  }

  private parseBody(raw: unknown): NoteBody {
    const b = raw as Record<string, unknown>;
    return {
      text: b.text ? this.parseTextContent(b.text) : undefined,
      list: b.list ? this.parseListContent(b.list) : undefined,
    };
  }

  private parseTextContent(raw: unknown): TextContent {
    const t = raw as Record<string, unknown>;
    return {
      text: t.text ? String(t.text) : undefined,
    };
  }

  private parseListContent(raw: unknown): ListContent {
    const l = raw as Record<string, unknown>;
    return {
      listItems: Array.isArray(l.listItems)
        ? l.listItems.map((i: unknown) => this.parseListItem(i))
        : undefined,
    };
  }

  private parseListItem(raw: unknown): ListItem {
    const i = raw as Record<string, unknown>;
    return {
      text: i.text ? this.parseTextContent(i.text) : undefined,
      checked: typeof i.checked === "boolean" ? i.checked : undefined,
      childListItems: Array.isArray(i.childListItems)
        ? i.childListItems.map((c: unknown) => this.parseListItem(c))
        : undefined,
    };
  }

  private parsePermission(raw: unknown): Permission {
    const p = raw as Record<string, unknown>;
    return {
      email: p.email ? String(p.email) : undefined,
      name: p.name ? String(p.name) : undefined,
      role: p.role ? String(p.role) : undefined,
      deleted: typeof p.deleted === "boolean" ? p.deleted : undefined,
    };
  }

  private parseAttachment(raw: unknown): Attachment {
    const a = raw as Record<string, unknown>;
    return {
      name: a.name ? String(a.name) : undefined,
      mimeType: Array.isArray(a.mimeType)
        ? a.mimeType.map((m: unknown) => String(m))
        : undefined,
    };
  }

  private parseLabel(raw: unknown): KeepLabel {
    const l = raw as Record<string, unknown>;
    return {
      name: String(l.name || ""),
      labelName: l.labelName ? String(l.labelName) : undefined,
    };
  }

  /**
   * Extract plain text from a note
   *
   * @param note - Note to extract text from
   * @returns Plain text content
   */
  extractText(note: KeepNote): string {
    const parts: string[] = [];

    if (note.title) {
      parts.push(note.title);
    }

    if (note.body?.text?.text) {
      parts.push(note.body.text.text);
    }

    if (note.body?.list?.listItems) {
      const listText = this.extractListText(note.body.list.listItems, 0);
      if (listText) {
        parts.push(listText);
      }
    }

    return parts.join("\n\n");
  }

  private extractListText(items: ListItem[], indent: number): string {
    return items
      .map((item) => {
        const prefix = "  ".repeat(indent) + (item.checked ? "[x]" : "[ ]");
        const text = item.text?.text || "";
        let line = `${prefix} ${text}`;

        if (item.childListItems && item.childListItems.length > 0) {
          line += "\n" + this.extractListText(item.childListItems, indent + 1);
        }

        return line;
      })
      .join("\n");
  }
}

// ============================================================================
// Singleton Pattern
// ============================================================================

let _keepService: GoogleKeepService | null = null;

/**
 * Get the Keep service instance (singleton)
 */
export function getKeepService(): GoogleKeepService {
  if (!_keepService) {
    _keepService = new GoogleKeepService();
  }
  return _keepService;
}

/**
 * Reset the Keep service (for testing)
 */
export function resetKeepService(): void {
  _keepService = null;
}
