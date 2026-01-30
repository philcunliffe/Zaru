/**
 * Google Sheets Service
 *
 * Wraps the GOG CLI (gog sheets) for Sheets operations.
 * Provides typed interface for reading spreadsheet data.
 */

import { GoogleBaseService, type GoogleServiceOptions } from "./base";
import { GoogleDriveService, DRIVE_MIME_TYPES } from "./drive";

// ============================================================================
// Types
// ============================================================================

export interface Spreadsheet {
  spreadsheetId: string;
  properties: SpreadsheetProperties;
  sheets?: Sheet[];
  spreadsheetUrl?: string;
}

export interface SpreadsheetProperties {
  title: string;
  locale?: string;
  autoRecalc?: string;
  timeZone?: string;
}

export interface Sheet {
  properties: SheetProperties;
  data?: GridData[];
}

export interface SheetProperties {
  sheetId: number;
  title: string;
  index?: number;
  sheetType?: string;
  gridProperties?: {
    rowCount?: number;
    columnCount?: number;
    frozenRowCount?: number;
    frozenColumnCount?: number;
  };
}

export interface GridData {
  startRow?: number;
  startColumn?: number;
  rowData?: RowData[];
}

export interface RowData {
  values?: CellData[];
}

export interface CellData {
  userEnteredValue?: ExtendedValue;
  effectiveValue?: ExtendedValue;
  formattedValue?: string;
  hyperlink?: string;
}

export interface ExtendedValue {
  numberValue?: number;
  stringValue?: string;
  boolValue?: boolean;
  formulaValue?: string;
  errorValue?: {
    type?: string;
    message?: string;
  };
}

// ============================================================================
// Google Sheets Service
// ============================================================================

export class GoogleSheetsService extends GoogleBaseService {
  protected readonly serviceCommand = "sheets";
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
   * Get spreadsheet metadata (without data)
   *
   * @param spreadsheetId - Spreadsheet ID
   * @returns Spreadsheet metadata
   */
  async getSpreadsheet(spreadsheetId: string): Promise<Spreadsheet> {
    const args = ["get", spreadsheetId];
    const result = await this.execGog(args);
    return this.parseSpreadsheet(result);
  }

  /**
   * Get data from a specific range
   *
   * @param spreadsheetId - Spreadsheet ID
   * @param range - Range in A1 notation (e.g., "Sheet1!A1:B10")
   * @returns 2D array of values
   */
  async getSheetData(
    spreadsheetId: string,
    range: string
  ): Promise<string[][]> {
    const args = ["values", "get", spreadsheetId, range];
    const result = (await this.execGog(args)) as { values?: unknown[][] };
    return (result.values || []).map((row) =>
      row.map((cell) => (cell !== null && cell !== undefined ? String(cell) : ""))
    );
  }

  /**
   * List all sheets in a spreadsheet
   *
   * @param spreadsheetId - Spreadsheet ID
   * @returns Array of sheet metadata
   */
  async listSheets(spreadsheetId: string): Promise<SheetProperties[]> {
    const spreadsheet = await this.getSpreadsheet(spreadsheetId);
    return spreadsheet.sheets?.map((s) => s.properties) || [];
  }

  /**
   * Search for spreadsheets by name (via Drive API)
   *
   * @param query - Search query
   * @param options - Additional options
   * @returns Matching spreadsheets (metadata only)
   */
  async searchSpreadsheets(
    query: string,
    options?: {
      pageSize?: number;
    }
  ): Promise<Array<{ id: string; name: string; modifiedTime?: string }>> {
    const drive = this.getDriveService();
    const files = await drive.searchFiles(query, {
      mimeType: DRIVE_MIME_TYPES.SPREADSHEET,
      pageSize: options?.pageSize || 20,
    });

    return files.map((f) => ({
      id: f.id,
      name: f.name,
      modifiedTime: f.modifiedTime,
    }));
  }

  /**
   * Get all data from the first sheet
   *
   * @param spreadsheetId - Spreadsheet ID
   * @returns 2D array of values
   */
  async getAllData(spreadsheetId: string): Promise<string[][]> {
    const sheets = await this.listSheets(spreadsheetId);
    if (sheets.length === 0) {
      return [];
    }
    const firstSheet = sheets[0].title;
    return this.getSheetData(spreadsheetId, firstSheet);
  }

  // ==========================================================================
  // Parsing Helpers
  // ==========================================================================

  private parseSpreadsheet(raw: unknown): Spreadsheet {
    const s = raw as Record<string, unknown>;
    return {
      spreadsheetId: String(s.spreadsheetId || ""),
      properties: this.parseSpreadsheetProperties(s.properties),
      sheets: Array.isArray(s.sheets)
        ? s.sheets.map((sheet: unknown) => this.parseSheet(sheet))
        : undefined,
      spreadsheetUrl: s.spreadsheetUrl ? String(s.spreadsheetUrl) : undefined,
    };
  }

  private parseSpreadsheetProperties(raw: unknown): SpreadsheetProperties {
    const p = (raw || {}) as Record<string, unknown>;
    return {
      title: String(p.title || ""),
      locale: p.locale ? String(p.locale) : undefined,
      autoRecalc: p.autoRecalc ? String(p.autoRecalc) : undefined,
      timeZone: p.timeZone ? String(p.timeZone) : undefined,
    };
  }

  private parseSheet(raw: unknown): Sheet {
    const s = raw as Record<string, unknown>;
    return {
      properties: this.parseSheetProperties(s.properties),
      data: Array.isArray(s.data)
        ? s.data.map((d: unknown) => this.parseGridData(d))
        : undefined,
    };
  }

  private parseSheetProperties(raw: unknown): SheetProperties {
    const p = (raw || {}) as Record<string, unknown>;
    return {
      sheetId: typeof p.sheetId === "number" ? p.sheetId : 0,
      title: String(p.title || ""),
      index: typeof p.index === "number" ? p.index : undefined,
      sheetType: p.sheetType ? String(p.sheetType) : undefined,
      gridProperties: p.gridProperties
        ? this.parseGridProperties(p.gridProperties)
        : undefined,
    };
  }

  private parseGridProperties(raw: unknown): {
    rowCount?: number;
    columnCount?: number;
    frozenRowCount?: number;
    frozenColumnCount?: number;
  } {
    const g = raw as Record<string, unknown>;
    return {
      rowCount: typeof g.rowCount === "number" ? g.rowCount : undefined,
      columnCount: typeof g.columnCount === "number" ? g.columnCount : undefined,
      frozenRowCount:
        typeof g.frozenRowCount === "number" ? g.frozenRowCount : undefined,
      frozenColumnCount:
        typeof g.frozenColumnCount === "number"
          ? g.frozenColumnCount
          : undefined,
    };
  }

  private parseGridData(raw: unknown): GridData {
    const g = raw as Record<string, unknown>;
    return {
      startRow: typeof g.startRow === "number" ? g.startRow : undefined,
      startColumn: typeof g.startColumn === "number" ? g.startColumn : undefined,
      rowData: Array.isArray(g.rowData)
        ? g.rowData.map((r: unknown) => this.parseRowData(r))
        : undefined,
    };
  }

  private parseRowData(raw: unknown): RowData {
    const r = raw as Record<string, unknown>;
    return {
      values: Array.isArray(r.values)
        ? r.values.map((v: unknown) => this.parseCellData(v))
        : undefined,
    };
  }

  private parseCellData(raw: unknown): CellData {
    const c = raw as Record<string, unknown>;
    return {
      userEnteredValue: c.userEnteredValue
        ? this.parseExtendedValue(c.userEnteredValue)
        : undefined,
      effectiveValue: c.effectiveValue
        ? this.parseExtendedValue(c.effectiveValue)
        : undefined,
      formattedValue: c.formattedValue ? String(c.formattedValue) : undefined,
      hyperlink: c.hyperlink ? String(c.hyperlink) : undefined,
    };
  }

  private parseExtendedValue(raw: unknown): ExtendedValue {
    const v = raw as Record<string, unknown>;
    return {
      numberValue: typeof v.numberValue === "number" ? v.numberValue : undefined,
      stringValue: v.stringValue ? String(v.stringValue) : undefined,
      boolValue: typeof v.boolValue === "boolean" ? v.boolValue : undefined,
      formulaValue: v.formulaValue ? String(v.formulaValue) : undefined,
      errorValue: v.errorValue
        ? this.parseErrorValue(v.errorValue)
        : undefined,
    };
  }

  private parseErrorValue(raw: unknown): {
    type?: string;
    message?: string;
  } {
    const e = raw as Record<string, unknown>;
    return {
      type: e.type ? String(e.type) : undefined,
      message: e.message ? String(e.message) : undefined,
    };
  }
}

// ============================================================================
// Singleton Pattern
// ============================================================================

let _sheetsService: GoogleSheetsService | null = null;

/**
 * Get the Sheets service instance (singleton)
 */
export function getSheetsService(): GoogleSheetsService {
  if (!_sheetsService) {
    _sheetsService = new GoogleSheetsService();
  }
  return _sheetsService;
}

/**
 * Reset the Sheets service (for testing)
 */
export function resetSheetsService(): void {
  _sheetsService = null;
}
