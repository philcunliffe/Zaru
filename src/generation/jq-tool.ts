/**
 * JQ Tool for Dynamic Agents
 *
 * Provides a jq data transformation tool using the real jq CLI.
 * This is added to every generated agent for data manipulation.
 */

import { tool } from "ai";
import { z } from "zod";

/**
 * Create the jq tool for use with Vercel AI SDK
 *
 * This tool allows agents to transform JSON data using jq syntax.
 * It uses the real jq CLI for full jq compatibility.
 */
export function createJqTool() {
  return tool({
    description: `Transform JSON data using jq. Pipe data through jq filters for extraction, transformation, and filtering.

Common patterns:
- Extract field: .fieldName
- Array iteration: .[]
- Filter array: .[] | select(.status == "active")
- Build objects: {id, name, email: .contact.email}
- Get length: length
- First/last: first, last
- Map over array: map(.fieldName)
- Sort: sort_by(.date)
- Unique values: unique
- Limit results: limit(5; .[])

Examples:
- Get all names: '.[] | .name'
- Filter by status: '.[] | select(.active == true)'
- Extract subset: '.[] | {id, title, author: .metadata.author}'
- Count items: 'length'`,

    parameters: z.object({
      data: z.string().describe("JSON string to transform (will be piped to jq stdin)"),
      filter: z.string().describe("jq filter expression"),
    }),

    execute: async ({ data, filter }) => {
      try {
        const result = await executeJq(data, filter);
        return { success: true, result };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
  });
}

/**
 * Evaluate a jq expression on data (for testing/direct use)
 * This is a convenience wrapper around the CLI execution.
 *
 * @param data - Any JSON-serializable value (will be JSON.stringify'd)
 * @param filter - jq filter expression
 */
export async function evaluateJq(data: unknown, filter: string): Promise<unknown> {
  // Always JSON-encode the data so jq receives valid JSON input
  const dataStr = JSON.stringify(data);
  return executeJq(dataStr, filter);
}

/**
 * Execute jq CLI and parse the output.
 * Handles jq's newline-delimited JSON output format.
 */
async function executeJq(data: string, filter: string): Promise<unknown> {
  const { spawn } = await import("child_process");

  return new Promise((resolve, reject) => {
    // Use -c for compact output (one JSON value per line)
    const proc = spawn("jq", ["-c", filter], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("close", (code: number | null) => {
      if (code !== 0) {
        reject(new Error(`jq failed (exit ${code}): ${stderr || stdout}`));
        return;
      }

      try {
        // jq outputs newline-delimited JSON (NDJSON)
        // Split by newlines and parse each value
        const lines = stdout.trim().split("\n").filter(line => line.length > 0);

        if (lines.length === 0) {
          resolve(null);
        } else if (lines.length === 1) {
          // Single value - return as-is
          resolve(JSON.parse(lines[0]));
        } else {
          // Multiple values - return as array
          resolve(lines.map(line => JSON.parse(line)));
        }
      } catch (parseError) {
        reject(new Error(`Failed to parse jq output: ${parseError instanceof Error ? parseError.message : String(parseError)}\nOutput: ${stdout}`));
      }
    });

    proc.on("error", (error: Error) => {
      reject(new Error(`Failed to execute jq: ${error.message}`));
    });

    // Write data to stdin
    proc.stdin.write(data);
    proc.stdin.end();
  });
}
