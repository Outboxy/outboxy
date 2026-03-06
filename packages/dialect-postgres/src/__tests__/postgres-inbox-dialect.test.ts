/**
 * PostgreSqlInboxDialect Unit Tests
 *
 * Tests SQL generation for PostgreSQL inbox-specific operations:
 * - buildInboxInsert() - INSERT with ON CONFLICT DO NOTHING for dedup
 * - buildInboxBulkInsert() - Bulk INSERT with ON CONFLICT DO NOTHING
 * - buildMarkFailed() - UPDATE status to failed
 */

import { describe, it, expect } from "vitest";
import { PostgreSqlInboxDialect } from "../postgres-inbox-dialect.js";

describe("PostgreSqlInboxDialect", () => {
  const dialect = new PostgreSqlInboxDialect();

  describe("properties", () => {
    it("should have correct name", () => {
      expect(dialect.name).toBe("postgresql");
    });

    it("should support RETURNING", () => {
      expect(dialect.supportsReturning).toBe(true);
    });
  });

  describe("buildInboxInsert()", () => {
    it("should generate INSERT with ON CONFLICT DO NOTHING and RETURNING", () => {
      const result = dialect.buildInboxInsert({
        columns: ["idempotency_key", "aggregate_type", "status"],
        values: ["key-1", "Order", "processed"],
      });

      expect(result.sql).toContain("INSERT INTO inbox_events");
      expect(result.sql).toContain("ON CONFLICT (idempotency_key) DO NOTHING");
      expect(result.sql).toContain("RETURNING id");
      expect(result.params).toEqual(["key-1", "Order", "processed"]);
    });
  });

  describe("buildInboxBulkInsert()", () => {
    it("should generate bulk INSERT with ON CONFLICT DO NOTHING", () => {
      const result = dialect.buildInboxBulkInsert({
        columns: ["idempotency_key", "status"],
        rows: [
          ["key-1", "processed"],
          ["key-2", "processed"],
        ],
      });

      expect(result.sql).toContain("INSERT INTO inbox_events");
      expect(result.sql).toContain("ON CONFLICT (idempotency_key) DO NOTHING");
      expect(result.sql).toContain("RETURNING id");
      expect(result.params).toEqual([
        "key-1",
        "processed",
        "key-2",
        "processed",
      ]);
    });
  });

  describe("buildFindByIdempotencyKeys()", () => {
    it("should generate SELECT with $N placeholders", () => {
      const result = dialect.buildFindByIdempotencyKeys({
        keys: ["key-1", "key-2", "key-3"],
      });

      expect(result.sql).toBe(
        "SELECT id, idempotency_key FROM inbox_events WHERE idempotency_key IN ($1, $2, $3)",
      );
      expect(result.params).toEqual(["key-1", "key-2", "key-3"]);
    });

    it("should handle a single key", () => {
      const result = dialect.buildFindByIdempotencyKeys({
        keys: ["only-key"],
      });

      expect(result.sql).toContain("IN ($1)");
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
      expect(result.sql).toContain("status = $1");
      expect(result.sql).toContain("processed_at");
      expect(result.sql).toContain("interval '1 day'");
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
      expect(result.sql).toContain("SET status = $1, error = $2");
      expect(result.sql).toContain("WHERE id = $3");
      expect(result.params).toEqual(["failed", "Processing failed", "evt-123"]);
    });

    it("should use parameterized placeholders", () => {
      const result = dialect.buildMarkFailed({
        eventId: "id",
        error: "err",
      });

      expect(result.sql).toContain("$1");
      expect(result.sql).toContain("$2");
      expect(result.sql).toContain("$3");
      expect(result.sql).not.toContain("?");
    });
  });
});
