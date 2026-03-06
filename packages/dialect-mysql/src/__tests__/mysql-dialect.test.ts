/**
 * MySqlDialect Unit Tests
 *
 * Tests SQL generation for MySQL-specific operations:
 * - placeholder() - MySQL uses ? for all parameters
 * - buildInsert() - INSERT with ON DUPLICATE KEY UPDATE for idempotency
 * - buildBulkInsert() - Bulk INSERT without idempotency handling
 */

import { describe, it, expect } from "vitest";
import { MySqlDialect } from "../mysql-dialect.js";

describe("MySqlDialect", () => {
  const dialect = new MySqlDialect();

  describe("properties", () => {
    it("should have correct name", () => {
      expect(dialect.name).toBe("mysql");
    });

    it("should have correct maxParameters", () => {
      expect(dialect.maxParameters).toBe(65535);
    });

    it("should not support RETURNING", () => {
      expect(dialect.supportsReturning).toBe(false);
    });
  });

  describe("placeholder()", () => {
    it("should always return ? regardless of index", () => {
      expect(dialect.placeholder(1)).toBe("?");
      expect(dialect.placeholder(2)).toBe("?");
      expect(dialect.placeholder(100)).toBe("?");
    });
  });

  describe("buildInsert()", () => {
    it("should throw error when generatedId is not provided", () => {
      expect(() =>
        dialect.buildInsert({
          columns: ["id", "name"],
          values: ["test-id", "test-name"],
        }),
      ).toThrow("MySQL requires generatedId for INSERT (no RETURNING support)");
    });

    it("should generate valid INSERT with ON DUPLICATE KEY UPDATE", () => {
      const result = dialect.buildInsert({
        columns: ["id", "aggregate_type", "status"],
        values: ["test-id", "Order", "pending"],
        generatedId: "test-id",
      });

      expect(result.sql).toContain("INSERT INTO outbox_events");
      expect(result.sql).toContain("(id, aggregate_type, status)");
      expect(result.sql).toContain("VALUES (?, ?, ?)");
      expect(result.sql).toContain("ON DUPLICATE KEY UPDATE");
      expect(result.sql).toContain("WHEN status != 'succeeded'");
      expect(result.params).toEqual(["test-id", "Order", "pending"]);
    });

    it("should use ? placeholders for all values", () => {
      const result = dialect.buildInsert({
        columns: ["a", "b", "c", "d", "e"],
        values: [1, 2, 3, 4, 5],
        generatedId: "id",
      });

      expect(result.sql).toContain("VALUES (?, ?, ?, ?, ?)");
      expect(result.params).toHaveLength(5);
    });

    it("should include conditional update logic for idempotency", () => {
      const result = dialect.buildInsert({
        columns: ["id"],
        values: ["test-id"],
        generatedId: "test-id",
      });

      // The CASE statement ensures we only update non-succeeded events
      expect(result.sql).toContain("updated_at = CASE");
      expect(result.sql).toContain("WHEN status != 'succeeded'");
      expect(result.sql).toContain("THEN NOW()");
      expect(result.sql).toContain("ELSE updated_at");
    });
  });

  describe("buildBulkInsert()", () => {
    it("should throw error when generatedIds is not provided", () => {
      expect(() =>
        dialect.buildBulkInsert({
          columns: ["id", "name"],
          rows: [
            ["id1", "name1"],
            ["id2", "name2"],
          ],
        }),
      ).toThrow("MySQL requires generatedIds for bulk INSERT");
    });

    it("should throw error when generatedIds count mismatches rows", () => {
      expect(() =>
        dialect.buildBulkInsert({
          columns: ["id", "name"],
          rows: [
            ["id1", "name1"],
            ["id2", "name2"],
          ],
          generatedIds: ["only-one"],
        }),
      ).toThrow("MySQL requires generatedIds for bulk INSERT");
    });

    it("should generate valid bulk INSERT", () => {
      const result = dialect.buildBulkInsert({
        columns: ["id", "aggregate_type"],
        rows: [
          ["id1", "Order"],
          ["id2", "Payment"],
        ],
        generatedIds: ["id1", "id2"],
      });

      expect(result.sql).toContain("INSERT INTO outbox_events");
      expect(result.sql).toContain("(id, aggregate_type)");
      expect(result.sql).toContain("VALUES (?, ?), (?, ?)");
      expect(result.params).toEqual(["id1", "Order", "id2", "Payment"]);
    });

    it("should handle single row bulk insert", () => {
      const result = dialect.buildBulkInsert({
        columns: ["id", "name"],
        rows: [["single-id", "single-name"]],
        generatedIds: ["single-id"],
      });

      expect(result.sql).toContain("VALUES (?, ?)");
      expect(result.params).toEqual(["single-id", "single-name"]);
    });

    it("should not include ON DUPLICATE KEY UPDATE", () => {
      const result = dialect.buildBulkInsert({
        columns: ["id"],
        rows: [["id1"], ["id2"]],
        generatedIds: ["id1", "id2"],
      });

      // Bulk insert does NOT support idempotency handling
      expect(result.sql).not.toContain("ON DUPLICATE KEY UPDATE");
    });

    it("should flatten all row params in order", () => {
      const result = dialect.buildBulkInsert({
        columns: ["a", "b", "c"],
        rows: [
          [1, 2, 3],
          [4, 5, 6],
          [7, 8, 9],
        ],
        generatedIds: ["id1", "id2", "id3"],
      });

      expect(result.params).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });
  });
});
