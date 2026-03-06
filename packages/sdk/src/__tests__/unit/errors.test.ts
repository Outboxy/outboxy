/**
 * Error Types Unit Tests
 *
 * Tests custom error classes for proper inheritance, properties, and serialization.
 */

import { describe, it, expect } from "vitest";
import {
  OutboxyError,
  OutboxyValidationError,
  OutboxyConnectionError,
  OutboxyDuplicateError,
  isConnectionError,
} from "../../errors.js";

describe("OutboxyError", () => {
  it("should create error with message and code", () => {
    const error = new OutboxyError("Test error", "TEST_CODE");

    expect(error.message).toBe("Test error");
    expect(error.code).toBe("TEST_CODE");
    expect(error.name).toBe("OutboxyError");
  });

  it("should be instanceof Error", () => {
    const error = new OutboxyError("Test", "CODE");

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(OutboxyError);
  });

  it("should have stack trace", () => {
    const error = new OutboxyError("Test", "CODE");

    expect(error.stack).toBeDefined();
    expect(error.stack).toContain("OutboxyError");
  });

  it("should serialize to JSON with all properties", () => {
    const error = new OutboxyError("Test error", "TEST_CODE");
    const json = error.toJSON();

    expect(json.name).toBe("OutboxyError");
    expect(json.code).toBe("TEST_CODE");
    expect(json.message).toBe("Test error");
    expect(json.stack).toBeDefined();
  });

  it("should work with JSON.stringify", () => {
    const error = new OutboxyError("Test error", "TEST_CODE");
    const serialized = JSON.stringify(error);
    const parsed = JSON.parse(serialized);

    expect(parsed.name).toBe("OutboxyError");
    expect(parsed.code).toBe("TEST_CODE");
    expect(parsed.message).toBe("Test error");
  });
});

describe("OutboxyValidationError", () => {
  it("should create error with message only", () => {
    const error = new OutboxyValidationError("Invalid input");

    expect(error.message).toBe("Invalid input");
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.name).toBe("OutboxyValidationError");
    expect(error.field).toBeUndefined();
  });

  it("should create error with message and field", () => {
    const error = new OutboxyValidationError(
      "Field is required",
      "destinationUrl",
    );

    expect(error.message).toBe("Field is required");
    expect(error.field).toBe("destinationUrl");
    expect(error.code).toBe("VALIDATION_ERROR");
  });

  it("should be instanceof OutboxyError and Error", () => {
    const error = new OutboxyValidationError("Test");

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(OutboxyError);
    expect(error).toBeInstanceOf(OutboxyValidationError);
  });

  it("should serialize to JSON with field", () => {
    const error = new OutboxyValidationError("Invalid key", "idempotencyKey");
    const json = error.toJSON();

    expect(json.name).toBe("OutboxyValidationError");
    expect(json.code).toBe("VALIDATION_ERROR");
    expect(json.field).toBe("idempotencyKey");
    expect(json.message).toBe("Invalid key");
  });

  it("should serialize to JSON without field when undefined", () => {
    const error = new OutboxyValidationError("Invalid input");
    const json = error.toJSON();

    expect(json.field).toBeUndefined();
  });
});

describe("OutboxyConnectionError", () => {
  it("should create error with message only", () => {
    const error = new OutboxyConnectionError("Connection failed");

    expect(error.message).toBe("Connection failed");
    expect(error.code).toBe("CONNECTION_ERROR");
    expect(error.name).toBe("OutboxyConnectionError");
    expect(error.cause).toBeUndefined();
  });

  it("should create error with message and cause", () => {
    const originalError = new Error("ECONNREFUSED");
    const error = new OutboxyConnectionError(
      "Connection failed",
      originalError,
    );

    expect(error.message).toBe("Connection failed");
    expect(error.cause).toBe(originalError);
    expect(error.cause?.message).toBe("ECONNREFUSED");
  });

  it("should be instanceof OutboxyError and Error", () => {
    const error = new OutboxyConnectionError("Test");

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(OutboxyError);
    expect(error).toBeInstanceOf(OutboxyConnectionError);
  });

  it("should serialize to JSON with cause", () => {
    const originalError = new Error("Original error");
    originalError.name = "PgError";
    const error = new OutboxyConnectionError(
      "Connection failed",
      originalError,
    );
    const json = error.toJSON();

    expect(json.name).toBe("OutboxyConnectionError");
    expect(json.code).toBe("CONNECTION_ERROR");
    expect(json.cause).toEqual({
      name: "PgError",
      message: "Original error",
    });
  });

  it("should serialize to JSON without cause when undefined", () => {
    const error = new OutboxyConnectionError("Connection failed");
    const json = error.toJSON();

    expect(json.cause).toBeUndefined();
  });
});

describe("OutboxyDuplicateError", () => {
  it("should create error with all properties", () => {
    const error = new OutboxyDuplicateError(
      "Duplicate key found",
      "evt-123-456",
      "order-created-789",
    );

    expect(error.message).toBe("Duplicate key found");
    expect(error.code).toBe("DUPLICATE_IDEMPOTENCY_KEY");
    expect(error.name).toBe("OutboxyDuplicateError");
    expect(error.existingEventId).toBe("evt-123-456");
    expect(error.idempotencyKey).toBe("order-created-789");
  });

  it("should be instanceof OutboxyError and Error", () => {
    const error = new OutboxyDuplicateError("Test", "id", "key");

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(OutboxyError);
    expect(error).toBeInstanceOf(OutboxyDuplicateError);
  });

  it("should serialize to JSON with all properties", () => {
    const error = new OutboxyDuplicateError(
      "Duplicate found",
      "event-id-123",
      "idem-key-456",
    );
    const json = error.toJSON();

    expect(json.name).toBe("OutboxyDuplicateError");
    expect(json.code).toBe("DUPLICATE_IDEMPOTENCY_KEY");
    expect(json.message).toBe("Duplicate found");
    expect(json.existingEventId).toBe("event-id-123");
    expect(json.idempotencyKey).toBe("idem-key-456");
  });
});

describe("isConnectionError", () => {
  it("should return false for non-Error values", () => {
    expect(isConnectionError(null)).toBe(false);
    expect(isConnectionError(undefined)).toBe(false);
    expect(isConnectionError("string")).toBe(false);
    expect(isConnectionError(123)).toBe(false);
    expect(isConnectionError({})).toBe(false);
  });

  it("should return false for regular errors without code", () => {
    const error = new Error("Something went wrong");
    expect(isConnectionError(error)).toBe(false);
  });

  it("should return true for ECONNREFUSED", () => {
    const error = new Error("Connection refused") as Error & { code: string };
    error.code = "ECONNREFUSED";
    expect(isConnectionError(error)).toBe(true);
  });

  it("should return true for ENOTFOUND", () => {
    const error = new Error("Host not found") as Error & { code: string };
    error.code = "ENOTFOUND";
    expect(isConnectionError(error)).toBe(true);
  });

  it("should return true for ETIMEDOUT", () => {
    const error = new Error("Connection timed out") as Error & { code: string };
    error.code = "ETIMEDOUT";
    expect(isConnectionError(error)).toBe(true);
  });

  it("should return true for ECONNRESET", () => {
    const error = new Error("Connection reset") as Error & { code: string };
    error.code = "ECONNRESET";
    expect(isConnectionError(error)).toBe(true);
  });

  it("should return true for PostgreSQL connection exception codes", () => {
    const pgCodes = ["57P01", "57P02", "57P03", "08000", "08003", "08006"];

    for (const code of pgCodes) {
      const error = new Error("PG error") as Error & { code: string };
      error.code = code;
      expect(isConnectionError(error)).toBe(true);
    }
  });

  it("should return false for other PostgreSQL error codes", () => {
    const error = new Error("Unique violation") as Error & { code: string };
    error.code = "23505";
    expect(isConnectionError(error)).toBe(false);
  });
});

describe("Error type discrimination", () => {
  it("should allow type narrowing with instanceof", () => {
    const errors: OutboxyError[] = [
      new OutboxyValidationError("Validation failed", "field"),
      new OutboxyConnectionError("Connection failed"),
      new OutboxyDuplicateError("Duplicate", "id", "key"),
    ];

    for (const error of errors) {
      if (error instanceof OutboxyValidationError) {
        expect(error.field).toBeDefined();
      } else if (error instanceof OutboxyConnectionError) {
        expect(error.cause).toBeUndefined();
      } else if (error instanceof OutboxyDuplicateError) {
        expect(error.existingEventId).toBe("id");
        expect(error.idempotencyKey).toBe("key");
      }
    }
  });

  it("should allow discrimination by code property", () => {
    const error: OutboxyError = new OutboxyValidationError("Test");

    switch (error.code) {
      case "VALIDATION_ERROR":
        expect(error).toBeInstanceOf(OutboxyValidationError);
        break;
      case "CONNECTION_ERROR":
        expect(error).toBeInstanceOf(OutboxyConnectionError);
        break;
      case "DUPLICATE_IDEMPOTENCY_KEY":
        expect(error).toBeInstanceOf(OutboxyDuplicateError);
        break;
      default:
        throw new Error("Unknown error code");
    }
  });
});
