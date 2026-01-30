/**
 * Mock Google Docs API
 *
 * Provides mock responses for Google Docs operations for testing
 * the GDocsWriter agent.
 */

export interface MockDocument {
  id: string;
  title: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  owner: string;
}

/**
 * Mock Google Docs service
 */
export class MockGDocsService {
  private documents: Map<string, MockDocument> = new Map();

  /**
   * Create a new document
   */
  createDocument(title: string, content: string): MockDocument {
    const id = `doc-${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date();

    const doc: MockDocument = {
      id,
      title,
      content,
      createdAt: now,
      updatedAt: now,
      owner: "user@example.com",
    };

    this.documents.set(id, doc);
    return doc;
  }

  /**
   * Get a document by ID
   */
  getDocument(id: string): MockDocument | undefined {
    return this.documents.get(id);
  }

  /**
   * Update document content
   */
  updateDocument(id: string, content: string): MockDocument | undefined {
    const doc = this.documents.get(id);
    if (doc) {
      doc.content = content;
      doc.updatedAt = new Date();
      return doc;
    }
    return undefined;
  }

  /**
   * Append to document content
   */
  appendToDocument(id: string, content: string): MockDocument | undefined {
    const doc = this.documents.get(id);
    if (doc) {
      doc.content += "\n\n" + content;
      doc.updatedAt = new Date();
      return doc;
    }
    return undefined;
  }

  /**
   * Delete a document
   */
  deleteDocument(id: string): boolean {
    return this.documents.delete(id);
  }

  /**
   * List all documents
   */
  listDocuments(): MockDocument[] {
    return Array.from(this.documents.values());
  }

  /**
   * Search documents by title
   */
  searchByTitle(query: string): MockDocument[] {
    const lowerQuery = query.toLowerCase();
    return Array.from(this.documents.values()).filter((doc) =>
      doc.title.toLowerCase().includes(lowerQuery)
    );
  }
}

// Singleton instance
let _mockGDocsService: MockGDocsService | null = null;

export function getMockGDocsService(): MockGDocsService {
  if (!_mockGDocsService) {
    _mockGDocsService = new MockGDocsService();
  }
  return _mockGDocsService;
}
