/**
 * Batch Grouping Logic Unit Tests
 *
 * Tests the pure batch grouping function in isolation.
 * No mocking, no I/O, just pure function behavior verification.
 */

import { describe, it, expect } from "vitest";
import { groupBatchResults } from "../../src/batch.js";
import type { PublishResult } from "@outboxy/publisher-core";

describe("groupBatchResults", () => {
  describe("all succeeded", () => {
    it("should group all events as succeeded when all succeed", () => {
      const results = new Map<string, PublishResult>([
        ["event-1", { success: true, retryable: false }],
        ["event-2", { success: true, retryable: false }],
        ["event-3", { success: true, retryable: false }],
      ]);
      const retryCount = new Map([
        ["event-1", 0],
        ["event-2", 0],
        ["event-3", 0],
      ]);

      const grouped = groupBatchResults(results, retryCount, 5);

      expect(grouped.succeeded).toEqual(["event-1", "event-2", "event-3"]);
      expect(grouped.retried).toEqual([]);
      expect(grouped.dlq).toEqual([]);
    });

    it("should handle large succeeded batch (100 events)", () => {
      const results = new Map<string, PublishResult>();
      const retryCount = new Map<string, number>();

      for (let i = 1; i <= 100; i++) {
        const eventId = `event-${i}`;
        results.set(eventId, { success: true, retryable: false });
        retryCount.set(eventId, 0);
      }

      const grouped = groupBatchResults(results, retryCount, 5);

      expect(grouped.succeeded).toHaveLength(100);
      expect(grouped.retried).toHaveLength(0);
      expect(grouped.dlq).toHaveLength(0);
    });
  });

  describe("all failed non-retryable", () => {
    it("should group all events as dlq when all fail non-retryably", () => {
      const results = new Map<string, PublishResult>([
        [
          "event-1",
          { success: false, error: new Error("HTTP 400"), retryable: false },
        ],
        [
          "event-2",
          { success: false, error: new Error("HTTP 401"), retryable: false },
        ],
        [
          "event-3",
          { success: false, error: new Error("HTTP 403"), retryable: false },
        ],
      ]);
      const retryCount = new Map([
        ["event-1", 0],
        ["event-2", 0],
        ["event-3", 0],
      ]);

      const grouped = groupBatchResults(results, retryCount, 5);

      expect(grouped.succeeded).toEqual([]);
      expect(grouped.retried).toEqual([]);
      expect(grouped.dlq).toEqual(["event-1", "event-2", "event-3"]);
    });

    it("should group non-retryable failures as dlq regardless of retry count", () => {
      const results = new Map<string, PublishResult>([
        [
          "event-1",
          {
            success: false,
            error: new Error("Validation error"),
            retryable: false,
          },
        ],
        [
          "event-2",
          { success: false, error: new Error("Auth failed"), retryable: false },
        ],
      ]);
      const retryCount = new Map([
        ["event-1", 0],
        ["event-2", 3],
      ]);

      const grouped = groupBatchResults(results, retryCount, 5);

      expect(grouped.dlq).toEqual(["event-1", "event-2"]);
    });
  });

  describe("mixed success and failure", () => {
    it("should properly group mixed success and retryable failures", () => {
      const results = new Map<string, PublishResult>([
        ["event-1", { success: true, retryable: false }],
        [
          "event-2",
          { success: false, error: new Error("HTTP 500"), retryable: true },
        ],
        ["event-3", { success: true, retryable: false }],
        [
          "event-4",
          { success: false, error: new Error("Timeout"), retryable: true },
        ],
      ]);
      const retryCount = new Map([
        ["event-1", 0],
        ["event-2", 0],
        ["event-3", 0],
        ["event-4", 1],
      ]);

      const grouped = groupBatchResults(results, retryCount, 5);

      expect(grouped.succeeded).toEqual(["event-1", "event-3"]);
      expect(grouped.retried).toEqual(["event-2", "event-4"]);
      expect(grouped.dlq).toEqual([]);
    });

    it("should properly group all three outcomes", () => {
      const results = new Map<string, PublishResult>([
        ["event-1", { success: true, retryable: false }],
        [
          "event-2",
          { success: false, error: new Error("HTTP 500"), retryable: true },
        ],
        [
          "event-3",
          { success: false, error: new Error("HTTP 400"), retryable: false },
        ],
      ]);
      const retryCount = new Map([
        ["event-1", 0],
        ["event-2", 0],
        ["event-3", 0],
      ]);

      const grouped = groupBatchResults(results, retryCount, 5);

      expect(grouped.succeeded).toEqual(["event-1"]);
      expect(grouped.retried).toEqual(["event-2"]);
      expect(grouped.dlq).toEqual(["event-3"]);
    });
  });

  describe("retryable with max retries exceeded", () => {
    it("should group retryable failures as dlq when max retries exceeded", () => {
      const results = new Map<string, PublishResult>([
        [
          "event-1",
          { success: false, error: new Error("HTTP 500"), retryable: true },
        ],
        [
          "event-2",
          { success: false, error: new Error("Timeout"), retryable: true },
        ],
        [
          "event-3",
          { success: false, error: new Error("HTTP 503"), retryable: true },
        ],
      ]);
      const retryCount = new Map([
        ["event-1", 5],
        ["event-2", 10],
        ["event-3", 5],
      ]);

      const grouped = groupBatchResults(results, retryCount, 5);

      expect(grouped.succeeded).toEqual([]);
      expect(grouped.retried).toEqual([]);
      expect(grouped.dlq).toEqual(["event-1", "event-2", "event-3"]);
    });

    it("should group mixed retryable failures based on retry count", () => {
      const results = new Map<string, PublishResult>([
        [
          "event-1",
          { success: false, error: new Error("HTTP 500"), retryable: true },
        ],
        [
          "event-2",
          { success: false, error: new Error("HTTP 500"), retryable: true },
        ],
        [
          "event-3",
          { success: false, error: new Error("HTTP 500"), retryable: true },
        ],
      ]);
      const retryCount = new Map([
        ["event-1", 2],
        ["event-2", 5],
        ["event-3", 4],
      ]);

      const grouped = groupBatchResults(results, retryCount, 5);

      expect(grouped.succeeded).toEqual([]);
      expect(grouped.retried).toEqual(["event-1", "event-3"]);
      expect(grouped.dlq).toEqual(["event-2"]);
    });
  });

  describe("empty batch", () => {
    it("should return empty arrays for empty batch", () => {
      const results = new Map<string, PublishResult>();
      const retryCount = new Map<string, number>();

      const grouped = groupBatchResults(results, retryCount, 5);

      expect(grouped.succeeded).toEqual([]);
      expect(grouped.retried).toEqual([]);
      expect(grouped.dlq).toEqual([]);
    });
  });

  describe("large batch scenarios", () => {
    it("should handle large batch with mixed results (100+ events)", () => {
      const results = new Map<string, PublishResult>();
      const retryCount = new Map<string, number>();

      for (let i = 1; i <= 150; i++) {
        const eventId = `event-${i}`;
        if (i % 3 === 0) {
          results.set(eventId, { success: true, retryable: false });
        } else if (i % 3 === 1) {
          results.set(eventId, {
            success: false,
            error: new Error("HTTP 500"),
            retryable: true,
          });
        } else {
          results.set(eventId, {
            success: false,
            error: new Error("HTTP 400"),
            retryable: false,
          });
        }
        retryCount.set(eventId, 0);
      }

      const grouped = groupBatchResults(results, retryCount, 5);

      expect(grouped.succeeded.length).toBe(50);
      expect(grouped.retried.length).toBe(50);
      expect(grouped.dlq.length).toBe(50);
    });

    it("should handle large batch with all retries", () => {
      const results = new Map<string, PublishResult>();
      const retryCount = new Map<string, number>();

      for (let i = 1; i <= 200; i++) {
        const eventId = `event-${i}`;
        results.set(eventId, {
          success: false,
          error: new Error("HTTP 500"),
          retryable: true,
        });
        retryCount.set(eventId, 0);
      }

      const grouped = groupBatchResults(results, retryCount, 5);

      expect(grouped.retried).toHaveLength(200);
      expect(grouped.succeeded).toHaveLength(0);
      expect(grouped.dlq).toHaveLength(0);
    });
  });

  describe("edge cases", () => {
    it("should handle missing retry count (defaults to 0)", () => {
      const results = new Map<string, PublishResult>([
        [
          "event-1",
          { success: false, error: new Error("HTTP 500"), retryable: true },
        ],
        [
          "event-2",
          { success: false, error: new Error("HTTP 500"), retryable: true },
        ],
      ]);
      const retryCount = new Map<string, number>();

      const grouped = groupBatchResults(results, retryCount, 5);

      expect(grouped.retried).toEqual(["event-1", "event-2"]);
    });

    it("should handle maxRetries of 0", () => {
      const results = new Map<string, PublishResult>([
        [
          "event-1",
          { success: false, error: new Error("HTTP 500"), retryable: true },
        ],
        ["event-2", { success: true, retryable: false }],
      ]);
      const retryCount = new Map([
        ["event-1", 0],
        ["event-2", 0],
      ]);

      const grouped = groupBatchResults(results, retryCount, 0);

      expect(grouped.succeeded).toEqual(["event-2"]);
      expect(grouped.dlq).toEqual(["event-1"]);
    });

    it("should handle event at exact retry limit", () => {
      const results = new Map<string, PublishResult>([
        [
          "event-1",
          { success: false, error: new Error("HTTP 500"), retryable: true },
        ],
        [
          "event-2",
          { success: false, error: new Error("HTTP 500"), retryable: true },
        ],
      ]);
      const retryCount = new Map([
        ["event-1", 2],
        ["event-2", 3],
      ]);

      const grouped = groupBatchResults(results, retryCount, 3);

      expect(grouped.retried).toEqual(["event-1"]);
      expect(grouped.dlq).toEqual(["event-2"]);
    });
  });

  describe("real-world scenarios", () => {
    it("should handle realistic batch with mixed HTTP status codes", () => {
      const results = new Map<string, PublishResult>([
        ["event-1", { success: true, retryable: false }],
        [
          "event-2",
          { success: false, error: new Error("HTTP 400"), retryable: false },
        ],
        [
          "event-3",
          { success: false, error: new Error("HTTP 500"), retryable: true },
        ],
        [
          "event-4",
          { success: false, error: new Error("HTTP 408"), retryable: true },
        ],
        [
          "event-5",
          { success: false, error: new Error("HTTP 401"), retryable: false },
        ],
        [
          "event-6",
          { success: false, error: new Error("HTTP 503"), retryable: true },
        ],
        ["event-7", { success: true, retryable: false }],
        [
          "event-8",
          { success: false, error: new Error("HTTP 429"), retryable: true },
        ],
      ]);
      const retryCount = new Map([
        ["event-1", 0],
        ["event-2", 0],
        ["event-3", 1],
        ["event-4", 0],
        ["event-5", 2],
        ["event-6", 4],
        ["event-7", 0],
        ["event-8", 3],
      ]);

      const grouped = groupBatchResults(results, retryCount, 5);

      expect(grouped.succeeded).toEqual(["event-1", "event-7"]);
      expect(grouped.retried).toEqual([
        "event-3",
        "event-4",
        "event-6",
        "event-8",
      ]);
      expect(grouped.dlq).toEqual(["event-2", "event-5"]);
    });

    it("should handle batch with events at different retry stages", () => {
      const results = new Map<string, PublishResult>();
      const retryCount = new Map<string, number>();

      for (let i = 1; i <= 10; i++) {
        const eventId = `event-${i}`;
        results.set(eventId, {
          success: false,
          error: new Error("HTTP 500"),
          retryable: true,
        });
        retryCount.set(eventId, i);
      }

      const grouped = groupBatchResults(results, retryCount, 5);

      expect(grouped.retried).toEqual([
        "event-1",
        "event-2",
        "event-3",
        "event-4",
      ]);
      expect(grouped.dlq).toEqual([
        "event-5",
        "event-6",
        "event-7",
        "event-8",
        "event-9",
        "event-10",
      ]);
    });
  });
});
