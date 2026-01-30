/**
 * Tests for the JSON-driven agent generation system
 */

import { describe, it, expect, beforeAll } from "bun:test";
import {
  validateServiceConfig,
  generateZodSchema,
  applyParameterDefaults,
  evaluateJq,
  generateAllAgentSpecs,
  loadServiceConfigs,
  initConfigChecks,
  getServicePaths,
  interpolate,
  buildCommandLine,
  extractPath,
  validatePath,
  type ServiceCli,
  type ToolCli,
} from "../src/generation";
import { readFileSync } from "fs";
import { join } from "path";

// ============================================================================
// Schema Validation Tests
// ============================================================================

describe("Service Config Validation", () => {
  it("should validate a valid Google config", () => {
    const paths = getServicePaths();
    const googleJson = readFileSync(
      join(paths.bundled, "google.json"),
      "utf-8"
    );
    const config = validateServiceConfig(JSON.parse(googleJson));

    expect(config.id).toBe("google");
    expect(config.name).toBe("Google");
    expect(config.tools.length).toBeGreaterThan(0);
    // Google uses CLI config
    expect(config.cli?.executable).toBe("gog");
    expect(config.requiredConfig).toContain("google.account");
  });

  it("should reject invalid config", () => {
    expect(() =>
      validateServiceConfig({
        id: "test",
        // Missing required fields
      })
    ).toThrow();
  });

  it("should validate tool permission values", () => {
    const paths = getServicePaths();
    const googleJson = readFileSync(
      join(paths.bundled, "google.json"),
      "utf-8"
    );
    const config = validateServiceConfig(JSON.parse(googleJson));

    for (const tool of config.tools) {
      expect(["READ", "WRITE"]).toContain(tool.permission);
    }
  });
});

// ============================================================================
// Zod Schema Generation Tests
// ============================================================================

describe("Zod Schema Generation", () => {
  it("should generate schema for string parameter", () => {
    const schema = generateZodSchema([
      {
        name: "query",
        type: "string",
        required: true,
        description: "Search query",
      },
    ]);

    const valid = schema.safeParse({ query: "test" });
    expect(valid.success).toBe(true);

    const invalid = schema.safeParse({ query: 123 });
    expect(invalid.success).toBe(false);
  });

  it("should generate schema for number parameter with constraints", () => {
    const paramDefs = [
      {
        name: "limit",
        type: "number" as const,
        max: 50,
        default: 10,
        description: "Max results",
      },
    ];
    const schema = generateZodSchema(paramDefs);

    // For OpenAI strict mode: optional params are nullable (required but accept null)
    // Null values are passed by the model when param is not provided
    const withNull = schema.safeParse({ limit: null });
    expect(withNull.success).toBe(true);

    // Defaults are applied at execution time via applyParameterDefaults
    const params = applyParameterDefaults({ limit: null }, paramDefs);
    expect(params.limit).toBe(10);

    // Within constraint
    const valid = schema.safeParse({ limit: 25 });
    expect(valid.success).toBe(true);

    // Exceeds max
    const invalid = schema.safeParse({ limit: 100 });
    expect(invalid.success).toBe(false);
  });

  it("should generate schema for string[] parameter", () => {
    const schema = generateZodSchema([
      {
        name: "to",
        type: "string[]",
        required: true,
        description: "Recipients",
      },
    ]);

    const valid = schema.safeParse({ to: ["a@b.com", "c@d.com"] });
    expect(valid.success).toBe(true);

    const invalid = schema.safeParse({ to: "not an array" });
    expect(invalid.success).toBe(false);
  });
});

// ============================================================================
// JQ Evaluator Tests (using real jq CLI)
// ============================================================================

describe("JQ Evaluator", () => {
  const testData = [
    { id: 1, name: "Alice", active: true },
    { id: 2, name: "Bob", active: false },
    { id: 3, name: "Charlie", active: true },
  ];

  it("should handle identity", async () => {
    expect(await evaluateJq(testData, ".")).toEqual(testData);
  });

  it("should handle field access", async () => {
    expect(await evaluateJq({ name: "test" }, ".name")).toBe("test");
  });

  it("should handle array iteration with field access", async () => {
    expect(await evaluateJq(testData, ".[] | .name")).toEqual([
      "Alice",
      "Bob",
      "Charlie",
    ]);
  });

  it("should handle object construction", async () => {
    const result = await evaluateJq(testData, ".[] | {id, name}");
    expect(result).toEqual([
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
      { id: 3, name: "Charlie" },
    ]);
  });

  it("should handle select filter", async () => {
    const result = await evaluateJq(testData, ".[] | select(.active == true)");
    expect(result).toEqual([
      { id: 1, name: "Alice", active: true },
      { id: 3, name: "Charlie", active: true },
    ]);
  });

  it("should handle length", async () => {
    expect(await evaluateJq(testData, "length")).toBe(3);
    expect(await evaluateJq("hello", "length")).toBe(5);
  });

  it("should handle first/last", async () => {
    expect(await evaluateJq(testData, "first")).toEqual(testData[0]);
    expect(await evaluateJq(testData, "last")).toEqual(testData[2]);
  });

  it("should handle combined operations", async () => {
    const result = await evaluateJq(
      testData,
      ".[] | select(.active == true) | {id, name}"
    );
    expect(result).toEqual([
      { id: 1, name: "Alice" },
      { id: 3, name: "Charlie" },
    ]);
  });
});

// ============================================================================
// Agent Generation Tests
// ============================================================================

describe("Agent Generation", () => {
  it("should generate reader and writer agents from Google config", () => {
    const paths = getServicePaths();
    const googleJson = readFileSync(
      join(paths.bundled, "google.json"),
      "utf-8"
    );
    const config = validateServiceConfig(JSON.parse(googleJson));

    const specs = generateAllAgentSpecs([config]);

    expect(specs.length).toBe(2); // Reader + Writer

    const reader = specs.find((s) => s.permission === "READ");
    expect(reader).toBeDefined();
    expect(reader!.id).toBe("google-reader");
    expect(reader!.name).toBe("GoogleReader");

    const writer = specs.find((s) => s.permission === "WRITE");
    expect(writer).toBeDefined();
    expect(writer!.id).toBe("google-writer");
    expect(writer!.name).toBe("GoogleWriter");
  });

  it("should include correct tools in each agent", () => {
    const paths = getServicePaths();
    const googleJson = readFileSync(
      join(paths.bundled, "google.json"),
      "utf-8"
    );
    const config = validateServiceConfig(JSON.parse(googleJson));

    const specs = generateAllAgentSpecs([config]);

    const reader = specs.find((s) => s.permission === "READ")!;
    expect(reader.toolNames).toContain("gmail_searchEmails");
    expect(reader.toolNames).toContain("gmail_getThread");
    expect(reader.toolNames).toContain("calendar_listEvents");
    expect(reader.toolNames).toContain("drive_listFiles");
    expect(reader.toolNames).not.toContain("gmail_sendEmail");

    const writer = specs.find((s) => s.permission === "WRITE")!;
    expect(writer.toolNames).toContain("gmail_sendEmail");
    expect(writer.toolNames).not.toContain("gmail_searchEmails");
  });

  it("should generate only READ_WRITE agent when agentTypes specifies it", () => {
    const paths = getServicePaths();
    const obsidianJson = readFileSync(
      join(paths.bundled, "obsidian.json"),
      "utf-8"
    );
    const config = validateServiceConfig(JSON.parse(obsidianJson));

    // Obsidian should have agentTypes: ["READ_WRITE"]
    expect(config.agentTypes).toEqual(["READ_WRITE"]);

    const specs = generateAllAgentSpecs([config]);

    // Should generate only one agent (READ_WRITE)
    expect(specs.length).toBe(1);
    expect(specs[0].permission).toBe("READ_WRITE");
    expect(specs[0].id).toBe("obsidian-agent");
    expect(specs[0].name).toBe("ObsidianAgent");

    // Should have all tools (both READ and WRITE)
    expect(specs[0].toolNames).toContain("obsidian_readNote");
    expect(specs[0].toolNames).toContain("obsidian_createNote");
    expect(specs[0].toolNames).toContain("obsidian_deleteNote");
  });

  it("should respect agentTypes override for selective agent generation", () => {
    // Create a mock config with both READ and WRITE tools but only want WRITE agent
    const config = validateServiceConfig({
      id: "test-service",
      name: "TestService",
      agentTypes: ["WRITE"],
      tools: [
        {
          name: "test_read",
          description: "Read something",
          permission: "READ",
          parameters: [],
        },
        {
          name: "test_write",
          description: "Write something",
          permission: "WRITE",
          parameters: [],
        },
      ],
    });

    const specs = generateAllAgentSpecs([config]);

    expect(specs.length).toBe(1);
    expect(specs[0].permission).toBe("WRITE");
    expect(specs[0].toolNames).toContain("test_write");
    expect(specs[0].toolNames).not.toContain("test_read");
  });
});

// ============================================================================
// Config Loader Tests
// ============================================================================

describe("Config Loader", () => {
  beforeAll(async () => {
    await initConfigChecks();
  });

  it("should find bundled configs directory", () => {
    const paths = getServicePaths();
    expect(paths.bundled).toContain("config/services");
  });

  it("should load configs with skipConfigCheck", () => {
    const configs = loadServiceConfigs({ skipConfigCheck: true });
    expect(configs.length).toBeGreaterThan(0);
    expect(configs.some((c) => c.id === "google")).toBe(true);
  });

  it("should filter by service ids", () => {
    const configs = loadServiceConfigs({
      skipConfigCheck: true,
      filterIds: ["google"],
    });
    expect(configs.length).toBe(1);
    expect(configs[0].id).toBe("google");
  });

  it("should return empty array for non-existent service", () => {
    const configs = loadServiceConfigs({
      skipConfigCheck: true,
      filterIds: ["non-existent-service"],
    });
    expect(configs.length).toBe(0);
  });
});

// ============================================================================
// CLI Executor Tests
// ============================================================================

describe("CLI Executor", () => {
  describe("interpolate", () => {
    it("should replace placeholders with values", () => {
      const result = interpolate("Hello {name}!", { name: "World" });
      expect(result).toBe("Hello World!");
    });

    it("should handle multiple placeholders", () => {
      const result = interpolate("{greeting} {name}!", { greeting: "Hello", name: "World" });
      expect(result).toBe("Hello World!");
    });

    it("should keep unresolved placeholders", () => {
      const result = interpolate("Hello {name}!", {});
      expect(result).toBe("Hello {name}!");
    });

    it("should handle array values", () => {
      const result = interpolate("--to {recipients}", { recipients: ["a@b.com", "c@d.com"] });
      expect(result).toBe("--to a@b.com,c@d.com");
    });
  });

  describe("buildCommandLine", () => {
    it("should build basic command line", () => {
      const serviceCli: ServiceCli = {
        executable: "gog",
        service: "gmail",
        outputFormat: "json",
        globalFlags: ["--json"],
      };

      const toolCli: ToolCli = {
        command: "search",
        args: ["{query}"],
      };

      const args = buildCommandLine(serviceCli, toolCli, { query: "is:unread" });
      // Command comes before global flags: gog gmail search --json is:unread
      expect(args).toEqual(["gmail", "search", "--json", "is:unread"]);
    });

    it("should add flags when parameters are provided", () => {
      const serviceCli: ServiceCli = {
        executable: "gog",
        service: "gmail",
        outputFormat: "json",
      };

      const toolCli: ToolCli = {
        command: "search",
        args: ["{query}"],
        flags: {
          max: "--max {max}",
        },
      };

      const args = buildCommandLine(serviceCli, toolCli, { query: "test", max: 10 });
      expect(args).toEqual(["gmail", "search", "test", "--max", "10"]);
    });

    it("should skip flags when parameters are missing", () => {
      const serviceCli: ServiceCli = {
        executable: "gog",
        service: "gmail",
        outputFormat: "json",
      };

      const toolCli: ToolCli = {
        command: "search",
        args: ["{query}"],
        flags: {
          max: "--max {max}",
        },
      };

      const args = buildCommandLine(serviceCli, toolCli, { query: "test" });
      expect(args).toEqual(["gmail", "search", "test"]);
    });
  });

  describe("extractPath", () => {
    it("should extract simple property", () => {
      const data = { threads: [{ id: 1 }, { id: 2 }] };
      expect(extractPath(data, "threads")).toEqual([{ id: 1 }, { id: 2 }]);
    });

    it("should extract nested property", () => {
      const data = { response: { data: { items: [1, 2, 3] } } };
      expect(extractPath(data, "response.data.items")).toEqual([1, 2, 3]);
    });

    it("should extract array index", () => {
      const data = { messages: [{ id: 1 }, { id: 2 }] };
      expect(extractPath(data, "messages[0]")).toEqual({ id: 1 });
    });

    it("should handle empty path", () => {
      const data = { foo: "bar" };
      expect(extractPath(data, "")).toEqual(data);
    });

    it("should return undefined for missing path", () => {
      const data = { foo: "bar" };
      expect(extractPath(data, "baz")).toBeUndefined();
    });
  });
});

// ============================================================================
// Filesystem Executor Tests
// ============================================================================

describe("Filesystem Executor", () => {
  describe("validatePath", () => {
    it("should allow paths within base directory", () => {
      const result = validatePath("/base/path", "subdir/file.md");
      expect(result).toBe("/base/path/subdir/file.md");
    });

    it("should reject paths that escape base directory", () => {
      expect(() => validatePath("/base/path", "../outside")).toThrow("escapes base");
    });

    it("should reject paths with ../ in the middle", () => {
      expect(() => validatePath("/base/path", "subdir/../../outside")).toThrow("escapes base");
    });

    it("should handle absolute paths within base", () => {
      // This tests that the function doesn't break on edge cases
      const result = validatePath("/base/path", "./subdir/file.md");
      expect(result.startsWith("/base/path")).toBe(true);
    });
  });
});
