import { describe, it, expect } from "vitest";
import { z } from "zod";
import { zodToFastifySchema, errorResponseSchema } from "../schemas/index.js";

describe("zodToFastifySchema", () => {
  it("converts a Zod object schema to JSON Schema with type and properties", () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    });

    const result = zodToFastifySchema(schema);

    expect(result.type).toBe("object");
    expect(result).toHaveProperty("properties");
    const props = result.properties as Record<string, unknown>;
    expect(props).toHaveProperty("name");
    expect(props).toHaveProperty("age");
  });

  it("strips the $schema property that Zod 4 adds", () => {
    const schema = z.object({ id: z.string() });
    const result = zodToFastifySchema(schema);

    expect(result).not.toHaveProperty("$schema");
  });

  it("works with string UUID schemas", () => {
    const schema = z.string().uuid();
    const result = zodToFastifySchema(schema);

    expect(result).not.toHaveProperty("$schema");
    expect(result.type).toBe("string");
  });

  it("works with enum schemas and includes all enum values", () => {
    const schema = z.enum(["pending", "succeeded", "failed"]);
    const result = zodToFastifySchema(schema);

    expect(result).not.toHaveProperty("$schema");
    expect(result.enum).toEqual(["pending", "succeeded", "failed"]);
  });
});

describe("schemas/index re-exports", () => {
  it("re-exports errorResponseSchema with required Zod fields (statusCode, error, message)", () => {
    const result = errorResponseSchema.safeParse({
      statusCode: 404,
      error: "Not Found",
      message: "Event not found",
    });
    expect(result.success).toBe(true);
  });

  it("errorResponseSchema rejects missing required fields", () => {
    const result = errorResponseSchema.safeParse({ statusCode: 404 });
    expect(result.success).toBe(false);
  });
});
