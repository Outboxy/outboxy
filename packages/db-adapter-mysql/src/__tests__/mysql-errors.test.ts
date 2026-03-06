import { describe, it, expect } from "vitest";
import {
  mapMySQLError,
  DatabaseError,
  ConnectionError,
  QueryTimeoutError,
  ConstraintViolationError,
} from "../errors.js";

function mysqlError(
  errno: number,
  sqlMessage = "test sql error",
  message = "test message",
) {
  return { errno, sqlMessage, message };
}

describe("mapMySQLError", () => {
  it("should return existing DatabaseError as-is", () => {
    const err = new DatabaseError("already mapped");
    const result = mapMySQLError(err);
    expect(result).toBe(err);
  });

  it("should return existing ConnectionError as-is (subclass of DatabaseError)", () => {
    const err = new ConnectionError("already connection error");
    const result = mapMySQLError(err);
    expect(result).toBe(err);
  });

  describe("constraint violations", () => {
    it("should map DUPLICATE_ENTRY (1062) to ConstraintViolationError with duplicate prefix", () => {
      const result = mapMySQLError(mysqlError(1062, "Duplicate entry for key"));
      expect(result).toBeInstanceOf(ConstraintViolationError);
      expect(result.message).toContain("Duplicate entry");
    });

    it("should map FOREIGN_KEY_CONSTRAINT (1451) to ConstraintViolationError", () => {
      const result = mapMySQLError(mysqlError(1451, "fk violation"));
      expect(result).toBeInstanceOf(ConstraintViolationError);
      expect(result.message).toBe("fk violation");
    });

    it("should map FOREIGN_KEY_CONSTRAINT_ADD (1452) to ConstraintViolationError", () => {
      const result = mapMySQLError(mysqlError(1452, "fk add violation"));
      expect(result).toBeInstanceOf(ConstraintViolationError);
    });

    it("should map CHECK_CONSTRAINT (3819) to ConstraintViolationError", () => {
      const result = mapMySQLError(mysqlError(3819, "check violation"));
      expect(result).toBeInstanceOf(ConstraintViolationError);
    });

    it("should map NOT_NULL_VIOLATION (1048) to ConstraintViolationError", () => {
      const result = mapMySQLError(mysqlError(1048, "null violation"));
      expect(result).toBeInstanceOf(ConstraintViolationError);
    });
  });

  describe("connection errors", () => {
    it("should map CONNECTION_ERROR (2002) to ConnectionError", () => {
      const result = mapMySQLError(mysqlError(2002, "connection refused"));
      expect(result).toBeInstanceOf(ConnectionError);
      expect(result.message).toBe("connection refused");
    });

    it("should map CONNECTION_LOST (2013) to ConnectionError", () => {
      const result = mapMySQLError(mysqlError(2013, "connection lost"));
      expect(result).toBeInstanceOf(ConnectionError);
    });

    it("should map ACCESS_DENIED (1045) to ConnectionError", () => {
      const result = mapMySQLError(mysqlError(1045, "access denied"));
      expect(result).toBeInstanceOf(ConnectionError);
    });

    it("should map SERVER_GONE (2006) to ConnectionError", () => {
      const result = mapMySQLError(mysqlError(2006, "server gone"));
      expect(result).toBeInstanceOf(ConnectionError);
    });

    it("should map SERVER_SHUTDOWN (1053) to ConnectionError", () => {
      const result = mapMySQLError(mysqlError(1053, "server shutdown"));
      expect(result).toBeInstanceOf(ConnectionError);
    });
  });

  describe("timeout errors", () => {
    it("should map LOCK_WAIT_TIMEOUT (1205) to QueryTimeoutError", () => {
      const result = mapMySQLError(mysqlError(1205, "lock wait timeout"));
      expect(result).toBeInstanceOf(QueryTimeoutError);
      expect(result.message).toBe("lock wait timeout");
    });

    it("should map QUERY_INTERRUPTED (1317) to QueryTimeoutError", () => {
      const result = mapMySQLError(mysqlError(1317, "query interrupted"));
      expect(result).toBeInstanceOf(QueryTimeoutError);
    });
  });

  describe("deadlock", () => {
    it("should map DEADLOCK (1213) to DatabaseError with DEADLOCK code", () => {
      const result = mapMySQLError(mysqlError(1213, "deadlock found"));
      expect(result).toBeInstanceOf(DatabaseError);
      expect(result.message).toBe("Deadlock detected");
      expect(result.code).toBe("DEADLOCK");
    });
  });

  describe("generic errors", () => {
    it("should map unknown errno to DatabaseError with stringified errno", () => {
      const result = mapMySQLError(mysqlError(9999, "unknown mysql error"));
      expect(result).toBeInstanceOf(DatabaseError);
      expect(result.message).toBe("unknown mysql error");
      expect(result.code).toBe("9999");
    });

    it("should prefer sqlMessage over message", () => {
      const result = mapMySQLError({
        errno: 9999,
        sqlMessage: "sql message",
        message: "generic message",
      });
      expect(result.message).toBe("sql message");
    });

    it("should fall back to message when sqlMessage is missing", () => {
      const result = mapMySQLError({
        errno: 9999,
        message: "generic message only",
      });
      expect(result.message).toBe("generic message only");
    });

    it("should use 'Unknown database error' when both messages are missing", () => {
      const result = mapMySQLError({ errno: 9999 });
      expect(result.message).toBe("Unknown database error");
    });

    it("should handle error without errno (undefined goes to default)", () => {
      const result = mapMySQLError({ message: "no errno" });
      expect(result).toBeInstanceOf(DatabaseError);
      expect(result.message).toBe("no errno");
    });
  });

  describe("withErrorMapping integration", () => {
    it("should wrap errors through withErrorMapping", async () => {
      const { withErrorMapping } = await import("../errors.js");

      await expect(
        withErrorMapping(async () => {
          throw mysqlError(1062, "dup key violation");
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
