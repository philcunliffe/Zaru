/**
 * Zod Schema Generator
 *
 * Converts JSON parameter definitions to Zod schemas at runtime.
 * This allows tools to be defined in JSON and have their parameters
 * validated at runtime with proper type checking.
 *
 * IMPORTANT: OpenAI strict mode compatibility
 * OpenAI's function calling with strict mode requires ALL properties to be
 * in the JSON Schema 'required' array. This means we cannot use Zod's
 * .optional() or .default() methods, as they remove fields from 'required'.
 *
 * Instead, we:
 * 1. Make all fields required in the schema (use .nullable() for optional fields)
 * 2. Apply defaults at execution time via applyParameterDefaults()
 */

import { z } from "zod";
import type { Parameter, ParameterType } from "./schema";

/**
 * Create a Zod schema for a single parameter based on its type and constraints
 * @param param - Parameter definition from JSON
 * @returns Zod schema for this parameter
 */
function createParameterSchema(param: Parameter): z.ZodTypeAny {
  let schema: z.ZodTypeAny;

  switch (param.type) {
    case "string":
      schema = z.string();
      if (param.enum && param.enum.length > 0) {
        schema = z.enum(param.enum as [string, ...string[]]);
      }
      break;

    case "number":
      let numSchema = z.number();
      if (param.min !== undefined) {
        numSchema = numSchema.min(param.min);
      }
      if (param.max !== undefined) {
        numSchema = numSchema.max(param.max);
      }
      schema = numSchema;
      break;

    case "boolean":
      schema = z.boolean();
      break;

    case "string[]":
      schema = z.array(z.string());
      break;

    case "number[]":
      schema = z.array(z.number());
      break;

    case "object":
      // For object types, we use z.record() which allows any string keys
      // In the future, we could support nested parameter definitions
      schema = z.record(z.unknown());
      break;

    default:
      // Fallback for unknown types
      schema = z.unknown();
  }

  // Add description
  schema = schema.describe(param.description);

  // OpenAI strict mode requires ALL properties in the 'required' array.
  // We use .nullable() for optional parameters instead of .optional(),
  // which keeps them in 'required' but allows null values.
  // Defaults are applied at execution time via applyParameterDefaults().
  if (!param.required) {
    schema = schema.nullable();
  }

  return schema;
}

/**
 * Generate a Zod object schema from an array of parameter definitions
 * @param parameters - Array of parameter definitions from JSON
 * @returns Zod object schema for tool parameters
 */
export function generateZodSchema(
  parameters: Parameter[]
): z.ZodObject<z.ZodRawShape> {
  const shape: z.ZodRawShape = {};

  for (const param of parameters) {
    shape[param.name] = createParameterSchema(param);
  }

  return z.object(shape);
}

/**
 * Generate a description string for tool parameters
 * This creates a human-readable description of expected parameters
 * @param parameters - Array of parameter definitions
 * @returns Description string
 */
export function generateParameterDescription(parameters: Parameter[]): string {
  if (parameters.length === 0) {
    return "No parameters required.";
  }

  const lines = parameters.map((p) => {
    const requiredMark = p.required ? " (required)" : "";
    const defaultMark = p.default !== undefined ? ` [default: ${JSON.stringify(p.default)}]` : "";
    return `- ${p.name}: ${p.type}${requiredMark}${defaultMark} - ${p.description}`;
  });

  return lines.join("\n");
}

/**
 * Type helper to extract the inferred type from a generated schema
 */
export type InferredParams<T extends z.ZodObject<z.ZodRawShape>> = z.infer<T>;

/**
 * Apply default values to parameters that are null or undefined.
 * This is called at execution time since we can't use Zod's .default()
 * (which would remove fields from the 'required' array in JSON Schema).
 *
 * @param params - The parameters received from the LLM
 * @param paramDefs - The parameter definitions with defaults
 * @returns Parameters with defaults applied
 */
export function applyParameterDefaults(
  params: Record<string, unknown>,
  paramDefs: Parameter[]
): Record<string, unknown> {
  const result = { ...params };

  for (const paramDef of paramDefs) {
    if (paramDef.default !== undefined) {
      // Apply default if value is null or undefined
      if (result[paramDef.name] === null || result[paramDef.name] === undefined) {
        result[paramDef.name] = paramDef.default;
      }
    }
  }

  return result;
}
