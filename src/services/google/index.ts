/**
 * Google Services Index
 *
 * Re-exports all Google services for convenient imports.
 */

// Base service and configuration
export {
  GoogleBaseService,
  loadConfig,
  saveConfig,
  getGoogleAccount,
  isGoogleConfigured,
  type ZaruConfig,
  type GoogleServiceOptions,
} from "./base";

// Gmail Service
export {
  GmailService,
  getGmailService,
  isGmailConfigured,
  resetGmailService,
  type GmailMessage,
  type GmailThread,
  type GmailLabel,
  type SendEmailOptions,
  type SendEmailResult,
} from "./gmail";

// Calendar Service
export {
  GoogleCalendarService,
  getCalendarService,
  resetCalendarService,
  type CalendarEvent,
  type Calendar,
} from "./calendar";

// Contacts Service (People API)
export {
  GoogleContactsService,
  getContactsService,
  resetContactsService,
  type Contact,
  type ContactGroup,
} from "./contacts";

// Drive Service
export {
  GoogleDriveService,
  getDriveService,
  resetDriveService,
  DRIVE_MIME_TYPES,
  type DriveFile,
} from "./drive";

// Docs Service
export {
  GoogleDocsService,
  getDocsService,
  resetDocsService,
  type GoogleDoc,
  type DocumentBody,
  type StructuralElement,
  type Paragraph,
  type TextRun,
} from "./docs";

// Sheets Service
export {
  GoogleSheetsService,
  getSheetsService,
  resetSheetsService,
  type Spreadsheet,
  type Sheet,
  type SheetProperties,
} from "./sheets";

// Keep Service
export {
  GoogleKeepService,
  getKeepService,
  resetKeepService,
  type KeepNote,
  type KeepLabel,
} from "./keep";

// Chat Service
export {
  GoogleChatService,
  getChatService,
  resetChatService,
  type ChatSpace,
  type ChatMessage,
} from "./chat";
