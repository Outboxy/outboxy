import { describe, it, expect, vi, beforeEach } from "vitest";
import { SpanStatusCode } from "@opentelemetry/api";
import type {
  Publisher,
  PublishResult,
  OutboxEvent,
} from "@outboxy/publisher-core";

const mockSpan = vi.hoisted(() => ({
  end: vi.fn(),
  setStatus: vi.fn(),
}));

const mockStartActiveSpan = vi.hoisted(() =>
  vi.fn(
    (
      _name: string,
      _options: unknown,
      _context: unknown,
      fn: (span: typeof mockSpan) => unknown,
    ) => fn(mockSpan),
  ),
);

vi.mock("@opentelemetry/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@opentelemetry/api")>();
  return {
    ...actual,
    trace: {
      getTracer: () => ({
        startActiveSpan: mockStartActiveSpan,
      }),
    },
    context: {
      active: () => ({}),
    },
    propagation: {
      extract: (_ctx: unknown, _carrier: unknown) => ({ extracted: true }),
    },
  };
});

import { wrapPublisher } from "../publisher-wrapper.js";

function createMockPublisher(result?: Map<string, PublishResult>): Publisher {
  return {
    initialize: vi.fn(),
    shutdown: vi.fn(),
    publish: vi.fn().mockResolvedValue(result ?? new Map()),
  };
}

function createMockEvent(overrides: Partial<OutboxEvent> = {}): OutboxEvent {
  const now = new Date();
  return {
    id: "evt-1",
    aggregateType: "Order",
    aggregateId: "order-1",
    eventType: "OrderCreated",
    eventVersion: 1,
    payload: { amount: 100 },
    headers: { traceparent: "00-abc-def-01" },
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
}

describe("wrapPublisher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should delegate directly for empty events", async () => {
    const inner = createMockPublisher();
    const wrapped = wrapPublisher(inner);

    await wrapped.publish([]);

    expect(inner.publish).toHaveBeenCalledWith([]);
    expect(mockStartActiveSpan).not.toHaveBeenCalled();
  });

  it("should call inner publisher and return result", async () => {
    const expectedResult = new Map<string, PublishResult>([
      ["evt-1", { success: true, retryable: false, durationMs: 10 }],
    ]);
    const inner = createMockPublisher(expectedResult);
    const wrapped = wrapPublisher(inner);

    const result = await wrapped.publish([createMockEvent()]);

    expect(inner.publish).toHaveBeenCalledTimes(1);
    expect(result).toBe(expectedResult);
    expect(mockSpan.end).toHaveBeenCalled();
  });

  it("should set correct span attributes", async () => {
    const inner = createMockPublisher();
    const wrapped = wrapPublisher(inner);

    const events = [
      createMockEvent({ id: "evt-1", eventType: "OrderCreated" }),
      createMockEvent({
        id: "evt-2",
        eventType: "OrderShipped",
        destinationUrl: "https://webhook.example.com",
      }),
    ];

    await wrapped.publish(events);

    expect(mockStartActiveSpan).toHaveBeenCalledWith(
      "outbox.deliver OrderCreated,OrderShipped",
      {
        attributes: {
          "outbox.batch_size": 2,
          "outbox.destination_url": "https://webhook.example.com",
          "outbox.event_types": "OrderCreated,OrderShipped",
        },
      },
      expect.anything(),
      expect.any(Function),
    );
  });

  it("should set ERROR status and re-throw on publisher failure", async () => {
    const error = new Error("Connection refused");
    const inner = createMockPublisher();
    (inner.publish as ReturnType<typeof vi.fn>).mockRejectedValue(error);
    const wrapped = wrapPublisher(inner);

    await expect(wrapped.publish([createMockEvent()])).rejects.toThrow(
      "Connection refused",
    );

    expect(mockSpan.setStatus).toHaveBeenCalledWith({
      code: SpanStatusCode.ERROR,
      message: "Error: Connection refused",
    });
    expect(mockSpan.end).toHaveBeenCalled();
  });

  it("should strip traceparent/tracestate from events before delegating", async () => {
    const inner = createMockPublisher();
    const wrapped = wrapPublisher(inner);

    const events = [
      createMockEvent({
        headers: {
          traceparent: "00-abc-def-01",
          tracestate: "vendor=opaque",
          "x-correlation-id": "corr-123",
        },
      }),
    ];

    await wrapped.publish(events);

    const delegatedEvents = (inner.publish as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as OutboxEvent[];
    expect(delegatedEvents[0]!.headers).toEqual({
      "x-correlation-id": "corr-123",
    });
    // Original events not mutated
    expect(events[0]!.headers).toHaveProperty("traceparent");
  });

  it("should pass events through when no trace headers present", async () => {
    const inner = createMockPublisher();
    const wrapped = wrapPublisher(inner);

    const events = [
      createMockEvent({
        headers: { "x-custom": "value" },
      }),
    ];

    await wrapped.publish(events);

    const delegatedEvents = (inner.publish as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as OutboxEvent[];
    expect(delegatedEvents[0]!.headers).toEqual({ "x-custom": "value" });
  });

  it("should delegate initialize and shutdown", async () => {
    const inner = createMockPublisher();
    const wrapped = wrapPublisher(inner);

    await wrapped.initialize?.();
    await wrapped.shutdown?.();

    expect(inner.initialize).toHaveBeenCalled();
    expect(inner.shutdown).toHaveBeenCalled();
  });
});
