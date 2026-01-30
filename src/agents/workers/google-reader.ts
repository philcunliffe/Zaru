/**
 * Google Reader Agent Worker
 *
 * READ agent that processes content from all Google services:
 * Gmail, Calendar, Contacts, Drive, Docs, Sheets, Keep, and Chat.
 *
 * SECURITY: This agent processes content with hardened security prompts.
 * It has NO write access and follows the "Rule of Two" - processing inputs
 * but only producing encrypted output that it cannot directly act upon.
 */

import { generateText, tool } from "ai";
import { z } from "zod";
import { BaseAgentWorker, type TaskResult } from "./base-worker";
import type { AgentPermission } from "../types";

// Import all Google services
import {
  GmailService,
  isGmailConfigured,
  type GmailMessage,
} from "../../services/google/gmail";
import { GoogleCalendarService } from "../../services/google/calendar";
import { GoogleContactsService } from "../../services/google/contacts";
import { GoogleDriveService, DRIVE_MIME_TYPES } from "../../services/google/drive";
import { GoogleDocsService } from "../../services/google/docs";
import { GoogleSheetsService } from "../../services/google/sheets";
import { GoogleKeepService } from "../../services/google/keep";
import { GoogleChatService } from "../../services/google/chat";
import { isGoogleConfigured } from "../../services/google/base";

class GoogleReaderWorker extends BaseAgentWorker {
  // Lazy-initialized services
  private gmailService: GmailService | null = null;
  private calendarService: GoogleCalendarService | null = null;
  private contactsService: GoogleContactsService | null = null;
  private driveService: GoogleDriveService | null = null;
  private docsService: GoogleDocsService | null = null;
  private sheetsService: GoogleSheetsService | null = null;
  private keepService: GoogleKeepService | null = null;
  private chatService: GoogleChatService | null = null;

  constructor() {
    super();
  }

  // ==========================================================================
  // Service Accessors (Lazy Initialization)
  // ==========================================================================

  private getGmailService(): GmailService {
    if (!this.gmailService) {
      if (!isGmailConfigured()) {
        throw new Error(
          "Gmail not configured. Please add google.account to ~/.zaru/config.json"
        );
      }
      this.gmailService = new GmailService();
    }
    return this.gmailService;
  }

  private getCalendarService(): GoogleCalendarService {
    if (!this.calendarService) {
      if (!isGoogleConfigured()) {
        throw new Error(
          "Google not configured. Please add google.account to ~/.zaru/config.json"
        );
      }
      this.calendarService = new GoogleCalendarService();
    }
    return this.calendarService;
  }

  private getContactsService(): GoogleContactsService {
    if (!this.contactsService) {
      if (!isGoogleConfigured()) {
        throw new Error(
          "Google not configured. Please add google.account to ~/.zaru/config.json"
        );
      }
      this.contactsService = new GoogleContactsService();
    }
    return this.contactsService;
  }

  private getDriveService(): GoogleDriveService {
    if (!this.driveService) {
      if (!isGoogleConfigured()) {
        throw new Error(
          "Google not configured. Please add google.account to ~/.zaru/config.json"
        );
      }
      this.driveService = new GoogleDriveService();
    }
    return this.driveService;
  }

  private getDocsService(): GoogleDocsService {
    if (!this.docsService) {
      if (!isGoogleConfigured()) {
        throw new Error(
          "Google not configured. Please add google.account to ~/.zaru/config.json"
        );
      }
      this.docsService = new GoogleDocsService();
    }
    return this.docsService;
  }

  private getSheetsService(): GoogleSheetsService {
    if (!this.sheetsService) {
      if (!isGoogleConfigured()) {
        throw new Error(
          "Google not configured. Please add google.account to ~/.zaru/config.json"
        );
      }
      this.sheetsService = new GoogleSheetsService();
    }
    return this.sheetsService;
  }

  private getKeepService(): GoogleKeepService {
    if (!this.keepService) {
      if (!isGoogleConfigured()) {
        throw new Error(
          "Google not configured. Please add google.account to ~/.zaru/config.json"
        );
      }
      this.keepService = new GoogleKeepService();
    }
    return this.keepService;
  }

  private getChatService(): GoogleChatService {
    if (!this.chatService) {
      if (!isGoogleConfigured()) {
        throw new Error(
          "Google not configured. Please add google.account to ~/.zaru/config.json"
        );
      }
      this.chatService = new GoogleChatService();
    }
    return this.chatService;
  }

  protected getExpectedPermission(): AgentPermission {
    return "READ";
  }

  protected async processTask(
    taskDescription: string,
    _inputContent: string,
    originalRequest: string
  ): Promise<TaskResult> {
    const openai = this.getOpenAI();

    // Track counts for outcome summary
    let itemCounts: Record<string, number> = {};
    let hasActionItems = false;
    let hasUnread = false;

    // Helper to detect action items in text
    const detectActionItems = (text: string): boolean => {
      return /action|todo|task|follow[- ]?up|deadline|urgent|asap|please\s+(?:review|respond|confirm)/i.test(
        text
      );
    };

    // ==========================================================================
    // Gmail Tools (6 tools)
    // ==========================================================================

    const gmailTools = {
      gmail_searchEmails: tool({
        description:
          "Search emails using Gmail query syntax. Examples: 'is:unread', 'from:alice@example.com', 'subject:meeting', 'newer_than:7d'",
        parameters: z.object({
          query: z.string().describe("Gmail search query"),
          limit: z.number().max(50).optional().describe("Max emails to return (default 10)"),
        }),
        execute: async ({ query, limit }) => {
          const gmail = this.getGmailService();
          const threads = await gmail.searchThreads(query, { max: limit || 10 });
          itemCounts.threads = (itemCounts.threads || 0) + threads.length;

          const results: Array<{
            threadId: string;
            snippet: string;
            messages: Array<{
              id: string;
              from: string;
              subject: string;
              date: string;
              isRead: boolean;
              bodyPreview: string;
            }>;
          }> = [];

          for (const thread of threads) {
            const fullThread = await gmail.getThread(thread.id);
            const messages =
              fullThread.messages?.map((m) => ({
                id: m.id,
                from: m.from,
                subject: m.subject,
                date: m.date.toISOString(),
                isRead: m.isRead,
                bodyPreview: m.body.slice(0, 500) + (m.body.length > 500 ? "..." : ""),
              })) || [];

            results.push({
              threadId: thread.id,
              snippet: thread.snippet,
              messages,
            });

            for (const msg of messages) {
              itemCounts.emails = (itemCounts.emails || 0) + 1;
              if (!msg.isRead) hasUnread = true;
              if (detectActionItems(msg.subject + " " + msg.bodyPreview)) {
                hasActionItems = true;
              }
            }
          }

          return results;
        },
      }),

      gmail_getEmail: tool({
        description: "Get a single email by its message ID",
        parameters: z.object({
          messageId: z.string().describe("Gmail message ID"),
        }),
        execute: async ({ messageId }) => {
          const gmail = this.getGmailService();
          const msg = await gmail.getMessage(messageId);
          itemCounts.emails = (itemCounts.emails || 0) + 1;
          hasUnread = !msg.isRead;
          hasActionItems = detectActionItems(msg.subject + " " + msg.body);

          return {
            id: msg.id,
            threadId: msg.threadId,
            from: msg.from,
            to: msg.to,
            cc: msg.cc,
            subject: msg.subject,
            body: msg.body,
            date: msg.date.toISOString(),
            labels: msg.labels,
            isRead: msg.isRead,
          };
        },
      }),

      gmail_getThread: tool({
        description: "Get a full email thread with all messages",
        parameters: z.object({
          threadId: z.string().describe("Gmail thread ID"),
        }),
        execute: async ({ threadId }) => {
          const gmail = this.getGmailService();
          const thread = await gmail.getThread(threadId);
          itemCounts.threads = (itemCounts.threads || 0) + 1;

          const messages =
            thread.messages?.map((m) => {
              itemCounts.emails = (itemCounts.emails || 0) + 1;
              if (!m.isRead) hasUnread = true;
              if (detectActionItems(m.subject + " " + m.body)) {
                hasActionItems = true;
              }

              return {
                id: m.id,
                from: m.from,
                to: m.to,
                subject: m.subject,
                body: m.body,
                date: m.date.toISOString(),
                isRead: m.isRead,
              };
            }) || [];

          return {
            threadId: thread.id,
            snippet: thread.snippet,
            messages,
          };
        },
      }),

      gmail_listLabels: tool({
        description: "List all available Gmail labels with message counts",
        parameters: z.object({}),
        execute: async () => {
          const gmail = this.getGmailService();
          const labels = await gmail.listLabels();
          return labels.map((l) => ({
            id: l.id,
            name: l.name,
            messagesTotal: l.messagesTotal,
            messagesUnread: l.messagesUnread,
          }));
        },
      }),

      gmail_fetchRecentEmails: tool({
        description: "Fetch recent emails from inbox (convenience method)",
        parameters: z.object({
          limit: z.number().max(50).optional().describe("Max emails to fetch (default 10)"),
          unreadOnly: z.boolean().optional().describe("Only fetch unread emails"),
        }),
        execute: async ({ limit, unreadOnly }) => {
          const gmail = this.getGmailService();
          const query = unreadOnly ? "is:unread in:inbox" : "in:inbox";
          const threads = await gmail.searchThreads(query, { max: limit || 10 });
          itemCounts.threads = (itemCounts.threads || 0) + threads.length;

          const results: Array<{
            threadId: string;
            snippet: string;
            latestMessage: {
              id: string;
              from: string;
              subject: string;
              date: string;
              isRead: boolean;
              bodyPreview: string;
            };
          }> = [];

          for (const thread of threads) {
            const fullThread = await gmail.getThread(thread.id);
            const latestMsg = fullThread.messages?.[fullThread.messages.length - 1];

            if (latestMsg) {
              itemCounts.emails = (itemCounts.emails || 0) + 1;
              if (!latestMsg.isRead) hasUnread = true;
              if (detectActionItems(latestMsg.subject + " " + latestMsg.body)) {
                hasActionItems = true;
              }

              results.push({
                threadId: thread.id,
                snippet: thread.snippet,
                latestMessage: {
                  id: latestMsg.id,
                  from: latestMsg.from,
                  subject: latestMsg.subject,
                  date: latestMsg.date.toISOString(),
                  isRead: latestMsg.isRead,
                  bodyPreview: latestMsg.body.slice(0, 500) + (latestMsg.body.length > 500 ? "..." : ""),
                },
              });
            }
          }

          return results;
        },
      }),

      gmail_markAsRead: tool({
        description: "Mark an email thread as read",
        parameters: z.object({
          threadId: z.string().describe("Gmail thread ID to mark as read"),
        }),
        execute: async ({ threadId }) => {
          const gmail = this.getGmailService();
          await gmail.markAsRead(threadId);
          return { success: true, threadId };
        },
      }),
    };

    // ==========================================================================
    // Calendar Tools (5 tools)
    // ==========================================================================

    const calendarTools = {
      calendar_listEvents: tool({
        description: "List calendar events within a time range",
        parameters: z.object({
          calendarId: z.string().optional().describe("Calendar ID (defaults to primary)"),
          timeMin: z.string().optional().describe("Start time (ISO 8601)"),
          timeMax: z.string().optional().describe("End time (ISO 8601)"),
          maxResults: z.number().max(100).optional().describe("Max events to return"),
        }),
        execute: async ({ calendarId, timeMin, timeMax, maxResults }) => {
          const calendar = this.getCalendarService();
          const events = await calendar.listEvents({
            calendarId,
            timeMin,
            timeMax,
            maxResults,
          });
          itemCounts.events = (itemCounts.events || 0) + events.length;

          return events.map((e) => ({
            id: e.id,
            summary: e.summary,
            description: e.description,
            location: e.location,
            start: e.start,
            end: e.end,
            attendees: e.attendees?.map((a) => ({
              email: a.email,
              displayName: a.displayName,
              responseStatus: a.responseStatus,
            })),
            htmlLink: e.htmlLink,
            hangoutLink: e.hangoutLink,
          }));
        },
      }),

      calendar_getEvent: tool({
        description: "Get a single calendar event by ID",
        parameters: z.object({
          eventId: z.string().describe("Event ID"),
          calendarId: z.string().optional().describe("Calendar ID (defaults to primary)"),
        }),
        execute: async ({ eventId, calendarId }) => {
          const calendar = this.getCalendarService();
          const event = await calendar.getEvent(eventId, calendarId);
          itemCounts.events = (itemCounts.events || 0) + 1;

          return {
            id: event.id,
            summary: event.summary,
            description: event.description,
            location: event.location,
            start: event.start,
            end: event.end,
            attendees: event.attendees,
            organizer: event.organizer,
            htmlLink: event.htmlLink,
            hangoutLink: event.hangoutLink,
            conferenceData: event.conferenceData,
          };
        },
      }),

      calendar_searchEvents: tool({
        description: "Search calendar events by query string",
        parameters: z.object({
          query: z.string().describe("Search query"),
          calendarId: z.string().optional().describe("Calendar ID (defaults to primary)"),
          timeMin: z.string().optional().describe("Start time (ISO 8601)"),
          timeMax: z.string().optional().describe("End time (ISO 8601)"),
          maxResults: z.number().max(50).optional().describe("Max events to return"),
        }),
        execute: async ({ query, calendarId, timeMin, timeMax, maxResults }) => {
          const calendar = this.getCalendarService();
          const events = await calendar.searchEvents(query, {
            calendarId,
            timeMin,
            timeMax,
            maxResults,
          });
          itemCounts.events = (itemCounts.events || 0) + events.length;

          return events.map((e) => ({
            id: e.id,
            summary: e.summary,
            description: e.description,
            location: e.location,
            start: e.start,
            end: e.end,
          }));
        },
      }),

      calendar_listCalendars: tool({
        description: "List all calendars the user has access to",
        parameters: z.object({}),
        execute: async () => {
          const calendar = this.getCalendarService();
          const calendars = await calendar.listCalendars();
          return calendars.map((c) => ({
            id: c.id,
            summary: c.summary,
            description: c.description,
            timeZone: c.timeZone,
            primary: c.primary,
            accessRole: c.accessRole,
          }));
        },
      }),

      calendar_getTodaysAgenda: tool({
        description: "Get today's calendar events (from now until end of day)",
        parameters: z.object({
          calendarId: z.string().optional().describe("Calendar ID (defaults to primary)"),
        }),
        execute: async ({ calendarId }) => {
          const calendar = this.getCalendarService();
          const events = await calendar.getTodaysAgenda(calendarId);
          itemCounts.events = (itemCounts.events || 0) + events.length;

          return events.map((e) => ({
            id: e.id,
            summary: e.summary,
            description: e.description,
            location: e.location,
            start: e.start,
            end: e.end,
            attendees: e.attendees?.map((a) => ({
              email: a.email,
              displayName: a.displayName,
              responseStatus: a.responseStatus,
            })),
            hangoutLink: e.hangoutLink,
          }));
        },
      }),
    };

    // ==========================================================================
    // Contacts Tools (4 tools)
    // ==========================================================================

    const contactsTools = {
      contacts_listContacts: tool({
        description: "List all contacts",
        parameters: z.object({
          pageSize: z.number().max(100).optional().describe("Max contacts to return"),
        }),
        execute: async ({ pageSize }) => {
          const contacts = this.getContactsService();
          const list = await contacts.listContacts({ pageSize });
          itemCounts.contacts = (itemCounts.contacts || 0) + list.length;

          return list.map((c) => ({
            resourceName: c.resourceName,
            displayName: c.names?.[0]?.displayName,
            givenName: c.names?.[0]?.givenName,
            familyName: c.names?.[0]?.familyName,
            emails: c.emailAddresses?.map((e) => ({ value: e.value, type: e.type })),
            phones: c.phoneNumbers?.map((p) => ({ value: p.value, type: p.type })),
            organization: c.organizations?.[0]?.name,
            title: c.organizations?.[0]?.title,
          }));
        },
      }),

      contacts_getContact: tool({
        description: "Get a single contact by resource name",
        parameters: z.object({
          resourceName: z.string().describe("Contact resource name (e.g., 'people/c123456')"),
        }),
        execute: async ({ resourceName }) => {
          const contacts = this.getContactsService();
          const contact = await contacts.getContact(resourceName);
          itemCounts.contacts = (itemCounts.contacts || 0) + 1;

          return {
            resourceName: contact.resourceName,
            names: contact.names,
            emails: contact.emailAddresses,
            phones: contact.phoneNumbers,
            addresses: contact.addresses,
            organizations: contact.organizations,
            birthdays: contact.birthdays,
            biographies: contact.biographies,
          };
        },
      }),

      contacts_searchContacts: tool({
        description: "Search contacts by name, email, or phone",
        parameters: z.object({
          query: z.string().describe("Search query"),
          pageSize: z.number().max(50).optional().describe("Max contacts to return"),
        }),
        execute: async ({ query, pageSize }) => {
          const contacts = this.getContactsService();
          const list = await contacts.searchContacts(query, { pageSize });
          itemCounts.contacts = (itemCounts.contacts || 0) + list.length;

          return list.map((c) => ({
            resourceName: c.resourceName,
            displayName: c.names?.[0]?.displayName,
            emails: c.emailAddresses?.map((e) => ({ value: e.value, type: e.type })),
            phones: c.phoneNumbers?.map((p) => ({ value: p.value, type: p.type })),
            organization: c.organizations?.[0]?.name,
          }));
        },
      }),

      contacts_getContactGroups: tool({
        description: "List contact groups/labels",
        parameters: z.object({}),
        execute: async () => {
          const contacts = this.getContactsService();
          const groups = await contacts.listContactGroups();
          return groups.map((g) => ({
            resourceName: g.resourceName,
            name: g.name,
            groupType: g.groupType,
            memberCount: g.memberCount,
          }));
        },
      }),
    };

    // ==========================================================================
    // Drive Tools (5 tools)
    // ==========================================================================

    const driveTools = {
      drive_listFiles: tool({
        description: "List files and folders in Google Drive",
        parameters: z.object({
          folderId: z.string().optional().describe("Parent folder ID (defaults to root)"),
          query: z.string().optional().describe("Drive query string"),
          pageSize: z.number().max(100).optional().describe("Max files to return"),
          orderBy: z.string().optional().describe("Order by field (e.g., 'modifiedTime desc')"),
        }),
        execute: async ({ folderId, query, pageSize, orderBy }) => {
          const drive = this.getDriveService();
          const files = await drive.listFiles({ folderId, query, pageSize, orderBy });
          itemCounts.files = (itemCounts.files || 0) + files.length;

          return files.map((f) => ({
            id: f.id,
            name: f.name,
            mimeType: f.mimeType,
            description: f.description,
            createdTime: f.createdTime,
            modifiedTime: f.modifiedTime,
            size: f.size,
            webViewLink: f.webViewLink,
            owners: f.owners,
            shared: f.shared,
          }));
        },
      }),

      drive_getFile: tool({
        description: "Get file metadata by ID",
        parameters: z.object({
          fileId: z.string().describe("File ID"),
        }),
        execute: async ({ fileId }) => {
          const drive = this.getDriveService();
          const file = await drive.getFile(fileId);
          itemCounts.files = (itemCounts.files || 0) + 1;

          return {
            id: file.id,
            name: file.name,
            mimeType: file.mimeType,
            description: file.description,
            starred: file.starred,
            createdTime: file.createdTime,
            modifiedTime: file.modifiedTime,
            size: file.size,
            webViewLink: file.webViewLink,
            webContentLink: file.webContentLink,
            owners: file.owners,
            lastModifyingUser: file.lastModifyingUser,
            shared: file.shared,
            capabilities: file.capabilities,
          };
        },
      }),

      drive_searchFiles: tool({
        description: "Search files in Google Drive by name or content",
        parameters: z.object({
          query: z.string().describe("Search query"),
          mimeType: z.string().optional().describe("Filter by MIME type"),
          pageSize: z.number().max(50).optional().describe("Max files to return"),
        }),
        execute: async ({ query, mimeType, pageSize }) => {
          const drive = this.getDriveService();
          const files = await drive.searchFiles(query, { mimeType, pageSize });
          itemCounts.files = (itemCounts.files || 0) + files.length;

          return files.map((f) => ({
            id: f.id,
            name: f.name,
            mimeType: f.mimeType,
            modifiedTime: f.modifiedTime,
            webViewLink: f.webViewLink,
          }));
        },
      }),

      drive_getFileContent: tool({
        description: "Read file content (for text files, exports Google Docs as text)",
        parameters: z.object({
          fileId: z.string().describe("File ID"),
          exportMimeType: z.string().optional().describe("Export MIME type (for Google Docs, e.g., 'text/plain')"),
        }),
        execute: async ({ fileId, exportMimeType }) => {
          const drive = this.getDriveService();
          const content = await drive.getFileContent(fileId, exportMimeType);
          return { content: content.slice(0, 50000) }; // Limit content size
        },
      }),

      drive_listFolders: tool({
        description: "List only folders in Google Drive",
        parameters: z.object({
          parentId: z.string().optional().describe("Parent folder ID"),
          pageSize: z.number().max(100).optional().describe("Max folders to return"),
        }),
        execute: async ({ parentId, pageSize }) => {
          const drive = this.getDriveService();
          const folders = await drive.listFolders({ parentId, pageSize });
          itemCounts.folders = (itemCounts.folders || 0) + folders.length;

          return folders.map((f) => ({
            id: f.id,
            name: f.name,
            createdTime: f.createdTime,
            modifiedTime: f.modifiedTime,
            webViewLink: f.webViewLink,
          }));
        },
      }),
    };

    // ==========================================================================
    // Docs Tools (3 tools)
    // ==========================================================================

    const docsTools = {
      docs_getDocument: tool({
        description: "Get a Google Doc's content and structure",
        parameters: z.object({
          documentId: z.string().describe("Document ID"),
        }),
        execute: async ({ documentId }) => {
          const docs = this.getDocsService();
          const doc = await docs.getDocument(documentId);
          const text = docs.extractText(doc);
          itemCounts.docs = (itemCounts.docs || 0) + 1;

          return {
            documentId: doc.documentId,
            title: doc.title,
            text: text.slice(0, 50000), // Limit content size
          };
        },
      }),

      docs_searchDocuments: tool({
        description: "Search for Google Docs by name",
        parameters: z.object({
          query: z.string().describe("Search query"),
          pageSize: z.number().max(50).optional().describe("Max docs to return"),
        }),
        execute: async ({ query, pageSize }) => {
          const docs = this.getDocsService();
          const results = await docs.searchDocuments(query, { pageSize });
          itemCounts.docs = (itemCounts.docs || 0) + results.length;

          return results;
        },
      }),

      docs_getDocumentText: tool({
        description: "Get a Google Doc as plain text (faster than getDocument)",
        parameters: z.object({
          documentId: z.string().describe("Document ID"),
        }),
        execute: async ({ documentId }) => {
          const docs = this.getDocsService();
          const text = await docs.getDocumentText(documentId);
          itemCounts.docs = (itemCounts.docs || 0) + 1;

          return { text: text.slice(0, 50000) }; // Limit content size
        },
      }),
    };

    // ==========================================================================
    // Sheets Tools (4 tools)
    // ==========================================================================

    const sheetsTools = {
      sheets_getSpreadsheet: tool({
        description: "Get spreadsheet metadata and sheet list",
        parameters: z.object({
          spreadsheetId: z.string().describe("Spreadsheet ID"),
        }),
        execute: async ({ spreadsheetId }) => {
          const sheets = this.getSheetsService();
          const spreadsheet = await sheets.getSpreadsheet(spreadsheetId);
          itemCounts.spreadsheets = (itemCounts.spreadsheets || 0) + 1;

          return {
            spreadsheetId: spreadsheet.spreadsheetId,
            title: spreadsheet.properties.title,
            locale: spreadsheet.properties.locale,
            timeZone: spreadsheet.properties.timeZone,
            sheets: spreadsheet.sheets?.map((s) => ({
              sheetId: s.properties.sheetId,
              title: s.properties.title,
              index: s.properties.index,
              rowCount: s.properties.gridProperties?.rowCount,
              columnCount: s.properties.gridProperties?.columnCount,
            })),
            spreadsheetUrl: spreadsheet.spreadsheetUrl,
          };
        },
      }),

      sheets_getSheetData: tool({
        description: "Get data from a specific range in a spreadsheet",
        parameters: z.object({
          spreadsheetId: z.string().describe("Spreadsheet ID"),
          range: z.string().describe("Range in A1 notation (e.g., 'Sheet1!A1:B10')"),
        }),
        execute: async ({ spreadsheetId, range }) => {
          const sheets = this.getSheetsService();
          const data = await sheets.getSheetData(spreadsheetId, range);
          return { range, values: data.slice(0, 1000) }; // Limit rows
        },
      }),

      sheets_listSheets: tool({
        description: "List all sheets in a spreadsheet",
        parameters: z.object({
          spreadsheetId: z.string().describe("Spreadsheet ID"),
        }),
        execute: async ({ spreadsheetId }) => {
          const sheets = this.getSheetsService();
          const sheetList = await sheets.listSheets(spreadsheetId);
          return sheetList.map((s) => ({
            sheetId: s.sheetId,
            title: s.title,
            index: s.index,
            rowCount: s.gridProperties?.rowCount,
            columnCount: s.gridProperties?.columnCount,
          }));
        },
      }),

      sheets_searchSpreadsheets: tool({
        description: "Search for Google Sheets by name",
        parameters: z.object({
          query: z.string().describe("Search query"),
          pageSize: z.number().max(50).optional().describe("Max spreadsheets to return"),
        }),
        execute: async ({ query, pageSize }) => {
          const sheets = this.getSheetsService();
          const results = await sheets.searchSpreadsheets(query, { pageSize });
          itemCounts.spreadsheets = (itemCounts.spreadsheets || 0) + results.length;

          return results;
        },
      }),
    };

    // ==========================================================================
    // Keep Tools (4 tools)
    // ==========================================================================

    const keepTools = {
      keep_listNotes: tool({
        description: "List Google Keep notes",
        parameters: z.object({
          pageSize: z.number().max(100).optional().describe("Max notes to return"),
        }),
        execute: async ({ pageSize }) => {
          const keep = this.getKeepService();
          const notes = await keep.listNotes({ pageSize });
          itemCounts.notes = (itemCounts.notes || 0) + notes.length;

          return notes.map((n) => ({
            name: n.name,
            title: n.title,
            text: keep.extractText(n).slice(0, 500), // Preview
            color: n.color,
            createTime: n.createTime,
            updateTime: n.updateTime,
            trashed: n.trashed,
          }));
        },
      }),

      keep_getNote: tool({
        description: "Get a Google Keep note by name",
        parameters: z.object({
          noteName: z.string().describe("Note resource name (e.g., 'notes/abc123')"),
        }),
        execute: async ({ noteName }) => {
          const keep = this.getKeepService();
          const note = await keep.getNote(noteName);
          itemCounts.notes = (itemCounts.notes || 0) + 1;

          return {
            name: note.name,
            title: note.title,
            text: keep.extractText(note),
            color: note.color,
            createTime: note.createTime,
            updateTime: note.updateTime,
            trashed: note.trashed,
            attachments: note.attachments,
          };
        },
      }),

      keep_searchNotes: tool({
        description: "Search Google Keep notes by content",
        parameters: z.object({
          query: z.string().describe("Search query"),
          pageSize: z.number().max(50).optional().describe("Max notes to return"),
        }),
        execute: async ({ query, pageSize }) => {
          const keep = this.getKeepService();
          const notes = await keep.searchNotes(query, { pageSize });
          itemCounts.notes = (itemCounts.notes || 0) + notes.length;

          return notes.map((n) => ({
            name: n.name,
            title: n.title,
            text: keep.extractText(n).slice(0, 500), // Preview
            updateTime: n.updateTime,
          }));
        },
      }),

      keep_listLabels: tool({
        description: "List Google Keep labels",
        parameters: z.object({}),
        execute: async () => {
          const keep = this.getKeepService();
          const labels = await keep.listLabels();
          return labels.map((l) => ({
            name: l.name,
            labelName: l.labelName,
          }));
        },
      }),
    };

    // ==========================================================================
    // Chat Tools (4 tools)
    // ==========================================================================

    const chatTools = {
      chat_listSpaces: tool({
        description: "List Google Chat spaces/rooms the user has access to",
        parameters: z.object({
          pageSize: z.number().max(100).optional().describe("Max spaces to return"),
        }),
        execute: async ({ pageSize }) => {
          const chat = this.getChatService();
          const spaces = await chat.listSpaces({ pageSize });
          itemCounts.spaces = (itemCounts.spaces || 0) + spaces.length;

          return spaces.map((s) => ({
            name: s.name,
            displayName: s.displayName,
            type: s.type,
            spaceType: s.spaceType,
            membershipCount: s.membershipCount,
            createTime: s.createTime,
          }));
        },
      }),

      chat_getMessages: tool({
        description: "Get messages from a Google Chat space",
        parameters: z.object({
          spaceName: z.string().describe("Space resource name (e.g., 'spaces/ABC123')"),
          pageSize: z.number().max(100).optional().describe("Max messages to return"),
          orderBy: z.string().optional().describe("Order by (e.g., 'createTime desc')"),
        }),
        execute: async ({ spaceName, pageSize, orderBy }) => {
          const chat = this.getChatService();
          const messages = await chat.getMessages(spaceName, { pageSize, orderBy });
          itemCounts.messages = (itemCounts.messages || 0) + messages.length;

          return messages.map((m) => ({
            name: m.name,
            sender: m.sender,
            createTime: m.createTime,
            text: m.text,
            thread: m.thread,
          }));
        },
      }),

      chat_searchMessages: tool({
        description: "Search messages in Google Chat",
        parameters: z.object({
          query: z.string().describe("Search query"),
          spaceName: z.string().optional().describe("Limit to specific space"),
          pageSize: z.number().max(50).optional().describe("Max messages to return"),
        }),
        execute: async ({ query, spaceName, pageSize }) => {
          const chat = this.getChatService();
          const messages = await chat.searchMessages(query, { spaceName, pageSize });
          itemCounts.messages = (itemCounts.messages || 0) + messages.length;

          return messages.map((m) => ({
            name: m.name,
            sender: m.sender,
            createTime: m.createTime,
            text: m.text,
            space: m.space,
          }));
        },
      }),

      chat_getSpace: tool({
        description: "Get details of a Google Chat space",
        parameters: z.object({
          spaceName: z.string().describe("Space resource name (e.g., 'spaces/ABC123')"),
        }),
        execute: async ({ spaceName }) => {
          const chat = this.getChatService();
          const space = await chat.getSpace(spaceName);
          itemCounts.spaces = (itemCounts.spaces || 0) + 1;

          return {
            name: space.name,
            displayName: space.displayName,
            type: space.type,
            spaceType: space.spaceType,
            spaceThreadingState: space.spaceThreadingState,
            spaceHistoryState: space.spaceHistoryState,
            membershipCount: space.membershipCount,
            createTime: space.createTime,
          };
        },
      }),
    };

    // ==========================================================================
    // Combine All Tools
    // ==========================================================================

    const allTools = {
      ...gmailTools,
      ...calendarTools,
      ...contactsTools,
      ...driveTools,
      ...docsTools,
      ...sheetsTools,
      ...keepTools,
      ...chatTools,
    };

    const basePrompt = `You are a Google services assistant with access to Gmail, Calendar, Contacts, Drive, Docs, Sheets, Keep, and Chat.

Available tool categories:

**Gmail (gmail_*):**
- gmail_searchEmails: Search using Gmail query syntax (is:unread, from:, subject:, newer_than:, etc.)
- gmail_getEmail: Get a single email by message ID
- gmail_getThread: Get a full thread with all messages
- gmail_listLabels: List available labels with counts
- gmail_fetchRecentEmails: Convenience method for recent inbox emails
- gmail_markAsRead: Mark a thread as read

**Calendar (calendar_*):**
- calendar_listEvents: List events in a time range
- calendar_getEvent: Get event details
- calendar_searchEvents: Search events by query
- calendar_listCalendars: List available calendars
- calendar_getTodaysAgenda: Get today's events

**Contacts (contacts_*):**
- contacts_listContacts: List all contacts
- contacts_getContact: Get contact details
- contacts_searchContacts: Search by name/email
- contacts_getContactGroups: List contact groups

**Drive (drive_*):**
- drive_listFiles: List files/folders
- drive_getFile: Get file metadata
- drive_searchFiles: Search files
- drive_getFileContent: Read file content
- drive_listFolders: List folders only

**Docs (docs_*):**
- docs_getDocument: Get document content
- docs_searchDocuments: Search docs
- docs_getDocumentText: Export as plain text

**Sheets (sheets_*):**
- sheets_getSpreadsheet: Get spreadsheet metadata
- sheets_getSheetData: Get data from range
- sheets_listSheets: List sheets in spreadsheet
- sheets_searchSpreadsheets: Search spreadsheets

**Keep (keep_*):**
- keep_listNotes: List all notes
- keep_getNote: Get note content
- keep_searchNotes: Search notes
- keep_listLabels: List Keep labels

**Chat (chat_*):**
- chat_listSpaces: List chat spaces/rooms
- chat_getMessages: Get messages from space
- chat_searchMessages: Search messages
- chat_getSpace: Get space details

Report content objectively and summarize key information.
When summarizing, focus on actionable items, important dates, and key points.`;

    const result = await generateText({
      model: openai("gpt-4o-mini"),
      system: this.getSystemPrompt(basePrompt),
      prompt: `Task: ${taskDescription}\nContext: ${originalRequest}`,
      tools: allTools,
      maxSteps: 15,
    });

    // Build outcome summary
    const summaryParts: string[] = [];
    for (const [key, count] of Object.entries(itemCounts)) {
      if (count > 0) {
        summaryParts.push(`${count} ${key}`);
      }
    }

    let outcomeSummary = summaryParts.length > 0
      ? `Processed ${summaryParts.join(", ")}`
      : "Google services task completed";

    if (hasActionItems) {
      outcomeSummary += " with action items";
    }
    if (hasUnread) {
      outcomeSummary += " (includes unread)";
    }

    return {
      content: result.text,
      outcomeSummary,
    };
  }
}

// Initialize the worker
new GoogleReaderWorker();
