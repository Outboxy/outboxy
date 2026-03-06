import { describe, it, expect, vi, beforeEach } from "vitest";
import { OutboxyClient, createClient } from "../../client.js";
import {
  OutboxyValidationError,
  OutboxyConnectionError,
} from "../../errors.js";
import {
  makeAdapter,
  makeOutboxDialect as makeDialect,
  mockQueryFn,
  BASE_OUTBOX_EVENT as BASE_EVENT,
  DEFAULT_DESTINATION_URL,
  UUID_REGEX,
} from "./helpers.js";

const MYSQL_DIALECT_OVERRIDES = {
  name: "mysql" as const,
  supportsReturning: false,
  maxParameters: 65535,
};

describe("OutboxyClient.publish() — destinationUrl validation", () => {
  it("throws OutboxyValidationError when no destinationUrl in event or config", async () => {
    const queryFn = mockQueryFn().mockResolvedValue([{ id: "evt-1" }]);
    const client = new OutboxyClient({
      adapter: makeAdapter(queryFn),
      dialect: makeDialect(),
    });

    await expect(client.publish({ ...BASE_EVENT }, {})).rejects.toThrow(
      OutboxyValidationError,
    );
    await expect(client.publish({ ...BASE_EVENT }, {})).rejects.toThrow(
      "destinationUrl is required",
    );
  });

  it("uses event destinationUrl when provided, overriding missing default", async () => {
    const queryFn = mockQueryFn().mockResolvedValue([{ id: "evt-1" }]);
    const client = new OutboxyClient({
      adapter: makeAdapter(queryFn),
      dialect: makeDialect(),
    });

    const eventId = await client.publish(
      { ...BASE_EVENT, destinationUrl: "https://event.example.com" },
      {},
    );

    expect(eventId).toBe("evt-1");
  });
});

describe("OutboxyClient.publish() — MySQL (supportsReturning=false)", () => {
  let queryFn: ReturnType<typeof mockQueryFn>;
  let client: OutboxyClient<unknown>;

  beforeEach(() => {
    queryFn = mockQueryFn().mockResolvedValue([{ id: "" }]);
    client = new OutboxyClient({
      adapter: makeAdapter(queryFn),
      dialect: makeDialect(MYSQL_DIALECT_OVERRIDES),
      defaultDestinationUrl: DEFAULT_DESTINATION_URL,
    });
  });

  it("returns a pre-generated UUID when INSERT succeeds", async () => {
    const eventId = await client.publish({ ...BASE_EVENT }, {});

    expect(typeof eventId).toBe("string");
    expect(eventId.length).toBeGreaterThan(0);
    expect(eventId).toMatch(UUID_REGEX);
  });

  it("throws OutboxyConnectionError on connection failure", async () => {
    const connError = new Error("ECONNREFUSED") as Error & { code: string };
    connError.code = "ECONNREFUSED";
    queryFn.mockRejectedValue(connError);

    await expect(client.publish({ ...BASE_EVENT }, {})).rejects.toThrow(
      OutboxyConnectionError,
    );
    await expect(client.publish({ ...BASE_EVENT }, {})).rejects.toThrow(
      "Database connection failed while publishing event",
    );
  });

  it("re-throws non-connection errors", async () => {
    const genericError = new Error("Syntax error in SQL");
    queryFn.mockRejectedValue(genericError);

    await expect(client.publish({ ...BASE_EVENT }, {})).rejects.toThrow(
      "Syntax error in SQL",
    );
  });
});

describe("OutboxyClient.publish() — INSERT RETURNING produces no rows", () => {
  it("throws Error when RETURNING clause returns empty rows", async () => {
    const queryFn = mockQueryFn().mockResolvedValue([]);
    const client = new OutboxyClient({
      adapter: makeAdapter(queryFn),
      dialect: makeDialect({ supportsReturning: true }),
      defaultDestinationUrl: DEFAULT_DESTINATION_URL,
    });

    await expect(client.publish({ ...BASE_EVENT }, {})).rejects.toThrow(
      "INSERT with RETURNING produced no rows",
    );
  });
});

describe("OutboxyClient.publishBatch() — validation", () => {
  let queryFn: ReturnType<typeof mockQueryFn>;
  let client: OutboxyClient<unknown>;

  beforeEach(() => {
    queryFn = mockQueryFn().mockResolvedValue([
      { id: "evt-1" },
      { id: "evt-2" },
    ]);
    client = new OutboxyClient({
      adapter: makeAdapter(queryFn),
      dialect: makeDialect(),
      defaultDestinationUrl: DEFAULT_DESTINATION_URL,
    });
  });

  it("returns empty array for empty input without calling adapter", async () => {
    const result = await client.publishBatch([], {});

    expect(result).toEqual([]);
    expect(queryFn).not.toHaveBeenCalled();
  });

  it("throws OutboxyValidationError when event lacks destinationUrl and no default", async () => {
    const clientWithoutDefault = new OutboxyClient({
      adapter: makeAdapter(queryFn),
      dialect: makeDialect(),
    });

    const events = [
      { ...BASE_EVENT, destinationUrl: "https://valid.example.com" },
      { ...BASE_EVENT },
    ];

    await expect(clientWithoutDefault.publishBatch(events, {})).rejects.toThrow(
      OutboxyValidationError,
    );
    await expect(clientWithoutDefault.publishBatch(events, {})).rejects.toThrow(
      "destinationUrl is required for event at index 1",
    );
  });

  it("throws OutboxyValidationError for duplicate idempotency keys in batch", async () => {
    const events = [
      { ...BASE_EVENT, idempotencyKey: "same-key" },
      { ...BASE_EVENT, aggregateId: "456", idempotencyKey: "same-key" },
    ];

    await expect(client.publishBatch(events, {})).rejects.toThrow(
      OutboxyValidationError,
    );
    await expect(client.publishBatch(events, {})).rejects.toThrow(
      "Duplicate idempotency keys within batch are not allowed",
    );
  });

  it("succeeds with unique idempotency keys in batch", async () => {
    const events = [
      { ...BASE_EVENT, idempotencyKey: "key-1" },
      { ...BASE_EVENT, aggregateId: "456", idempotencyKey: "key-2" },
    ];

    const result = await client.publishBatch(events, {});

    expect(result).toEqual(["evt-1", "evt-2"]);
  });

  it("allows batch with no idempotency keys", async () => {
    const events = [{ ...BASE_EVENT }, { ...BASE_EVENT, aggregateId: "456" }];

    const result = await client.publishBatch(events, {});

    expect(result).toHaveLength(2);
  });
});

describe("OutboxyClient.publishBatch() — MySQL (supportsReturning=false)", () => {
  it("returns pre-generated UUIDs for batch events", async () => {
    const queryFn = mockQueryFn().mockResolvedValue([]);
    const client = new OutboxyClient({
      adapter: makeAdapter(queryFn),
      dialect: makeDialect(MYSQL_DIALECT_OVERRIDES),
      defaultDestinationUrl: DEFAULT_DESTINATION_URL,
    });

    const events = [{ ...BASE_EVENT }, { ...BASE_EVENT, aggregateId: "456" }];

    const result = await client.publishBatch(events, {});

    expect(result).toHaveLength(2);
    for (const id of result) {
      expect(id).toMatch(UUID_REGEX);
    }
  });
});

describe("OutboxyClient.publishBatch() — chunking", () => {
  it("chunks batches that exceed maxParameters", async () => {
    // Each event uses 12 params; maxParameters=24 means 2 events per chunk
    const chunkQueryFn = mockQueryFn()
      .mockResolvedValueOnce([{ id: "evt-1" }, { id: "evt-2" }])
      .mockResolvedValueOnce([{ id: "evt-3" }]);

    const client = new OutboxyClient({
      adapter: makeAdapter(chunkQueryFn),
      dialect: makeDialect({ maxParameters: 24 }),
      defaultDestinationUrl: DEFAULT_DESTINATION_URL,
    });

    const events = [
      { ...BASE_EVENT, aggregateId: "1" },
      { ...BASE_EVENT, aggregateId: "2" },
      { ...BASE_EVENT, aggregateId: "3" },
    ];

    const result = await client.publishBatch(events, {});

    expect(result).toEqual(["evt-1", "evt-2", "evt-3"]);
    expect(chunkQueryFn).toHaveBeenCalledTimes(2);
  });

  it("throws OutboxyConnectionError when bulk insert fails with connection error", async () => {
    const connError = new Error("Connection failed") as Error & {
      code: string;
    };
    connError.code = "ECONNREFUSED";
    const failingQueryFn = mockQueryFn().mockRejectedValue(connError);

    const client = new OutboxyClient({
      adapter: makeAdapter(failingQueryFn),
      dialect: makeDialect(),
      defaultDestinationUrl: DEFAULT_DESTINATION_URL,
    });

    const events = [{ ...BASE_EVENT }, { ...BASE_EVENT, aggregateId: "456" }];

    await expect(client.publishBatch(events, {})).rejects.toThrow(
      OutboxyConnectionError,
    );
    await expect(client.publishBatch(events, {})).rejects.toThrow(
      "Database connection failed while inserting events",
    );
  });

  it("re-throws non-connection errors from bulk insert", async () => {
    const genericError = new Error("SQL syntax error");
    const failingQueryFn = mockQueryFn().mockRejectedValue(genericError);

    const client = new OutboxyClient({
      adapter: makeAdapter(failingQueryFn),
      dialect: makeDialect(),
      defaultDestinationUrl: DEFAULT_DESTINATION_URL,
    });

    const events = [{ ...BASE_EVENT }, { ...BASE_EVENT, aggregateId: "456" }];

    await expect(client.publishBatch(events, {})).rejects.toThrow(
      "SQL syntax error",
    );
  });
});

describe("createClient()", () => {
  it("returns an OutboxyClient instance", () => {
    const queryFn = mockQueryFn().mockResolvedValue([{ id: "evt-1" }]);
    const client = createClient({
      adapter: makeAdapter(queryFn),
      dialect: makeDialect(),
      defaultDestinationUrl: DEFAULT_DESTINATION_URL,
    });

    expect(client).toBeInstanceOf(OutboxyClient);
  });

  it("creates a functional client that can publish events", async () => {
    const queryFn = mockQueryFn().mockResolvedValue([
      { id: "created-event-id" },
    ]);
    const client = createClient({
      adapter: makeAdapter(queryFn),
      dialect: makeDialect(),
      defaultDestinationUrl: DEFAULT_DESTINATION_URL,
    });

    const eventId = await client.publish({ ...BASE_EVENT }, {});

    expect(eventId).toBe("created-event-id");
  });
});

describe("OutboxyClient constructor", () => {
  it("passes defaultMaxRetries to dialect buildInsert", async () => {
    const buildInsert = vi
      .fn()
      .mockReturnValue({ sql: "INSERT INTO outbox_events", params: [] });
    const dialectWithSpy = makeDialect({ buildInsert });
    const queryFn = mockQueryFn().mockResolvedValue([{ id: "evt-1" }]);
    const client = new OutboxyClient({
      adapter: makeAdapter(queryFn),
      dialect: dialectWithSpy,
      defaultDestinationUrl: DEFAULT_DESTINATION_URL,
      defaultMaxRetries: 10,
    });

    await client.publish({ ...BASE_EVENT }, {});

    expect(buildInsert).toHaveBeenCalledOnce();
    const [args] = buildInsert.mock.calls[0] as [{ values: unknown[] }];
    // maxRetries is at index 9 in baseValues (0-indexed)
    expect(args.values[9]).toBe(10);
  });

  it("throws OutboxyValidationError for invalid defaultDestinationType in constructor", () => {
    const queryFn = mockQueryFn();
    expect(() => {
      new OutboxyClient({
        adapter: makeAdapter(queryFn),
        dialect: makeDialect(),
        defaultDestinationUrl: DEFAULT_DESTINATION_URL,
        defaultDestinationType: "invalid" as "http",
      });
    }).toThrow(OutboxyValidationError);
  });

  it("accepts all valid destination types", () => {
    const queryFn = mockQueryFn();
    const validTypes = ["http", "kafka", "sqs", "rabbitmq", "pubsub"] as const;

    for (const type of validTypes) {
      expect(() => {
        new OutboxyClient({
          adapter: makeAdapter(queryFn),
          dialect: makeDialect(),
          defaultDestinationUrl: DEFAULT_DESTINATION_URL,
          defaultDestinationType: type,
        });
      }).not.toThrow();
    }
  });
});

describe("OutboxyClient.publish() — connection errors", () => {
  it("throws OutboxyConnectionError on ETIMEDOUT", async () => {
    const connError = new Error("ETIMEDOUT") as Error & { code: string };
    connError.code = "ETIMEDOUT";
    const queryFn = mockQueryFn().mockRejectedValue(connError);

    const client = new OutboxyClient({
      adapter: makeAdapter(queryFn),
      dialect: makeDialect(),
      defaultDestinationUrl: DEFAULT_DESTINATION_URL,
    });

    await expect(client.publish({ ...BASE_EVENT }, {})).rejects.toThrow(
      OutboxyConnectionError,
    );
  });

  it("re-throws non-connection errors without wrapping", async () => {
    const customError = new Error("Custom application error");
    const queryFn = mockQueryFn().mockRejectedValue(customError);

    const client = new OutboxyClient({
      adapter: makeAdapter(queryFn),
      dialect: makeDialect(),
      defaultDestinationUrl: DEFAULT_DESTINATION_URL,
    });

    await expect(client.publish({ ...BASE_EVENT }, {})).rejects.toThrow(
      "Custom application error",
    );
    await expect(client.publish({ ...BASE_EVENT }, {})).rejects.not.toThrow(
      OutboxyConnectionError,
    );
  });
});
