/**
 * Google Docs Service
 *
 * Wraps the GOG CLI (gog docs) for Docs operations.
 * Provides typed interface for reading document content.
 */

import { GoogleBaseService, type GoogleServiceOptions } from "./base";
import { GoogleDriveService, DRIVE_MIME_TYPES } from "./drive";

// ============================================================================
// Types
// ============================================================================

export interface GoogleDoc {
  documentId: string;
  title: string;
  revisionId?: string;
  body?: DocumentBody;
}

export interface DocumentBody {
  content?: StructuralElement[];
}

export interface StructuralElement {
  startIndex?: number;
  endIndex?: number;
  paragraph?: Paragraph;
  sectionBreak?: SectionBreak;
  table?: Table;
  tableOfContents?: TableOfContents;
}

export interface Paragraph {
  elements?: ParagraphElement[];
  paragraphStyle?: {
    namedStyleType?: string;
    headingId?: string;
  };
}

export interface ParagraphElement {
  startIndex?: number;
  endIndex?: number;
  textRun?: TextRun;
}

export interface TextRun {
  content?: string;
  textStyle?: {
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strikethrough?: boolean;
    link?: {
      url?: string;
    };
  };
}

export interface SectionBreak {
  sectionStyle?: {
    sectionType?: string;
  };
}

export interface Table {
  rows?: number;
  columns?: number;
  tableRows?: TableRow[];
}

export interface TableRow {
  tableCells?: TableCell[];
}

export interface TableCell {
  content?: StructuralElement[];
}

export interface TableOfContents {
  content?: StructuralElement[];
}

// ============================================================================
// Google Docs Service
// ============================================================================

export class GoogleDocsService extends GoogleBaseService {
  protected readonly serviceCommand = "docs";
  private driveService?: GoogleDriveService;

  constructor(options?: GoogleServiceOptions) {
    super(options);
  }

  private getDriveService(): GoogleDriveService {
    if (!this.driveService) {
      this.driveService = new GoogleDriveService({
        account: this.account,
        gogPath: this.gogPath,
      });
    }
    return this.driveService;
  }

  // ==========================================================================
  // Read Operations
  // ==========================================================================

  /**
   * Get a document's full structure
   *
   * @param documentId - Document ID
   * @returns Document with body content
   */
  async getDocument(documentId: string): Promise<GoogleDoc> {
    const args = ["get", documentId];
    const result = await this.execGog(args);
    return this.parseDocument(result);
  }

  /**
   * Search for documents by name (via Drive API)
   *
   * @param query - Search query
   * @param options - Additional options
   * @returns Matching documents (metadata only)
   */
  async searchDocuments(
    query: string,
    options?: {
      pageSize?: number;
    }
  ): Promise<Array<{ id: string; name: string; modifiedTime?: string }>> {
    const drive = this.getDriveService();
    const files = await drive.searchFiles(query, {
      mimeType: DRIVE_MIME_TYPES.DOCUMENT,
      pageSize: options?.pageSize || 20,
    });

    return files.map((f) => ({
      id: f.id,
      name: f.name,
      modifiedTime: f.modifiedTime,
    }));
  }

  /**
   * Get document content as plain text
   *
   * @param documentId - Document ID
   * @returns Plain text content
   */
  async getDocumentText(documentId: string): Promise<string> {
    const drive = this.getDriveService();
    return drive.getFileContent(documentId, "text/plain");
  }

  /**
   * Extract all text from a document structure
   *
   * @param doc - Document to extract text from
   * @returns Plain text content
   */
  extractText(doc: GoogleDoc): string {
    if (!doc.body?.content) {
      return "";
    }

    const texts: string[] = [];
    for (const element of doc.body.content) {
      const text = this.extractTextFromElement(element);
      if (text) {
        texts.push(text);
      }
    }
    return texts.join("");
  }

  // ==========================================================================
  // Parsing Helpers
  // ==========================================================================

  private parseDocument(raw: unknown): GoogleDoc {
    const d = raw as Record<string, unknown>;
    return {
      documentId: String(d.documentId || ""),
      title: String(d.title || ""),
      revisionId: d.revisionId ? String(d.revisionId) : undefined,
      body: d.body ? this.parseBody(d.body) : undefined,
    };
  }

  private parseBody(raw: unknown): DocumentBody {
    const b = raw as Record<string, unknown>;
    return {
      content: Array.isArray(b.content)
        ? b.content.map((c: unknown) => this.parseStructuralElement(c))
        : undefined,
    };
  }

  private parseStructuralElement(raw: unknown): StructuralElement {
    const e = raw as Record<string, unknown>;
    return {
      startIndex: typeof e.startIndex === "number" ? e.startIndex : undefined,
      endIndex: typeof e.endIndex === "number" ? e.endIndex : undefined,
      paragraph: e.paragraph ? this.parseParagraph(e.paragraph) : undefined,
      sectionBreak: e.sectionBreak
        ? this.parseSectionBreak(e.sectionBreak)
        : undefined,
      table: e.table ? this.parseTable(e.table) : undefined,
      tableOfContents: e.tableOfContents
        ? this.parseTableOfContents(e.tableOfContents)
        : undefined,
    };
  }

  private parseParagraph(raw: unknown): Paragraph {
    const p = raw as Record<string, unknown>;
    return {
      elements: Array.isArray(p.elements)
        ? p.elements.map((e: unknown) => this.parseParagraphElement(e))
        : undefined,
      paragraphStyle: p.paragraphStyle
        ? this.parseParagraphStyle(p.paragraphStyle)
        : undefined,
    };
  }

  private parseParagraphStyle(raw: unknown): {
    namedStyleType?: string;
    headingId?: string;
  } {
    const s = raw as Record<string, unknown>;
    return {
      namedStyleType: s.namedStyleType ? String(s.namedStyleType) : undefined,
      headingId: s.headingId ? String(s.headingId) : undefined,
    };
  }

  private parseParagraphElement(raw: unknown): ParagraphElement {
    const e = raw as Record<string, unknown>;
    return {
      startIndex: typeof e.startIndex === "number" ? e.startIndex : undefined,
      endIndex: typeof e.endIndex === "number" ? e.endIndex : undefined,
      textRun: e.textRun ? this.parseTextRun(e.textRun) : undefined,
    };
  }

  private parseTextRun(raw: unknown): TextRun {
    const t = raw as Record<string, unknown>;
    return {
      content: t.content ? String(t.content) : undefined,
      textStyle: t.textStyle ? this.parseTextStyle(t.textStyle) : undefined,
    };
  }

  private parseTextStyle(raw: unknown): {
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strikethrough?: boolean;
    link?: { url?: string };
  } {
    const s = raw as Record<string, unknown>;
    return {
      bold: typeof s.bold === "boolean" ? s.bold : undefined,
      italic: typeof s.italic === "boolean" ? s.italic : undefined,
      underline: typeof s.underline === "boolean" ? s.underline : undefined,
      strikethrough:
        typeof s.strikethrough === "boolean" ? s.strikethrough : undefined,
      link: s.link
        ? { url: (s.link as Record<string, unknown>).url ? String((s.link as Record<string, unknown>).url) : undefined }
        : undefined,
    };
  }

  private parseSectionBreak(raw: unknown): SectionBreak {
    const s = raw as Record<string, unknown>;
    const sectionStyle = s.sectionStyle as Record<string, unknown> | undefined;
    return {
      sectionStyle: sectionStyle
        ? {
            sectionType: sectionStyle.sectionType
              ? String(sectionStyle.sectionType)
              : undefined,
          }
        : undefined,
    };
  }

  private parseTable(raw: unknown): Table {
    const t = raw as Record<string, unknown>;
    return {
      rows: typeof t.rows === "number" ? t.rows : undefined,
      columns: typeof t.columns === "number" ? t.columns : undefined,
      tableRows: Array.isArray(t.tableRows)
        ? t.tableRows.map((r: unknown) => this.parseTableRow(r))
        : undefined,
    };
  }

  private parseTableRow(raw: unknown): TableRow {
    const r = raw as Record<string, unknown>;
    return {
      tableCells: Array.isArray(r.tableCells)
        ? r.tableCells.map((c: unknown) => this.parseTableCell(c))
        : undefined,
    };
  }

  private parseTableCell(raw: unknown): TableCell {
    const c = raw as Record<string, unknown>;
    return {
      content: Array.isArray(c.content)
        ? c.content.map((e: unknown) => this.parseStructuralElement(e))
        : undefined,
    };
  }

  private parseTableOfContents(raw: unknown): TableOfContents {
    const t = raw as Record<string, unknown>;
    return {
      content: Array.isArray(t.content)
        ? t.content.map((e: unknown) => this.parseStructuralElement(e))
        : undefined,
    };
  }

  private extractTextFromElement(element: StructuralElement): string {
    if (element.paragraph) {
      return this.extractTextFromParagraph(element.paragraph);
    }
    if (element.table) {
      return this.extractTextFromTable(element.table);
    }
    if (element.tableOfContents) {
      return this.extractTextFromTableOfContents(element.tableOfContents);
    }
    return "";
  }

  private extractTextFromParagraph(paragraph: Paragraph): string {
    if (!paragraph.elements) {
      return "";
    }
    return paragraph.elements
      .map((e) => e.textRun?.content || "")
      .join("");
  }

  private extractTextFromTable(table: Table): string {
    if (!table.tableRows) {
      return "";
    }
    return table.tableRows
      .map((row) =>
        row.tableCells
          ?.map((cell) =>
            cell.content?.map((e) => this.extractTextFromElement(e)).join("") ||
            ""
          )
          .join("\t") || ""
      )
      .join("\n");
  }

  private extractTextFromTableOfContents(toc: TableOfContents): string {
    if (!toc.content) {
      return "";
    }
    return toc.content.map((e) => this.extractTextFromElement(e)).join("");
  }
}

// ============================================================================
// Singleton Pattern
// ============================================================================

let _docsService: GoogleDocsService | null = null;

/**
 * Get the Docs service instance (singleton)
 */
export function getDocsService(): GoogleDocsService {
  if (!_docsService) {
    _docsService = new GoogleDocsService();
  }
  return _docsService;
}

/**
 * Reset the Docs service (for testing)
 */
export function resetDocsService(): void {
  _docsService = null;
}
