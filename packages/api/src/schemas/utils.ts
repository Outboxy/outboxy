import type { ZodType } from "zod";

/**
 * Convert a Zod schema to JSON Schema for Fastify
 *
 * Strips the $schema property that Zod 4 adds (draft 2020-12)
 * since Fastify's ajv only supports draft-07 by default.
 */
export function zodToFastifySchema<T extends ZodType>(
  schema: T,
): Record<string, unknown> {
  const jsonSchema = schema.toJSONSchema() as Record<string, unknown>;
  // Remove the $schema property that causes Fastify validation errors
  const { $schema: _, ...rest } = jsonSchema;
  return rest;
}
