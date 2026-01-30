/**
 * Google Calendar Service
 *
 * Wraps the GOG CLI (gog calendar) for Calendar operations.
 * Provides typed interface for calendar events and calendars.
 */

import { GoogleBaseService, type GoogleServiceOptions } from "./base";

// ============================================================================
// Types
// ============================================================================

export interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  end: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  attendees?: Array<{
    email: string;
    displayName?: string;
    responseStatus?: string;
  }>;
  organizer?: {
    email: string;
    displayName?: string;
  };
  status?: string;
  htmlLink?: string;
  hangoutLink?: string;
  conferenceData?: {
    conferenceId?: string;
    conferenceSolution?: {
      name?: string;
    };
    entryPoints?: Array<{
      entryPointType?: string;
      uri?: string;
    }>;
  };
  recurrence?: string[];
  recurringEventId?: string;
}

export interface Calendar {
  id: string;
  summary: string;
  description?: string;
  timeZone?: string;
  primary?: boolean;
  accessRole?: string;
  backgroundColor?: string;
  foregroundColor?: string;
}

// ============================================================================
// Google Calendar Service
// ============================================================================

export class GoogleCalendarService extends GoogleBaseService {
  protected readonly serviceCommand = "calendar";

  constructor(options?: GoogleServiceOptions) {
    super(options);
  }

  // ==========================================================================
  // Read Operations
  // ==========================================================================

  /**
   * List events within a time range
   *
   * @param options - Query options
   * @returns Array of events
   */
  async listEvents(options?: {
    calendarId?: string;
    timeMin?: string;
    timeMax?: string;
    maxResults?: number;
    query?: string;
  }): Promise<CalendarEvent[]> {
    const args = ["events", "list"];

    if (options?.calendarId) {
      args.push("--calendar-id", options.calendarId);
    }
    if (options?.timeMin) {
      args.push("--time-min", options.timeMin);
    }
    if (options?.timeMax) {
      args.push("--time-max", options.timeMax);
    }
    if (options?.maxResults) {
      args.push("--max-results", String(options.maxResults));
    }
    if (options?.query) {
      args.push("--query", options.query);
    }

    const result = (await this.execGog(args)) as { items?: unknown[] };
    const items = result.items || [];
    return items.map((e) => this.parseEvent(e));
  }

  /**
   * Get a single event by ID
   *
   * @param eventId - Event ID
   * @param calendarId - Calendar ID (optional, defaults to primary)
   * @returns Event details
   */
  async getEvent(eventId: string, calendarId?: string): Promise<CalendarEvent> {
    const args = ["events", "get", eventId];
    if (calendarId) {
      args.push("--calendar-id", calendarId);
    }

    const result = await this.execGog(args);
    return this.parseEvent(result);
  }

  /**
   * Search for events by query string
   *
   * @param query - Search query
   * @param options - Additional options
   * @returns Matching events
   */
  async searchEvents(
    query: string,
    options?: {
      calendarId?: string;
      timeMin?: string;
      timeMax?: string;
      maxResults?: number;
    }
  ): Promise<CalendarEvent[]> {
    return this.listEvents({
      ...options,
      query,
    });
  }

  /**
   * List all calendars the user has access to
   *
   * @returns Array of calendars
   */
  async listCalendars(): Promise<Calendar[]> {
    const args = ["calendars", "list"];
    const result = (await this.execGog(args)) as { items?: unknown[] };
    const items = result.items || [];
    return items.map((c) => this.parseCalendar(c));
  }

  /**
   * Get today's agenda (events from now until end of day)
   *
   * @param calendarId - Calendar ID (optional, defaults to primary)
   * @returns Today's events
   */
  async getTodaysAgenda(calendarId?: string): Promise<CalendarEvent[]> {
    const now = new Date();
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);

    return this.listEvents({
      calendarId,
      timeMin: now.toISOString(),
      timeMax: endOfDay.toISOString(),
      maxResults: 50,
    });
  }

  // ==========================================================================
  // Parsing Helpers
  // ==========================================================================

  private parseEvent(raw: unknown): CalendarEvent {
    const e = raw as Record<string, unknown>;
    return {
      id: String(e.id || ""),
      summary: String(e.summary || ""),
      description: e.description ? String(e.description) : undefined,
      location: e.location ? String(e.location) : undefined,
      start: this.parseDateTime(e.start),
      end: this.parseDateTime(e.end),
      attendees: Array.isArray(e.attendees)
        ? e.attendees.map((a: unknown) => this.parseAttendee(a))
        : undefined,
      organizer: e.organizer ? this.parseOrganizer(e.organizer) : undefined,
      status: e.status ? String(e.status) : undefined,
      htmlLink: e.htmlLink ? String(e.htmlLink) : undefined,
      hangoutLink: e.hangoutLink ? String(e.hangoutLink) : undefined,
      conferenceData: e.conferenceData
        ? this.parseConferenceData(e.conferenceData)
        : undefined,
      recurrence: Array.isArray(e.recurrence)
        ? e.recurrence.map((r: unknown) => String(r))
        : undefined,
      recurringEventId: e.recurringEventId
        ? String(e.recurringEventId)
        : undefined,
    };
  }

  private parseDateTime(raw: unknown): {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  } {
    if (!raw || typeof raw !== "object") {
      return {};
    }
    const dt = raw as Record<string, unknown>;
    return {
      dateTime: dt.dateTime ? String(dt.dateTime) : undefined,
      date: dt.date ? String(dt.date) : undefined,
      timeZone: dt.timeZone ? String(dt.timeZone) : undefined,
    };
  }

  private parseAttendee(raw: unknown): {
    email: string;
    displayName?: string;
    responseStatus?: string;
  } {
    const a = raw as Record<string, unknown>;
    return {
      email: String(a.email || ""),
      displayName: a.displayName ? String(a.displayName) : undefined,
      responseStatus: a.responseStatus ? String(a.responseStatus) : undefined,
    };
  }

  private parseOrganizer(raw: unknown): {
    email: string;
    displayName?: string;
  } {
    const o = raw as Record<string, unknown>;
    return {
      email: String(o.email || ""),
      displayName: o.displayName ? String(o.displayName) : undefined,
    };
  }

  private parseConferenceData(raw: unknown): {
    conferenceId?: string;
    conferenceSolution?: { name?: string };
    entryPoints?: Array<{ entryPointType?: string; uri?: string }>;
  } {
    const c = raw as Record<string, unknown>;
    return {
      conferenceId: c.conferenceId ? String(c.conferenceId) : undefined,
      conferenceSolution: c.conferenceSolution
        ? { name: String((c.conferenceSolution as Record<string, unknown>).name || "") }
        : undefined,
      entryPoints: Array.isArray(c.entryPoints)
        ? c.entryPoints.map((ep: unknown) => {
            const entry = ep as Record<string, unknown>;
            return {
              entryPointType: entry.entryPointType
                ? String(entry.entryPointType)
                : undefined,
              uri: entry.uri ? String(entry.uri) : undefined,
            };
          })
        : undefined,
    };
  }

  private parseCalendar(raw: unknown): Calendar {
    const c = raw as Record<string, unknown>;
    return {
      id: String(c.id || ""),
      summary: String(c.summary || ""),
      description: c.description ? String(c.description) : undefined,
      timeZone: c.timeZone ? String(c.timeZone) : undefined,
      primary: typeof c.primary === "boolean" ? c.primary : undefined,
      accessRole: c.accessRole ? String(c.accessRole) : undefined,
      backgroundColor: c.backgroundColor ? String(c.backgroundColor) : undefined,
      foregroundColor: c.foregroundColor ? String(c.foregroundColor) : undefined,
    };
  }
}

// ============================================================================
// Singleton Pattern
// ============================================================================

let _calendarService: GoogleCalendarService | null = null;

/**
 * Get the Calendar service instance (singleton)
 */
export function getCalendarService(): GoogleCalendarService {
  if (!_calendarService) {
    _calendarService = new GoogleCalendarService();
  }
  return _calendarService;
}

/**
 * Reset the Calendar service (for testing)
 */
export function resetCalendarService(): void {
  _calendarService = null;
}
