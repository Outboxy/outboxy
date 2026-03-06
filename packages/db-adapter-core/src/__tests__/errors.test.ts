import { describe, it, expect } from "vitest";
import {
  DatabaseError,
  ConnectionError,
  QueryTimeoutError,
  ConstraintViolationError,
  createWithErrorMapping,
} from "../errors.js";

describe("DatabaseError", () => {
  it("should create with message", () => {
    const error = new DatabaseError("test error");
    expect(error.message).toBe("test error");
    expect(error.name).toBe("DatabaseError");
    expect(error instanceof Error).toBe(true);
    expect(error instanceof DatabaseError).toBe(true);
  });

  it("should create with cause and code", () => {
    const cause = new Error("original");
    const error = new DatabaseError("wrapped", cause, "ERR_CODE");
    expect(error.cause).toBe(cause);
    expect(error.code).toBe("ERR_CODE");
  });

  it("should create without optional fields", () => {
    const error = new DatabaseError("minimal");
    expect(error.cause).toBeUndefined();
    expect(error.code).toBeUndefined();
  });
});

describe("ConnectionError", () => {
  it("should create with message", () => {
    const error = new ConnectionError("connection failed");
    expect(error.message).toBe("connection failed");
    expect(error.name).toBe("ConnectionError");
    expect(error.code).toBe("CONNECTION_ERROR");
    expect(error instanceof DatabaseError).toBe(true);
    expect(error instanceof ConnectionError).toBe(true);
  });

  it("should create with cause", () => {
    const cause = new Error("socket error");
    const error = new ConnectionError("failed", cause);
    expect(error.cause).toBe(cause);
  });

  it("should create without cause", () => {
    const error = new ConnectionError("no cause");
    expect(error.cause).toBeUndefined();
  });
});

describe("QueryTimeoutError", () => {
  it("should create with message", () => {
    const error = new QueryTimeoutError("query timed out");
    expect(error.message).toBe("query timed out");
    expect(error.name).toBe("QueryTimeoutError");
    expect(error.code).toBe("QUERY_TIMEOUT");
    expect(error instanceof DatabaseError).toBe(true);
    expect(error instanceof QueryTimeoutError).toBe(true);
  });

  it("should create with cause", () => {
    const cause = new Error("timeout");
    const error = new QueryTimeoutError("timed out", cause);
    expect(error.cause).toBe(cause);
  });
});

describe("ConstraintViolationError", () => {
  it("should create with message", () => {
    const error = new ConstraintViolationError("constraint violated");
    expect(error.message).toBe("constraint violated");
    expect(error.name).toBe("ConstraintViolationError");
    expect(error.code).toBe("CONSTRAINT_VIOLATION");
    expect(error instanceof DatabaseError).toBe(true);
    expect(error instanceof ConstraintViolationError).toBe(true);
  });

  it("should create with constraint name and cause", () => {
    const cause = new Error("pk violation");
    const error = new ConstraintViolationError(
      "unique violation",
      "users_email_key",
      cause,
    );
    expect(error.constraint).toBe("users_email_key");
    expect(error.cause).toBe(cause);
  });

  it("should create without constraint name", () => {
    const error = new ConstraintViolationError("violation", undefined);
    expect(error.constraint).toBeUndefined();
  });
});

describe("createWithErrorMapping", () => {
  it("should return result when operation succeeds", async () => {
    const mapError = (e: unknown) => new DatabaseError(String(e));
    const withErrorMapping = createWithErrorMapping(mapError);

    const result = await withErrorMapping(async () => 42);
    expect(result).toBe(42);
  });

  it("should map errors when operation throws", async () => {
    const mapError = (e: unknown) => new ConnectionError((e as Error).message);
    const withErrorMapping = createWithErrorMapping(mapError);

    await expect(
      withErrorMapping(async () => {
        throw new Error("original error");
      }),
    ).rejects.toBeInstanceOf(ConnectionError);
  });

  it("should preserve mapped error message", async () => {
    const mapError = (e: unknown) =>
      new QueryTimeoutError((e as Error).message);
    const withErrorMapping = createWithErrorMapping(mapError);

    await expect(
      withErrorMapping(async () => {
        throw new Error("timeout");
      }),
    ).rejects.toThrow("timeout");
  });

  it("should work with async operations returning objects", async () => {
    const mapError = (e: unknown) => new DatabaseError(String(e));
    const withErrorMapping = createWithErrorMapping(mapError);

    const result = await withErrorMapping(async () => ({
      id: "abc",
      count: 3,
    }));
    expect(result).toEqual({ id: "abc", count: 3 });
  });
});
