/**
 * MySqlInboxDialect Unit Tests
 *
 * Tests SQL generation for MySQL inbox-specific operations:
 * - buildInboxInsert() - INSERT IGNORE for dedup
 * - buildInboxBulkInsert() - Bulk INSERT IGNORE
 * - buildMarkFailed() - UPDATE status to failed
 */

import { describe, it, expect } from "vitest";
import { MySqlInboxDialect } from "../mysql-inbox-dialect.js";

describe("MySqlInboxDialect", () => {
  const dialect = new MySqlInboxDialect();

  describe("properties", () => {
    it("should have correct name", () => {
      expect(dialect.name).toBe("mysql");
    });

    it("should not support RETURNING", () => {
      expect(dialect.supportsReturning).toBe(false);
    });
  });

  describe("buildInboxInsert()", () => {
    it("should throw when generatedId is missing", () => {
      expect(() =>
        dialect.buildInboxInsert({
          columns: ["id", "idempotency_key"],
          values: ["id-1", "key-1"],
        }),
      ).toThrow("MySQL requires generatedId");
    });

    it("should generate INSERT IGNORE", () => {
      const result = dialect.buildInboxInsert({
        columns: ["id", "idempotency_key", "status"],
        values: ["id-1", "key-1", "processed"],
        generatedId: "id-1",
      });

      expect(result.sql).toContain("INSERT IGNORE INTO inbox_events");
      expect(result.sql).toContain("VALUES (?, ?, ?)");
      expect(result.params).toEqual(["id-1", "key-1", "processed"]);
    });
  });

  describe("buildInboxBulkInsert()", () => {
    it("should throw when generatedIds is missing", () => {
      expect(() =>
        dialect.buildInboxBulkInsert({
          columns: ["id", "key"],
          rows: [["id-1", "key-1"]],
        }),
      ).toThrow("MySQL requires generatedIds");
    });

    it("should generate bulk INSERT IGNORE", () => {
      const result = dialect.buildInboxBulkInsert({
        columns: ["id", "status"],
        rows: [
          ["id-1", "processed"],
          ["id-2", "processed"],
        ],
        generatedIds: ["id-1", "id-2"],
      });

      expect(result.sql).toContain("INSERT IGNORE INTO inbox_events");
      expect(result.sql).toContain("VALUES (?, ?), (?, ?)");
      expect(result.params).toEqual(["id-1", "processed", "id-2", "processed"]);
    });
  });

  describe("buildFindByIdempotencyKeys()", () => {
    it("should generate SELECT with ? placeholders", () => {
      const result = dialect.buildFindByIdempotencyKeys({
        keys: ["key-1", "key-2", "key-3"],
      });

      expect(result.sql).toBe(
        "SELECT id, idempotency_key FROM inbox_events WHERE idempotency_key IN (?, ?, ?)",
      );
      expect(result.params).toEqual(["key-1", "key-2", "key-3"]);
    });

    it("should handle a single key", () => {
      const result = dialect.buildFindByIdempotencyKeys({
        keys: ["only-key"],
      });

      expect(result.sql).toContain("IN (?)");
      expect(result.params).toEqual(["only-key"]);
    });

    it("should throw for empty keys array", () => {
      expect(() => dialect.buildFindByIdempotencyKeys({ keys: [] })).toThrow(
        "requires at least one key",
      );
    });
  });

  describe("buildCleanupProcessedEvents()", () => {
    it("should generate DELETE with correct params", () => {
      const result = dialect.buildCleanupProcessedEvents({
        retentionDays: 30,
      });

      expect(result.sql).toContain("DELETE FROM inbox_events");
      expect(result.sql).toContain("status = ?");
      expect(result.sql).toContain("processed_at");
      expect(result.sql).toContain("INTERVAL ? DAY");
      expect(result.params).toEqual(["processed", 30]);
    });
  });

  describe("buildMarkFailed()", () => {
    it("should generate UPDATE with correct params", () => {
      const result = dialect.buildMarkFailed({
        eventId: "evt-123",
        error: "Processing failed",
      });

      expect(result.sql).toContain("UPDATE inbox_events");
      expect(result.sql).toContain("SET status = ?, error = ?");
      expect(result.sql).toContain("WHERE id = ?");
      expect(result.params).toEqual(["failed", "Processing failed", "evt-123"]);
    });

    it("should use ? placeholders", () => {
      const result = dialect.buildMarkFailed({
        eventId: "id",
        error: "err",
      });

      expect(result.sql).not.toContain("$");
      // 3 placeholders for status, error, id
      expect(result.params).toHaveLength(3);
    });
  });
});
