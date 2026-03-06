import { describe, it, expect } from "vitest";
import {
  mapPostgresError,
  DatabaseError,
  ConnectionError,
  QueryTimeoutError,
  ConstraintViolationError,
} from "../errors.js";

function pgError(code: string, message = "test error", constraint?: string) {
  return { code, message, constraint };
}

describe("mapPostgresError", () => {
  it("should return existing DatabaseError as-is", () => {
    const err = new DatabaseError("already mapped");
    const result = mapPostgresError(err);
    expect(result).toBe(err);
  });

  it("should return existing ConnectionError as-is (subclass of DatabaseError)", () => {
    const err = new ConnectionError("already connection error");
    const result = mapPostgresError(err);
    expect(result).toBe(err);
  });

  describe("constraint violations", () => {
    it("should map UNIQUE_VIOLATION (23505) to ConstraintViolationError with unique prefix", () => {
      const result = mapPostgresError(
        pgError("23505", "duplicate key", "users_email_key"),
      );
      expect(result).toBeInstanceOf(ConstraintViolationError);
      expect(result.message).toContain("Unique constraint violation");
      expect((result as ConstraintViolationError).constraint).toBe(
        "users_email_key",
      );
    });

    it("should map FOREIGN_KEY_VIOLATION (23503) to ConstraintViolationError", () => {
      const result = mapPostgresError(
        pgError("23503", "fk error", "fk_constraint"),
      );
      expect(result).toBeInstanceOf(ConstraintViolationError);
      expect(result.message).toBe("fk error");
    });

    it("should map CHECK_VIOLATION (23514) to ConstraintViolationError", () => {
      const result = mapPostgresError(pgError("23514", "check error"));
      expect(result).toBeInstanceOf(ConstraintViolationError);
    });

    it("should map NOT_NULL_VIOLATION (23502) to ConstraintViolationError", () => {
      const result = mapPostgresError(pgError("23502", "null error"));
      expect(result).toBeInstanceOf(ConstraintViolationError);
    });
  });

  describe("connection errors", () => {
    it("should map CONNECTION_FAILURE (08006) to ConnectionError", () => {
      const result = mapPostgresError(pgError("08006"));
      expect(result).toBeInstanceOf(ConnectionError);
    });

    it("should map CONNECTION_EXCEPTION (08000) to ConnectionError", () => {
      const result = mapPostgresError(pgError("08000"));
      expect(result).toBeInstanceOf(ConnectionError);
    });

    it("should map CONNECTION_DOES_NOT_EXIST (08003) to ConnectionError", () => {
      const result = mapPostgresError(pgError("08003"));
      expect(result).toBeInstanceOf(ConnectionError);
    });

    it("should map SQLCLIENT_UNABLE_TO_ESTABLISH (08001) to ConnectionError", () => {
      const result = mapPostgresError(pgError("08001"));
      expect(result).toBeInstanceOf(ConnectionError);
    });

    it("should map SQLSERVER_REJECTED (08004) to ConnectionError", () => {
      const result = mapPostgresError(pgError("08004"));
      expect(result).toBeInstanceOf(ConnectionError);
    });

    it("should map ADMIN_SHUTDOWN (57P01) to ConnectionError", () => {
      const result = mapPostgresError(pgError("57P01"));
      expect(result).toBeInstanceOf(ConnectionError);
    });
  });

  describe("timeout errors", () => {
    it("should map QUERY_CANCELED (57014) to QueryTimeoutError", () => {
      const result = mapPostgresError(pgError("57014", "query was cancelled"));
      expect(result).toBeInstanceOf(QueryTimeoutError);
      expect(result.message).toBe("query was cancelled");
    });

    it("should map LOCK_NOT_AVAILABLE (55P03) to QueryTimeoutError with lock message", () => {
      const result = mapPostgresError(pgError("55P03"));
      expect(result).toBeInstanceOf(QueryTimeoutError);
      expect(result.message).toBe("Lock acquisition timeout");
    });
  });

  describe("generic errors", () => {
    it("should map unknown error codes to DatabaseError with code", () => {
      const result = mapPostgresError(pgError("99999", "unknown pg error"));
      expect(result).toBeInstanceOf(DatabaseError);
      expect(result.message).toBe("unknown pg error");
      expect(result.code).toBe("99999");
    });

    it("should use 'Unknown database error' when message is missing", () => {
      const result = mapPostgresError({ code: "99999" });
      expect(result).toBeInstanceOf(DatabaseError);
      expect(result.message).toBe("Unknown database error");
    });

    it("should handle error without code (default branch)", () => {
      const result = mapPostgresError({ message: "no code error" });
      expect(result).toBeInstanceOf(DatabaseError);
      expect(result.message).toBe("no code error");
    });

    it("should handle non-object errors", () => {
      const result = mapPostgresError("string error");
      expect(result).toBeInstanceOf(DatabaseError);
    });
  });

  describe("withErrorMapping integration", () => {
    it("should wrap errors through withErrorMapping", async () => {
      const { withErrorMapping } = await import("../errors.js");

      await expect(
        withErrorMapping(async () => {
          throw pgError("23505", "dup key", "my_constraint");
        }),
      ).rejects.toBeInstanceOf(ConstraintViolationError);
    });

    it("should not re-wrap DatabaseError", async () => {
      const { withErrorMapping } = await import("../errors.js");
      const original = new QueryTimeoutError("original timeout");

      let caught: unknown;
      try {
        await withErrorMapping(async () => {
          throw original;
        });
      } catch (e) {
        caught = e;
      }

      expect(caught).toBe(original);
    });
  });
});
