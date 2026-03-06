import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HttpPublisher } from "../http.publisher.js";
import type { OutboxEvent } from "@outboxy/publisher-core";

vi.mock("undici", () => ({
  request: vi.fn(),
}));

import { request } from "undici";

describe("HttpPublisher", () => {
  let publisher: HttpPublisher;
  const mockRequest = request as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    publisher = new HttpPublisher({ timeoutMs: 5000 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createMockEvent = (
    overrides: Partial<OutboxEvent> = {},
  ): OutboxEvent => {
    const now = new Date();
    return {
      id: "event-123",
      aggregateType: "Order",
      aggregateId: "order-456",
      eventType: "OrderCreated",
      eventVersion: 1,
      payload: { amount: 100 },
      headers: {},
      destinationUrl: "https://webhook.example.com",
      destinationType: "http",
      idempotencyKey: null,
      status: "pending",
      retryCount: 0,
      maxRetries: 5,
      nextRetryAt: null,
      backoffMultiplier: "2.0",
      lastError: null,
      errorDetails: null,
      createdAt: now,
      updatedAt: now,
      processingStartedAt: null,
      processedAt: null,
      metadata: {},
      processedByWorker: null,
      deletedAt: null,
      createdDate: now,
      ...overrides,
    };
  };

  describe("constructor", () => {
    it("should create instance with default config", () => {
      const pub = new HttpPublisher();
      expect(pub).toBeDefined();
    });

    it("should create instance with custom config", () => {
      const pub = new HttpPublisher({
        timeoutMs: 10000,
        userAgent: "CustomAgent/1.0",
      });
      expect(pub).toBeDefined();
    });
  });

  describe("initialize", () => {
    it("should initialize without error", async () => {
      await expect(publisher.initialize()).resolves.toBeUndefined();
    });
  });

  describe("shutdown", () => {
    it("should shutdown without error", async () => {
      await expect(publisher.shutdown()).resolves.toBeUndefined();
    });
  });

  describe("publish", () => {
    it("should publish single event successfully", async () => {
      mockRequest.mockResolvedValueOnce({
        statusCode: 200,
        body: { text: vi.fn().mockResolvedValue("{}") },
      });

      const event = createMockEvent();
      const results = await publisher.publish([event]);

      expect(results.size).toBe(1);
      expect(results.get("event-123")).toEqual({
        success: true,
        retryable: false,
        durationMs: expect.any(Number),
      });

      expect(mockRequest).toHaveBeenCalledWith(
        "https://webhook.example.com",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            "X-Outbox-Batch": "true",
          }),
        }),
      );
    });

    it("should batch multiple events to same destination", async () => {
      mockRequest.mockResolvedValueOnce({
        statusCode: 200,
        body: { text: vi.fn().mockResolvedValue("{}") },
      });

      const events = [
        createMockEvent({ id: "event-1" }),
        createMockEvent({ id: "event-2" }),
        createMockEvent({ id: "event-3" }),
      ];

      const results = await publisher.publish(events);

      expect(results.size).toBe(3);
      expect(mockRequest).toHaveBeenCalledTimes(1);
      expect(results.get("event-1")?.success).toBe(true);
      expect(results.get("event-2")?.success).toBe(true);
      expect(results.get("event-3")?.success).toBe(true);
    });

    it("should send separate requests for different destinations", async () => {
      mockRequest.mockResolvedValue({
        statusCode: 200,
        body: { text: vi.fn().mockResolvedValue("{}") },
      });

      const events = [
        createMockEvent({
          id: "event-1",
          destinationUrl: "https://webhook1.example.com",
        }),
        createMockEvent({
          id: "event-2",
          destinationUrl: "https://webhook2.example.com",
        }),
      ];

      const results = await publisher.publish(events);

      expect(results.size).toBe(2);
      expect(mockRequest).toHaveBeenCalledTimes(2);
    });

    it("should handle 4xx errors as non-retryable", async () => {
      mockRequest.mockResolvedValueOnce({
        statusCode: 400,
        body: { text: vi.fn().mockResolvedValue("Bad Request") },
      });

      const event = createMockEvent();
      const results = await publisher.publish([event]);

      expect(results.get("event-123")).toEqual({
        success: false,
        error: expect.any(Error),
        retryable: false,
        durationMs: expect.any(Number),
      });
    });

    it("should handle 5xx errors as retryable", async () => {
      mockRequest.mockResolvedValueOnce({
        statusCode: 500,
        body: { text: vi.fn().mockResolvedValue("Internal Server Error") },
      });

      const event = createMockEvent();
      const results = await publisher.publish([event]);

      expect(results.get("event-123")).toEqual({
        success: false,
        error: expect.any(Error),
        retryable: true,
        durationMs: expect.any(Number),
      });
    });

    it("should handle 429 rate limit as retryable", async () => {
      mockRequest.mockResolvedValueOnce({
        statusCode: 429,
        body: { text: vi.fn().mockResolvedValue("Too Many Requests") },
      });

      const event = createMockEvent();
      const results = await publisher.publish([event]);

      expect(results.get("event-123")?.retryable).toBe(true);
    });

    it("should handle 408 timeout as retryable", async () => {
      mockRequest.mockResolvedValueOnce({
        statusCode: 408,
        body: { text: vi.fn().mockResolvedValue("Request Timeout") },
      });

      const event = createMockEvent();
      const results = await publisher.publish([event]);

      expect(results.get("event-123")?.retryable).toBe(true);
    });

    it("should handle network errors as retryable", async () => {
      mockRequest.mockRejectedValueOnce(new Error("ECONNREFUSED"));

      const event = createMockEvent();
      const results = await publisher.publish([event]);

      expect(results.get("event-123")).toEqual({
        success: false,
        error: expect.any(Error),
        retryable: true,
        durationMs: expect.any(Number),
      });
    });

    it("should parse individual results from response body", async () => {
      mockRequest.mockResolvedValueOnce({
        statusCode: 200,
        body: {
          text: vi.fn().mockResolvedValue(
            JSON.stringify({
              results: {
                "event-1": { success: true },
                "event-2": {
                  success: false,
                  retryable: true,
                  error: "Processing failed",
                },
              },
            }),
          ),
        },
      });

      const events = [
        createMockEvent({ id: "event-1" }),
        createMockEvent({ id: "event-2" }),
      ];

      const results = await publisher.publish(events);

      expect(results.get("event-1")?.success).toBe(true);
      expect(results.get("event-2")?.success).toBe(false);
      expect(results.get("event-2")?.retryable).toBe(true);
    });

    it("should include batch headers in request", async () => {
      mockRequest.mockResolvedValueOnce({
        statusCode: 200,
        body: { text: vi.fn().mockResolvedValue("{}") },
      });

      const events = [
        createMockEvent({ id: "event-1" }),
        createMockEvent({ id: "event-2" }),
      ];

      await publisher.publish(events);

      expect(mockRequest).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            "X-Outbox-Batch": "true",
            "X-Outbox-Batch-Size": "2",
            "X-Outbox-Event-IDs": "event-1,event-2",
          }),
        }),
      );
    });

    it("should return empty map for empty events array", async () => {
      const results = await publisher.publish([]);
      expect(results.size).toBe(0);
      expect(mockRequest).not.toHaveBeenCalled();
    });
  });

  describe("header forwarding", () => {
    function mockSuccessResponse(): void {
      mockRequest.mockResolvedValueOnce({
        statusCode: 200,
        body: { text: vi.fn().mockResolvedValue("{}") },
      });
    }

    function getLastCallHeaders(): Record<string, string> | undefined {
      return mockRequest.mock.calls[0]?.[1]?.headers;
    }

    it("should forward string-valued event headers", async () => {
      mockSuccessResponse();

      const event = createMockEvent({
        headers: {
          traceparent: "00-abc-def-01",
          "x-correlation-id": "123",
        },
      });
      await publisher.publish([event]);

      expect(getLastCallHeaders()).toMatchObject({
        traceparent: "00-abc-def-01",
        "x-correlation-id": "123",
      });
    });

    it("should block system headers from event headers", async () => {
      mockSuccessResponse();

      const event = createMockEvent({
        headers: {
          host: "evil.com",
          "content-type": "text/plain",
          "transfer-encoding": "chunked",
          traceparent: "00-abc-def-01",
        },
      });
      await publisher.publish([event]);

      const callHeaders = getLastCallHeaders();
      expect(callHeaders?.host).toBeUndefined();
      expect(callHeaders?.["transfer-encoding"]).toBeUndefined();
      expect(callHeaders?.["Content-Type"]).toBe("application/json");
      expect(callHeaders?.traceparent).toBe("00-abc-def-01");
    });

    it("should handle null/undefined/empty headers gracefully", async () => {
      mockSuccessResponse();

      const event = createMockEvent({
        headers: null as unknown as Record<string, unknown>,
      });
      const results = await publisher.publish([event]);

      expect(results.get(event.id)?.success).toBe(true);
    });

    it("should drop non-string header values", async () => {
      mockSuccessResponse();

      const event = createMockEvent({
        headers: {
          nested: { obj: true } as unknown as string,
          number: 42 as unknown as string,
          valid: "kept",
        },
      });
      await publisher.publish([event]);

      const callHeaders = getLastCallHeaders();
      expect(callHeaders?.nested).toBeUndefined();
      expect(callHeaders?.number).toBeUndefined();
      expect(callHeaders?.valid).toBe("kept");
    });

    it("should block authorization header to prevent credential leaking", async () => {
      mockSuccessResponse();

      const event = createMockEvent({
        headers: {
          authorization: "Bearer secret-token",
          "proxy-authorization": "Basic creds",
          traceparent: "00-abc-def-01",
        },
      });
      await publisher.publish([event]);

      const callHeaders = getLastCallHeaders();
      expect(callHeaders?.authorization).toBeUndefined();
      expect(callHeaders?.["proxy-authorization"]).toBeUndefined();
      expect(callHeaders?.traceparent).toBe("00-abc-def-01");
    });

    it("should block cookie header to prevent credential leaking", async () => {
      mockSuccessResponse();

      const event = createMockEvent({
        headers: {
          cookie: "session=abc123; token=secret",
          "x-correlation-id": "123",
        },
      });
      await publisher.publish([event]);

      const callHeaders = getLastCallHeaders();
      expect(callHeaders?.cookie).toBeUndefined();
      expect(callHeaders?.["x-correlation-id"]).toBe("123");
    });

    it("should block proxy and forwarding headers", async () => {
      mockSuccessResponse();

      const event = createMockEvent({
        headers: {
          "x-forwarded-for": "10.0.0.1",
          "x-forwarded-host": "internal.corp",
          "x-forwarded-proto": "https",
          "x-real-ip": "192.168.1.1",
          traceparent: "00-abc-def-01",
        },
      });
      await publisher.publish([event]);

      const callHeaders = getLastCallHeaders();
      expect(callHeaders?.["x-forwarded-for"]).toBeUndefined();
      expect(callHeaders?.["x-forwarded-host"]).toBeUndefined();
      expect(callHeaders?.["x-forwarded-proto"]).toBeUndefined();
      expect(callHeaders?.["x-real-ip"]).toBeUndefined();
      expect(callHeaders?.traceparent).toBe("00-abc-def-01");
    });

    it("should let system headers win over event headers", async () => {
      mockSuccessResponse();

      const event = createMockEvent({
        headers: {
          "X-Outbox-Batch": "false",
          "User-Agent": "attacker/1.0",
        },
      });
      await publisher.publish([event]);

      expect(getLastCallHeaders()?.["X-Outbox-Batch"]).toBe("true");
    });
  });
});
