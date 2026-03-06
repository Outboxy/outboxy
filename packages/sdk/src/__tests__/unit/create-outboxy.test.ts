import { describe, it, expect, vi } from "vitest";
import { createOutboxy } from "../../create-outboxy.js";
import { OutboxyClient } from "../../client.js";
import { InboxyClient } from "../../inbox-client.js";
import {
  makeOutboxDialect,
  makeInboxDialect,
  BASE_OUTBOX_EVENT as BASE_EVENT,
  DEFAULT_DESTINATION_URL,
} from "./helpers.js";

const mockAdapter = (_executor: unknown) =>
  vi.fn().mockResolvedValue([{ id: "evt-1" }]);

describe("createOutboxy()", () => {
  it("returns OutboxyClient for outbox and InboxyClient for inbox", () => {
    const { outbox, inbox } = createOutboxy({
      adapter: mockAdapter,
      dialect: makeOutboxDialect(),
      inboxDialect: makeInboxDialect(),
    });

    expect(outbox).toBeInstanceOf(OutboxyClient);
    expect(inbox).toBeInstanceOf(InboxyClient);
  });

  it("passes defaultDestinationUrl to outbox client", async () => {
    const queryFn = vi.fn().mockResolvedValue([{ id: "evt-1" }]);
    const { outbox } = createOutboxy({
      adapter: (_executor: unknown) => queryFn,
      dialect: makeOutboxDialect(),
      inboxDialect: makeInboxDialect(),
      defaultDestinationUrl: DEFAULT_DESTINATION_URL,
    });

    const eventId = await outbox.publish({ ...BASE_EVENT }, {});

    expect(eventId).toBe("evt-1");
    expect(queryFn).toHaveBeenCalledOnce();
  });

  it("passes defaultHeaders to both outbox and inbox clients", async () => {
    const queryFn = vi.fn().mockResolvedValue([{ id: "evt-1" }]);
    const { outbox, inbox } = createOutboxy({
      adapter: (_executor: unknown) => queryFn,
      dialect: makeOutboxDialect(),
      inboxDialect: makeInboxDialect(),
      defaultDestinationUrl: DEFAULT_DESTINATION_URL,
      defaultHeaders: { "x-service": "test" },
    });

    const outboxId = await outbox.publish(
      { ...BASE_EVENT, aggregateId: "1" },
      {},
    );
    expect(outboxId).toBe("evt-1");

    queryFn.mockResolvedValue([{ id: "inbox-evt-1" }]);
    const result = await inbox.receive(
      {
        idempotencyKey: "order-1",
        ...BASE_EVENT,
        aggregateId: "1",
      },
      {},
    );
    expect(result.status).toBe("processed");
  });

  it("passes defaultMetadata to both outbox and inbox clients", async () => {
    const queryFn = vi.fn().mockResolvedValue([{ id: "evt-1" }]);
    const { outbox, inbox } = createOutboxy({
      adapter: (_executor: unknown) => queryFn,
      dialect: makeOutboxDialect(),
      inboxDialect: makeInboxDialect(),
      defaultDestinationUrl: DEFAULT_DESTINATION_URL,
      defaultMetadata: { env: "test" },
    });

    const outboxId = await outbox.publish(
      { ...BASE_EVENT, aggregateId: "1" },
      {},
    );
    expect(outboxId).toBe("evt-1");

    queryFn.mockResolvedValue([{ id: "inbox-evt-1" }]);
    const result = await inbox.receive(
      {
        idempotencyKey: "order-1",
        ...BASE_EVENT,
        aggregateId: "1",
      },
      {},
    );
    expect(result.status).toBe("processed");
  });

  it("both clients use the same adapter so they receive the same executor", async () => {
    const capturedExecutors: unknown[] = [];
    const executor = { txId: "tx-123" };

    const trackingAdapter = (e: unknown) => {
      capturedExecutors.push(e);
      return vi.fn().mockResolvedValue([{ id: "evt-1" }]);
    };

    const { outbox } = createOutboxy({
      adapter: trackingAdapter,
      dialect: makeOutboxDialect(),
      inboxDialect: makeInboxDialect(),
      defaultDestinationUrl: DEFAULT_DESTINATION_URL,
    });

    await outbox.publish({ ...BASE_EVENT, aggregateId: "1" }, executor);

    // Need a fresh instance for inbox to track the second executor capture
    const inboxTrackingAdapter = (e: unknown) => {
      capturedExecutors.push(e);
      return vi.fn().mockResolvedValue([{ id: "inbox-evt-1" }]);
    };
    const { inbox: trackedInbox } = createOutboxy({
      adapter: inboxTrackingAdapter,
      dialect: makeOutboxDialect(),
      inboxDialect: makeInboxDialect(),
    });
    await trackedInbox.receive(
      {
        idempotencyKey: "order-1",
        ...BASE_EVENT,
        aggregateId: "1",
      },
      executor,
    );

    expect(capturedExecutors[0]).toBe(executor);
    expect(capturedExecutors[1]).toBe(executor);
  });

  it("outbox publish throws validation error when destinationUrl not set", async () => {
    const { outbox } = createOutboxy({
      adapter: mockAdapter,
      dialect: makeOutboxDialect(),
      inboxDialect: makeInboxDialect(),
    });

    await expect(
      outbox.publish({ ...BASE_EVENT, aggregateId: "1" }, {}),
    ).rejects.toThrow("destinationUrl is required");
  });
});
