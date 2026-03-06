/**
 * PostgreSqlDialect Unit Tests
 *
 * Tests SQL generation for PostgreSQL-specific operations:
 * - placeholder() - PostgreSQL uses $1, $2, etc.
 * - buildInsert() - INSERT with ON CONFLICT for idempotency and RETURNING
 * - buildBulkInsert() - Bulk INSERT with RETURNING
 */

import { describe, it, expect } from "vitest";
import { PostgreSqlDialect } from "../postgres-dialect.js";

describe("PostgreSqlDialect", () => {
  const dialect = new PostgreSqlDialect();

  describe("properties", () => {
    it("should have correct name", () => {
      expect(dialect.name).toBe("postgresql");
    });

    it("should have correct maxParameters", () => {
      expect(dialect.maxParameters).toBe(65535);
    });

    it("should support RETURNING", () => {
      expect(dialect.supportsReturning).toBe(true);
    });
  });

  describe("placeholder()", () => {
    it("should return $N format placeholders", () => {
      expect(dialect.placeholder(1)).toBe("$1");
      expect(dialect.placeholder(2)).toBe("$2");
      expect(dialect.placeholder(100)).toBe("$100");
    });
  });

  describe("buildInsert()", () => {
    it("should generate valid INSERT with ON CONFLICT and RETURNING", () => {
      const result = dialect.buildInsert({
        columns: ["id", "aggregate_type", "status"],
        values: ["test-id", "Order", "pending"],
      });

      expect(result.sql).toContain("INSERT INTO outbox_events");
      expect(result.sql).toContain("(id, aggregate_type, status)");
      expect(result.sql).toContain("VALUES ($1, $2, $3)");
      expect(result.sql).toContain("ON CONFLICT (idempotency_key)");
      expect(result.sql).toContain("RETURNING id");
      expect(result.params).toEqual(["test-id", "Order", "pending"]);
    });

    it("should use sequential $N placeholders", () => {
      const result = dialect.buildInsert({
        columns: ["a", "b", "c", "d", "e"],
        values: [1, 2, 3, 4, 5],
      });

      expect(result.sql).toContain("VALUES ($1, $2, $3, $4, $5)");
      expect(result.params).toHaveLength(5);
    });

    it("should include partial unique index condition for idempotency", () => {
      const result = dialect.buildInsert({
        columns: ["id"],
        values: ["test-id"],
      });

      // PostgreSQL uses partial unique index for idempotency
      expect(result.sql).toContain("WHERE idempotency_key IS NOT NULL");
      expect(result.sql).toContain("AND status != 'succeeded'");
    });

    it("should use DO UPDATE SET for conflict resolution", () => {
      const result = dialect.buildInsert({
        columns: ["id"],
        values: ["test-id"],
      });

      // The DO UPDATE is a no-op that just returns the existing row
      expect(result.sql).toContain("DO UPDATE SET idempotency_key");
    });

    it("should work without generatedId (uses RETURNING)", () => {
      // PostgreSQL doesn't need pre-generated IDs because RETURNING clause handles it
      const result = dialect.buildInsert({
        columns: ["aggregate_type", "aggregate_id"],
        values: ["Order", "order-123"],
      });

      expect(result.sql).toContain("RETURNING id");
      expect(result.params).toEqual(["Order", "order-123"]);
    });
  });

  describe("buildBulkInsert()", () => {
    it("should generate valid bulk INSERT with RETURNING", () => {
      const result = dialect.buildBulkInsert({
        columns: ["id", "aggregate_type"],
        rows: [
          ["id1", "Order"],
          ["id2", "Payment"],
        ],
      });

      expect(result.sql).toContain("INSERT INTO outbox_events");
      expect(result.sql).toContain("(id, aggregate_type)");
      expect(result.sql).toContain("VALUES ($1, $2), ($3, $4)");
      expect(result.sql).toContain("RETURNING id");
      expect(result.params).toEqual(["id1", "Order", "id2", "Payment"]);
    });

    it("should handle single row bulk insert", () => {
      const result = dialect.buildBulkInsert({
        columns: ["id", "name"],
        rows: [["single-id", "single-name"]],
      });

      expect(result.sql).toContain("VALUES ($1, $2)");
      expect(result.sql).toContain("RETURNING id");
      expect(result.params).toEqual(["single-id", "single-name"]);
    });

    it("should use correct sequential placeholders across rows", () => {
      const result = dialect.buildBulkInsert({
        columns: ["a", "b", "c"],
        rows: [
          [1, 2, 3],
          [4, 5, 6],
          [7, 8, 9],
        ],
      });

      // Row 1: $1, $2, $3; Row 2: $4, $5, $6; Row 3: $7, $8, $9
      expect(result.sql).toContain("($1, $2, $3), ($4, $5, $6), ($7, $8, $9)");
      expect(result.params).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });

    it("should not require generatedIds (uses RETURNING)", () => {
      // PostgreSQL bulk insert doesn't need pre-generated IDs
      const result = dialect.buildBulkInsert({
        columns: ["aggregate_type"],
        rows: [["Order"], ["Payment"]],
      });

      expect(result.sql).toContain("RETURNING id");
    });

    it("should not include ON CONFLICT for bulk inserts", () => {
      const result = dialect.buildBulkInsert({
        columns: ["id"],
        rows: [["id1"], ["id2"]],
      });

      // Bulk insert does NOT support idempotency handling
      expect(result.sql).not.toContain("ON CONFLICT");
    });
  });
});
