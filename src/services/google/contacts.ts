/**
 * Google Contacts Service (People API)
 *
 * Wraps the GOG CLI (gog contacts) for Contacts/People operations.
 * Provides typed interface for contacts and contact groups.
 */

import { GoogleBaseService, type GoogleServiceOptions } from "./base";

// ============================================================================
// Types
// ============================================================================

export interface Contact {
  resourceName: string;
  etag?: string;
  names?: Array<{
    displayName?: string;
    givenName?: string;
    familyName?: string;
    middleName?: string;
  }>;
  emailAddresses?: Array<{
    value: string;
    type?: string;
    formattedType?: string;
  }>;
  phoneNumbers?: Array<{
    value: string;
    type?: string;
    formattedType?: string;
  }>;
  addresses?: Array<{
    formattedValue?: string;
    type?: string;
    streetAddress?: string;
    city?: string;
    region?: string;
    postalCode?: string;
    country?: string;
  }>;
  organizations?: Array<{
    name?: string;
    title?: string;
    department?: string;
  }>;
  birthdays?: Array<{
    date?: {
      year?: number;
      month?: number;
      day?: number;
    };
    text?: string;
  }>;
  photos?: Array<{
    url?: string;
    default?: boolean;
  }>;
  biographies?: Array<{
    value?: string;
    contentType?: string;
  }>;
}

export interface ContactGroup {
  resourceName: string;
  etag?: string;
  name: string;
  groupType?: string;
  memberCount?: number;
}

// ============================================================================
// Google Contacts Service
// ============================================================================

export class GoogleContactsService extends GoogleBaseService {
  protected readonly serviceCommand = "contacts";

  constructor(options?: GoogleServiceOptions) {
    super(options);
  }

  // ==========================================================================
  // Read Operations
  // ==========================================================================

  /**
   * List all contacts
   *
   * @param options - Query options
   * @returns Array of contacts
   */
  async listContacts(options?: {
    pageSize?: number;
    pageToken?: string;
  }): Promise<Contact[]> {
    const args = ["list"];

    if (options?.pageSize) {
      args.push("--page-size", String(options.pageSize));
    }
    if (options?.pageToken) {
      args.push("--page-token", options.pageToken);
    }

    const result = (await this.execGog(args)) as { connections?: unknown[] };
    const connections = result.connections || [];
    return connections.map((c) => this.parseContact(c));
  }

  /**
   * Get a single contact by resource name
   *
   * @param resourceName - Contact resource name (e.g., "people/c123456")
   * @returns Contact details
   */
  async getContact(resourceName: string): Promise<Contact> {
    const args = ["get", resourceName];
    const result = await this.execGog(args);
    return this.parseContact(result);
  }

  /**
   * Search contacts by query
   *
   * @param query - Search query (name, email, phone, etc.)
   * @param options - Additional options
   * @returns Matching contacts
   */
  async searchContacts(
    query: string,
    options?: {
      pageSize?: number;
    }
  ): Promise<Contact[]> {
    const args = ["search", query];

    if (options?.pageSize) {
      args.push("--page-size", String(options.pageSize));
    }

    const result = (await this.execGog(args)) as { results?: unknown[] };
    const results = result.results || [];
    return results.map((r) => {
      // Search results wrap the person in a "person" field
      const item = r as Record<string, unknown>;
      return this.parseContact(item.person || r);
    });
  }

  /**
   * List contact groups
   *
   * @returns Array of contact groups
   */
  async listContactGroups(): Promise<ContactGroup[]> {
    const args = ["groups", "list"];
    const result = (await this.execGog(args)) as { contactGroups?: unknown[] };
    const groups = result.contactGroups || [];
    return groups.map((g) => this.parseContactGroup(g));
  }

  // ==========================================================================
  // Parsing Helpers
  // ==========================================================================

  private parseContact(raw: unknown): Contact {
    const c = raw as Record<string, unknown>;
    return {
      resourceName: String(c.resourceName || ""),
      etag: c.etag ? String(c.etag) : undefined,
      names: Array.isArray(c.names)
        ? c.names.map((n: unknown) => this.parseName(n))
        : undefined,
      emailAddresses: Array.isArray(c.emailAddresses)
        ? c.emailAddresses.map((e: unknown) => this.parseEmailAddress(e))
        : undefined,
      phoneNumbers: Array.isArray(c.phoneNumbers)
        ? c.phoneNumbers.map((p: unknown) => this.parsePhoneNumber(p))
        : undefined,
      addresses: Array.isArray(c.addresses)
        ? c.addresses.map((a: unknown) => this.parseAddress(a))
        : undefined,
      organizations: Array.isArray(c.organizations)
        ? c.organizations.map((o: unknown) => this.parseOrganization(o))
        : undefined,
      birthdays: Array.isArray(c.birthdays)
        ? c.birthdays.map((b: unknown) => this.parseBirthday(b))
        : undefined,
      photos: Array.isArray(c.photos)
        ? c.photos.map((p: unknown) => this.parsePhoto(p))
        : undefined,
      biographies: Array.isArray(c.biographies)
        ? c.biographies.map((b: unknown) => this.parseBiography(b))
        : undefined,
    };
  }

  private parseName(raw: unknown): {
    displayName?: string;
    givenName?: string;
    familyName?: string;
    middleName?: string;
  } {
    const n = raw as Record<string, unknown>;
    return {
      displayName: n.displayName ? String(n.displayName) : undefined,
      givenName: n.givenName ? String(n.givenName) : undefined,
      familyName: n.familyName ? String(n.familyName) : undefined,
      middleName: n.middleName ? String(n.middleName) : undefined,
    };
  }

  private parseEmailAddress(raw: unknown): {
    value: string;
    type?: string;
    formattedType?: string;
  } {
    const e = raw as Record<string, unknown>;
    return {
      value: String(e.value || ""),
      type: e.type ? String(e.type) : undefined,
      formattedType: e.formattedType ? String(e.formattedType) : undefined,
    };
  }

  private parsePhoneNumber(raw: unknown): {
    value: string;
    type?: string;
    formattedType?: string;
  } {
    const p = raw as Record<string, unknown>;
    return {
      value: String(p.value || ""),
      type: p.type ? String(p.type) : undefined,
      formattedType: p.formattedType ? String(p.formattedType) : undefined,
    };
  }

  private parseAddress(raw: unknown): {
    formattedValue?: string;
    type?: string;
    streetAddress?: string;
    city?: string;
    region?: string;
    postalCode?: string;
    country?: string;
  } {
    const a = raw as Record<string, unknown>;
    return {
      formattedValue: a.formattedValue ? String(a.formattedValue) : undefined,
      type: a.type ? String(a.type) : undefined,
      streetAddress: a.streetAddress ? String(a.streetAddress) : undefined,
      city: a.city ? String(a.city) : undefined,
      region: a.region ? String(a.region) : undefined,
      postalCode: a.postalCode ? String(a.postalCode) : undefined,
      country: a.country ? String(a.country) : undefined,
    };
  }

  private parseOrganization(raw: unknown): {
    name?: string;
    title?: string;
    department?: string;
  } {
    const o = raw as Record<string, unknown>;
    return {
      name: o.name ? String(o.name) : undefined,
      title: o.title ? String(o.title) : undefined,
      department: o.department ? String(o.department) : undefined,
    };
  }

  private parseBirthday(raw: unknown): {
    date?: { year?: number; month?: number; day?: number };
    text?: string;
  } {
    const b = raw as Record<string, unknown>;
    const dateObj = b.date as Record<string, unknown> | undefined;
    return {
      date: dateObj
        ? {
            year: typeof dateObj.year === "number" ? dateObj.year : undefined,
            month: typeof dateObj.month === "number" ? dateObj.month : undefined,
            day: typeof dateObj.day === "number" ? dateObj.day : undefined,
          }
        : undefined,
      text: b.text ? String(b.text) : undefined,
    };
  }

  private parsePhoto(raw: unknown): {
    url?: string;
    default?: boolean;
  } {
    const p = raw as Record<string, unknown>;
    return {
      url: p.url ? String(p.url) : undefined,
      default: typeof p.default === "boolean" ? p.default : undefined,
    };
  }

  private parseBiography(raw: unknown): {
    value?: string;
    contentType?: string;
  } {
    const b = raw as Record<string, unknown>;
    return {
      value: b.value ? String(b.value) : undefined,
      contentType: b.contentType ? String(b.contentType) : undefined,
    };
  }

  private parseContactGroup(raw: unknown): ContactGroup {
    const g = raw as Record<string, unknown>;
    return {
      resourceName: String(g.resourceName || ""),
      etag: g.etag ? String(g.etag) : undefined,
      name: String(g.name || ""),
      groupType: g.groupType ? String(g.groupType) : undefined,
      memberCount: typeof g.memberCount === "number" ? g.memberCount : undefined,
    };
  }
}

// ============================================================================
// Singleton Pattern
// ============================================================================

let _contactsService: GoogleContactsService | null = null;

/**
 * Get the Contacts service instance (singleton)
 */
export function getContactsService(): GoogleContactsService {
  if (!_contactsService) {
    _contactsService = new GoogleContactsService();
  }
  return _contactsService;
}

/**
 * Reset the Contacts service (for testing)
 */
export function resetContactsService(): void {
  _contactsService = null;
}
