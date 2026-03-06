/**
 * Retry Decision Logic Unit Tests
 *
 * Tests the pure retry decision function in isolation.
 * No mocking, no I/O, just pure function behavior verification.
 */

import { describe, it, expect } from "vitest";
import { decideRetry } from "../../src/retry.js";
import type { PublishResult } from "@outboxy/publisher-core";

describe("decideRetry", () => {
  describe("success scenarios", () => {
    it("should return 'succeeded' when result is successful", () => {
      const result: PublishResult = {
        success: true,
        retryable: false,
      };

      const decision = decideRetry(result, 0, 5);

      expect(decision).toBe("succeeded");
    });

    it("should return 'succeeded' regardless of retry count when successful", () => {
      const result: PublishResult = {
        success: true,
        retryable: false,
      };

      expect(decideRetry(result, 0, 5)).toBe("succeeded");
      expect(decideRetry(result, 3, 5)).toBe("succeeded");
      expect(decideRetry(result, 5, 5)).toBe("succeeded");
      expect(decideRetry(result, 10, 5)).toBe("succeeded");
    });
  });

  describe("non-retryable failures", () => {
    it("should return 'dlq' for non-retryable failure (4xx)", () => {
      const result: PublishResult = {
        success: false,
        error: new Error("HTTP 400 Bad Request"),
        retryable: false,
      };

      const decision = decideRetry(result, 0, 5);

      expect(decision).toBe("dlq");
    });

    it("should return 'dlq' for non-retryable failure regardless of retry count", () => {
      const result: PublishResult = {
        success: false,
        error: new Error("HTTP 401 Unauthorized"),
        retryable: false,
      };

      expect(decideRetry(result, 0, 5)).toBe("dlq");
      expect(decideRetry(result, 1, 5)).toBe("dlq");
      expect(decideRetry(result, 2, 5)).toBe("dlq");
    });

    it("should return 'dlq' for auth failures", () => {
      const result: PublishResult = {
        success: false,
        error: new Error("Authentication failed"),
        retryable: false,
      };

      expect(decideRetry(result, 0, 5)).toBe("dlq");
    });

    it("should return 'dlq' for validation errors", () => {
      const result: PublishResult = {
        success: false,
        error: new Error("Schema validation failed"),
        retryable: false,
      };

      expect(decideRetry(result, 0, 5)).toBe("dlq");
    });
  });

  describe("retryable failures with retries remaining", () => {
    it("should return 'retry' for retryable failure with retries remaining", () => {
      const result: PublishResult = {
        success: false,
        error: new Error("HTTP 500 Internal Server Error"),
        retryable: true,
      };

      expect(decideRetry(result, 0, 5)).toBe("retry");
      expect(decideRetry(result, 1, 5)).toBe("retry");
      expect(decideRetry(result, 2, 5)).toBe("retry");
      expect(decideRetry(result, 3, 5)).toBe("retry");
      expect(decideRetry(result, 4, 5)).toBe("retry");
    });

    it("should return 'retry' for network timeout", () => {
      const result: PublishResult = {
        success: false,
        error: new Error("Connection timeout"),
        retryable: true,
      };

      expect(decideRetry(result, 0, 5)).toBe("retry");
    });

    it("should return 'retry' for 503 Service Unavailable", () => {
      const result: PublishResult = {
        success: false,
        error: new Error("HTTP 503 Service Unavailable"),
        retryable: true,
      };

      expect(decideRetry(result, 1, 5)).toBe("retry");
    });

    it("should return 'retry' for 408 Request Timeout", () => {
      const result: PublishResult = {
        success: false,
        error: new Error("HTTP 408 Request Timeout"),
        retryable: true,
      };

      expect(decideRetry(result, 2, 5)).toBe("retry");
    });

    it("should return 'retry' for 429 Too Many Requests", () => {
      const result: PublishResult = {
        success: false,
        error: new Error("HTTP 429 Too Many Requests"),
        retryable: true,
      };

      expect(decideRetry(result, 0, 5)).toBe("retry");
    });

    it("should return 'retry' for connection refused", () => {
      const result: PublishResult = {
        success: false,
        error: new Error("ECONNREFUSED"),
        retryable: true,
      };

      expect(decideRetry(result, 1, 10)).toBe("retry");
    });
  });

  describe("max retries exceeded", () => {
    it("should return 'dlq' when retryable failure exceeds max retries", () => {
      const result: PublishResult = {
        success: false,
        error: new Error("HTTP 500 Internal Server Error"),
        retryable: true,
      };

      expect(decideRetry(result, 5, 5)).toBe("dlq");
      expect(decideRetry(result, 6, 5)).toBe("dlq");
      expect(decideRetry(result, 10, 5)).toBe("dlq");
    });

    it("should return 'dlq' at exactly max retries", () => {
      const result: PublishResult = {
        success: false,
        error: new Error("Connection timeout"),
        retryable: true,
      };

      expect(decideRetry(result, 3, 3)).toBe("dlq");
    });
  });

  describe("edge cases", () => {
    it("should return 'retry' when retryCount is just below maxRetries", () => {
      const result: PublishResult = {
        success: false,
        error: new Error("HTTP 502 Bad Gateway"),
        retryable: true,
      };

      expect(decideRetry(result, 4, 5)).toBe("retry");
      expect(decideRetry(result, 9, 10)).toBe("retry");
    });

    it("should return 'dlq' when maxRetries is 0", () => {
      const result: PublishResult = {
        success: false,
        error: new Error("HTTP 500"),
        retryable: true,
      };

      expect(decideRetry(result, 0, 0)).toBe("dlq");
    });

    it("should return 'retry' on first failure with high maxRetries", () => {
      const result: PublishResult = {
        success: false,
        error: new Error("Network error"),
        retryable: true,
      };

      expect(decideRetry(result, 0, 100)).toBe("retry");
    });

    it("should handle error without message", () => {
      const result: PublishResult = {
        success: false,
        error: new Error(),
        retryable: true,
      };

      expect(decideRetry(result, 0, 5)).toBe("retry");
    });

    it("should handle undefined error", () => {
      const result: PublishResult = {
        success: false,
        retryable: true,
      };

      expect(decideRetry(result, 0, 5)).toBe("retry");
    });
  });

  describe("HTTP status code scenarios", () => {
    const testStatusCodes = [
      { status: 400, retryable: false, expected: "dlq" },
      { status: 401, retryable: false, expected: "dlq" },
      { status: 403, retryable: false, expected: "dlq" },
      { status: 404, retryable: false, expected: "dlq" },
      { status: 408, retryable: true, expected: "retry" },
      { status: 409, retryable: false, expected: "dlq" },
      { status: 422, retryable: false, expected: "dlq" },
      { status: 429, retryable: true, expected: "retry" },
      { status: 500, retryable: true, expected: "retry" },
      { status: 502, retryable: true, expected: "retry" },
      { status: 503, retryable: true, expected: "retry" },
      { status: 504, retryable: true, expected: "retry" },
    ];

    it.each(testStatusCodes)(
      "should return $expected for HTTP $status (retryable: $retryable)",
      ({ status, retryable, expected }) => {
        const result: PublishResult = {
          success: false,
          error: new Error(`HTTP ${status}`),
          retryable,
        };

        const decision = decideRetry(result, 0, 5);

        expect(decision).toBe(expected);
      },
    );

    it("should return 'dlq' for 429 when max retries exceeded", () => {
      const result: PublishResult = {
        success: false,
        error: new Error("HTTP 429 Too Many Requests"),
        retryable: true,
      };

      expect(decideRetry(result, 5, 5)).toBe("dlq");
    });

    it("should return 'dlq' for 503 when max retries exceeded", () => {
      const result: PublishResult = {
        success: false,
        error: new Error("HTTP 503 Service Unavailable"),
        retryable: true,
      };

      expect(decideRetry(result, 3, 3)).toBe("dlq");
    });
  });
});
