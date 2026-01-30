/**
 * Mock Services Tests
 *
 * Tests for mock email and Google Docs services.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { MockEmailService, generateMockEmails } from "../src/mocks/email";
import { MockGDocsService, getMockGDocsService } from "../src/mocks/gdocs";

describe("Mock Email Service", () => {
  let emailService: MockEmailService;

  beforeEach(() => {
    emailService = new MockEmailService();
  });

  test("should generate mock emails", () => {
    const emails = generateMockEmails();

    expect(emails.length).toBe(12);
    expect(emails[0]).toHaveProperty("id");
    expect(emails[0]).toHaveProperty("from");
    expect(emails[0]).toHaveProperty("to");
    expect(emails[0]).toHaveProperty("subject");
    expect(emails[0]).toHaveProperty("body");
    expect(emails[0]).toHaveProperty("receivedAt");
    expect(emails[0]).toHaveProperty("isRead");
  });

  test("should get emails with pagination", () => {
    const firstPage = emailService.getEmails(5, 0);
    const secondPage = emailService.getEmails(5, 5);

    expect(firstPage.length).toBe(5);
    expect(secondPage.length).toBe(5);
    expect(firstPage[0].id).not.toBe(secondPage[0].id);
  });

  test("should get email by ID", () => {
    const email = emailService.getEmail("email-1");

    expect(email).toBeDefined();
    expect(email?.id).toBe("email-1");
  });

  test("should return undefined for non-existent email", () => {
    const email = emailService.getEmail("non-existent");

    expect(email).toBeUndefined();
  });

  test("should get unread emails", () => {
    const unread = emailService.getUnreadEmails();

    expect(unread.length).toBeGreaterThan(0);
    unread.forEach((email) => {
      expect(email.isRead).toBe(false);
    });
  });

  test("should mark email as read", () => {
    const result = emailService.markAsRead("email-1");
    const email = emailService.getEmail("email-1");

    expect(result).toBe(true);
    expect(email?.isRead).toBe(true);
  });

  test("should return false when marking non-existent email as read", () => {
    const result = emailService.markAsRead("non-existent");

    expect(result).toBe(false);
  });

  test("should return total email count", () => {
    const count = emailService.getCount();

    expect(count).toBe(12);
  });

  test("should include emails with injection attempts", () => {
    const emails = emailService.getEmails(20);
    const injectionEmails = emails.filter(
      (e) =>
        e.body.includes("IGNORE ALL PREVIOUS INSTRUCTIONS") ||
        e.body.includes("[IMPORTANT SYSTEM MESSAGE]")
    );

    expect(injectionEmails.length).toBeGreaterThan(0);
  });
});

describe("Mock Google Docs Service", () => {
  let gdocsService: MockGDocsService;

  beforeEach(() => {
    gdocsService = new MockGDocsService();
  });

  test("should create a new document", () => {
    const doc = gdocsService.createDocument(
      "Test Document",
      "This is the content"
    );

    expect(doc.id).toBeDefined();
    expect(doc.id).toMatch(/^doc-/);
    expect(doc.title).toBe("Test Document");
    expect(doc.content).toBe("This is the content");
    expect(doc.owner).toBe("user@example.com");
    expect(doc.createdAt).toBeInstanceOf(Date);
    expect(doc.updatedAt).toBeInstanceOf(Date);
  });

  test("should get document by ID", () => {
    const created = gdocsService.createDocument("Test", "Content");
    const retrieved = gdocsService.getDocument(created.id);

    expect(retrieved).toEqual(created);
  });

  test("should return undefined for non-existent document", () => {
    const doc = gdocsService.getDocument("doc-nonexistent");

    expect(doc).toBeUndefined();
  });

  test("should update document content", () => {
    const doc = gdocsService.createDocument("Test", "Original content");
    const originalUpdatedAt = doc.updatedAt;

    // Small delay to ensure different timestamp
    const updated = gdocsService.updateDocument(doc.id, "New content");

    expect(updated).toBeDefined();
    expect(updated?.content).toBe("New content");
    expect(updated?.title).toBe("Test");
    expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(
      originalUpdatedAt.getTime()
    );
  });

  test("should append to document content", () => {
    const doc = gdocsService.createDocument("Test", "Original content");
    const appended = gdocsService.appendToDocument(doc.id, "Appended content");

    expect(appended).toBeDefined();
    expect(appended?.content).toBe("Original content\n\nAppended content");
  });

  test("should delete a document", () => {
    const doc = gdocsService.createDocument("Test", "Content");
    const deleted = gdocsService.deleteDocument(doc.id);
    const retrieved = gdocsService.getDocument(doc.id);

    expect(deleted).toBe(true);
    expect(retrieved).toBeUndefined();
  });

  test("should return false when deleting non-existent document", () => {
    const deleted = gdocsService.deleteDocument("doc-nonexistent");

    expect(deleted).toBe(false);
  });

  test("should list all documents", () => {
    gdocsService.createDocument("Doc 1", "Content 1");
    gdocsService.createDocument("Doc 2", "Content 2");
    gdocsService.createDocument("Doc 3", "Content 3");

    const docs = gdocsService.listDocuments();

    expect(docs.length).toBe(3);
  });

  test("should search documents by title", () => {
    gdocsService.createDocument("Email Summary", "Content");
    gdocsService.createDocument("Meeting Notes", "Content");
    gdocsService.createDocument("Email Draft", "Content");

    const results = gdocsService.searchByTitle("email");

    expect(results.length).toBe(2);
    results.forEach((doc) => {
      expect(doc.title.toLowerCase()).toContain("email");
    });
  });
});
