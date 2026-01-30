/**
 * Types Module Tests
 *
 * Tests for agent types and utility functions.
 */

import { describe, test, expect } from "bun:test";
import { generateId } from "../src/agents/types";

describe("Type Utilities", () => {
  test("should generate unique IDs", () => {
    const id1 = generateId();
    const id2 = generateId();
    const id3 = generateId();

    expect(id1).toBeDefined();
    expect(id2).toBeDefined();
    expect(id3).toBeDefined();

    expect(id1).not.toBe(id2);
    expect(id2).not.toBe(id3);
    expect(id1).not.toBe(id3);
  });

  test("should generate valid UUID format", () => {
    const id = generateId();

    // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    expect(id).toMatch(uuidRegex);
  });
});
