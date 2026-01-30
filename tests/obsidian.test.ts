/**
 * Obsidian Service Tests
 *
 * Tests for the Obsidian CLI service.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { ObsidianService, resetObsidianService } from "../src/services/obsidian";

// Test vault directory
const TEST_VAULT_PATH = join(import.meta.dir, ".test-vault");

/**
 * Set up a test vault with sample notes
 */
function setupTestVault(): void {
  // Create vault directory
  if (existsSync(TEST_VAULT_PATH)) {
    rmSync(TEST_VAULT_PATH, { recursive: true });
  }
  mkdirSync(TEST_VAULT_PATH, { recursive: true });

  // Create some test notes
  writeFileSync(join(TEST_VAULT_PATH, "note1.md"), "# Note 1\n\nThis is the first note.");
  writeFileSync(join(TEST_VAULT_PATH, "note2.md"), "# Note 2\n\nThis is the second note with special content.");

  // Create a subfolder with notes
  mkdirSync(join(TEST_VAULT_PATH, "folder1"));
  writeFileSync(join(TEST_VAULT_PATH, "folder1", "nested-note.md"), "# Nested Note\n\nThis is nested.");

  // Create another subfolder
  mkdirSync(join(TEST_VAULT_PATH, "projects"));
  writeFileSync(join(TEST_VAULT_PATH, "projects", "project-a.md"), "# Project A\n\nProject A details.");
  writeFileSync(join(TEST_VAULT_PATH, "projects", "project-b.md"), "# Project B\n\nProject B details.");
}

/**
 * Clean up test vault
 */
function cleanupTestVault(): void {
  if (existsSync(TEST_VAULT_PATH)) {
    rmSync(TEST_VAULT_PATH, { recursive: true });
  }
}

describe("ObsidianService", () => {
  let obsidian: ObsidianService;

  beforeEach(() => {
    resetObsidianService();
    setupTestVault();
    obsidian = new ObsidianService({ vaultPath: TEST_VAULT_PATH });
  });

  afterEach(() => {
    cleanupTestVault();
  });

  describe("configuration", () => {
    test("should throw if vault path does not exist", () => {
      expect(() => {
        new ObsidianService({ vaultPath: "/nonexistent/path" });
      }).toThrow("Obsidian vault path does not exist");
    });

    test("should return vault path", () => {
      expect(obsidian.getVaultPath()).toBe(TEST_VAULT_PATH);
    });
  });

  describe("read operations", () => {
    test("should read a note by path", async () => {
      const note = await obsidian.readNote("note1");

      expect(note.name).toBe("note1");
      expect(note.path).toBe("note1.md");
      expect(note.content).toBe("# Note 1\n\nThis is the first note.");
      expect(note.modifiedAt).toBeInstanceOf(Date);
    });

    test("should read a note with .md extension", async () => {
      const note = await obsidian.readNote("note1.md");

      expect(note.name).toBe("note1");
      expect(note.content).toContain("Note 1");
    });

    test("should read a nested note", async () => {
      const note = await obsidian.readNote("folder1/nested-note");

      expect(note.name).toBe("nested-note");
      expect(note.path).toBe("folder1/nested-note.md");
      expect(note.content).toContain("Nested Note");
    });

    test("should throw for non-existent note", async () => {
      await expect(obsidian.readNote("nonexistent")).rejects.toThrow("Note not found");
    });

    test("should search notes by title", async () => {
      const results = await obsidian.searchNotes("note");

      expect(results.length).toBeGreaterThan(0);
      results.forEach((r) => {
        expect(r.name.toLowerCase()).toContain("note");
      });
    });

    test("should search notes with limit", async () => {
      const results = await obsidian.searchNotes("note", 1);

      expect(results.length).toBe(1);
    });

    test("should search note content", async () => {
      const results = await obsidian.searchNoteContent("special content");

      expect(results.length).toBe(1);
      expect(results[0].name).toBe("note2");
      expect(results[0].snippet).toContain("special content");
    });

    test("should list notes in folder", async () => {
      const notes = await obsidian.getNotesInFolder("projects");

      expect(notes.length).toBe(2);
      expect(notes.map((n) => n.name).sort()).toEqual(["project-a", "project-b"]);
    });

    test("should throw for non-existent folder", async () => {
      await expect(obsidian.getNotesInFolder("nonexistent")).rejects.toThrow("Folder not found");
    });

    test("should list vaults", async () => {
      const vaults = await obsidian.listVaults();

      expect(vaults.length).toBe(1);
      expect(vaults[0].path).toBe(TEST_VAULT_PATH);
    });
  });

  describe("write operations", () => {
    test("should create a new note", async () => {
      const note = await obsidian.createNote("new-note", "# New Note\n\nContent here.");

      expect(note.name).toBe("new-note");
      expect(note.path).toBe("new-note.md");
      expect(existsSync(join(TEST_VAULT_PATH, "new-note.md"))).toBe(true);

      const content = readFileSync(join(TEST_VAULT_PATH, "new-note.md"), "utf-8");
      expect(content).toBe("# New Note\n\nContent here.");
    });

    test("should create a note in a subfolder", async () => {
      const note = await obsidian.createNote("folder1/new-nested", "Nested content");

      expect(note.path).toBe("folder1/new-nested.md");
      expect(existsSync(join(TEST_VAULT_PATH, "folder1", "new-nested.md"))).toBe(true);
    });

    test("should create parent directories if needed", async () => {
      const note = await obsidian.createNote("new-folder/deep/note", "Deep content");

      expect(note.path).toBe("new-folder/deep/note.md");
      expect(existsSync(join(TEST_VAULT_PATH, "new-folder", "deep", "note.md"))).toBe(true);
    });

    test("should throw if note already exists", async () => {
      await expect(obsidian.createNote("note1", "Content")).rejects.toThrow("Note already exists");
    });

    test("should update existing note", async () => {
      const note = await obsidian.updateNote("note1", "# Updated\n\nNew content.");

      expect(note.name).toBe("note1");

      const content = readFileSync(join(TEST_VAULT_PATH, "note1.md"), "utf-8");
      expect(content).toBe("# Updated\n\nNew content.");
    });

    test("should throw when updating non-existent note", async () => {
      await expect(obsidian.updateNote("nonexistent", "Content")).rejects.toThrow("Note not found");
    });

    test("should append to existing note", async () => {
      await obsidian.appendToNote("note1", "Appended text.");

      const content = readFileSync(join(TEST_VAULT_PATH, "note1.md"), "utf-8");
      expect(content).toBe("# Note 1\n\nThis is the first note.\nAppended text.");
    });

    test("should add newline when appending if needed", async () => {
      // Create note without trailing newline
      writeFileSync(join(TEST_VAULT_PATH, "no-newline.md"), "Content without newline");

      await obsidian.appendToNote("no-newline", "Appended");

      const content = readFileSync(join(TEST_VAULT_PATH, "no-newline.md"), "utf-8");
      expect(content).toBe("Content without newline\nAppended");
    });

    test("should delete a note", async () => {
      const result = await obsidian.deleteNote("note1");

      expect(result.success).toBe(true);
      expect(existsSync(join(TEST_VAULT_PATH, "note1.md"))).toBe(false);
    });

    test("should throw when deleting non-existent note", async () => {
      await expect(obsidian.deleteNote("nonexistent")).rejects.toThrow("Note not found");
    });
  });

  describe("path validation", () => {
    test("should prevent path traversal attacks", async () => {
      const maliciousPath = "../../../etc/passwd";
      // The resolvePath method should throw
      await expect(obsidian.readNote(maliciousPath)).rejects.toThrow();
    });
  });
});
