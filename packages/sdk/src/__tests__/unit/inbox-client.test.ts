import { describe, it, expect, vi, beforeEach } from "vitest";
import type { InboxSqlDialect } from "@outboxy/dialect-core";
import { InboxyClient, createInboxClient } from "../../inbox-client.js";
import {
  OutboxyValidationError,
  OutboxyConnectionError,
} from "../../errors.js";
import type { InboxyConfig } from "../../inbox-types.js";
import type { QueryFn } from "../../types.js";
import {
  makeAdapter,
  makeInboxDialect as makeDialect,
  mockQueryFn,
  UUID_REGEX,
} from "./helpers.js";

function makeConfig(
  queryFn: QueryFn,
  dialectOverrides: Partial<InboxSqlDialect> = {},
): InboxyConfig<unknown> {
  return {
    adapter: makeAdapter(queryFn),
    dialect: makeDialect(dialectOverrides),
  };
}

const VALID_EVENT = {
  idempotencyKey: "order-123",
  aggregateType: "Order",
  aggregateId: "123",
  eventType: "OrderCreated",
  payload: { orderId: "123" },
};

const MYSQL_DIALECT_OVERRIDES = {
  name: "mysql" as const,
  supportsReturning: false,
  maxParameters: 65535,
};

describe("InboxyClient.receive() — PostgreSQL (supportsReturning)", () => {
  let queryFn: ReturnType<typeof mockQueryFn>;
  let client: InboxyClient<unknown>;

  beforeEach(() => {
    queryFn = mockQueryFn().mockResolvedValue([{ id: "event-uuid-1" }]);
    client = new InboxyClient(makeConfig(queryFn));
  });

  it("returns processed status with eventId when INSERT succeeds", async () => {
    const result = await client.receive(VALID_EVENT, {});

    expect(result.status).toBe("processed");
    expect(result.eventId).toBe("event-uuid-1");
  });

  it("returns duplicate status when INSERT returns empty rows (conflict)", async () => {
    queryFn.mockResolvedValue([]);
    const result = await client.receive(VALID_EVENT, {});

    expect(result.status).toBe("duplicate");
    expect(result.eventId).toBeNull();
  });

  it("throws OutboxyValidationError when idempotencyKey is missing", async () => {
    const event = { ...VALID_EVENT, idempotencyKey: "" };

    await expect(client.receive(event, {})).rejects.toThrow(
      OutboxyValidationError,
    );
    await expect(client.receive(event, {})).rejects.toThrow(
      "idempotencyKey is required",
    );
  });

  it("throws OutboxyValidationError when idempotencyKey is invalid format", async () => {
    const event = { ...VALID_EVENT, idempotencyKey: "invalid key!" };

    await expect(client.receive(event, {})).rejects.toThrow(
      OutboxyValidationError,
    );
  });

  it("throws OutboxyValidationError when eventVersion is not a positive integer", async () => {
    const event = { ...VALID_EVENT, eventVersion: 0 };

    await expect(client.receive(event, {})).rejects.toThrow(
      OutboxyValidationError,
    );
    await expect(client.receive(event, {})).rejects.toThrow(
      "eventVersion must be a positive integer",
    );
  });

  it("throws OutboxyValidationError when eventVersion is a float", async () => {
    const event = { ...VALID_EVENT, eventVersion: 1.5 };

    await expect(client.receive(event, {})).rejects.toThrow(
      OutboxyValidationError,
    );
  });

  it("passes headers and metadata to dialect buildInboxInsert", async () => {
    const buildInboxInsert = vi
      .fn()
      .mockReturnValue({ sql: "INSERT INTO inbox_events", params: [] });
    const dialectWithSpy = makeDialect({ buildInboxInsert });
    const spyClient = new InboxyClient({
      adapter: makeAdapter(queryFn),
      dialect: dialectWithSpy,
      defaultHeaders: { "x-service": "test" },
      defaultMetadata: { env: "test" },
    });

    await spyClient.receive(VALID_EVENT, {});

    expect(buildInboxInsert).toHaveBeenCalledOnce();
    const [args] = buildInboxInsert.mock.calls[0] as [{ values: unknown[] }];
    // headers (index 7) and metadata (index 8) are JSON-serialized in values
    expect(args.values[7]).toBe(JSON.stringify({ "x-service": "test" }));
    expect(args.values[8]).toBe(JSON.stringify({ env: "test" }));
  });

  it("throws OutboxyConnectionError on ECONNREFUSED", async () => {
    const connError = new Error("Connection refused") as Error & {
      code: string;
    };
    connError.code = "ECONNREFUSED";
    queryFn.mockRejectedValue(connError);

    await expect(client.receive(VALID_EVENT, {})).rejects.toThrow(
      OutboxyConnectionError,
    );
    await expect(client.receive(VALID_EVENT, {})).rejects.toThrow(
      "Database connection failed while receiving event",
    );
  });

  it("re-throws non-connection errors as-is", async () => {
    const genericError = new Error("Unexpected DB error");
    queryFn.mockRejectedValue(genericError);

    await expect(client.receive(VALID_EVENT, {})).rejects.toThrow(
      "Unexpected DB error",
    );
    await expect(client.receive(VALID_EVENT, {})).rejects.not.toThrow(
      OutboxyConnectionError,
    );
  });
});

describe("InboxyClient.receive() — MySQL (supportsReturning=false)", () => {
  let queryFn: ReturnType<typeof mockQueryFn>;
  let client: InboxyClient<unknown>;

  beforeEach(() => {
    // MySQL adapter returns [{id:''}] for success, [] for duplicate
    queryFn = mockQueryFn().mockResolvedValue([{ id: "" }]);
    client = new InboxyClient(makeConfig(queryFn, MYSQL_DIALECT_OVERRIDES));
  });

  it("returns processed status with pre-generated ID when INSERT succeeds", async () => {
    const result = await client.receive(VALID_EVENT, {});

    expect(result.status).toBe("processed");
    expect(result.eventId).toBeTruthy();
    expect(typeof result.eventId).toBe("string");
  });

  it("returns duplicate status with pre-generated ID when INSERT is ignored (empty rows)", async () => {
    queryFn.mockResolvedValue([]);
    const result = await client.receive(VALID_EVENT, {});

    expect(result.status).toBe("duplicate");
    // For MySQL, eventId is the pre-generated one even on duplicate
    expect(typeof result.eventId).toBe("string");
  });

  it("throws OutboxyConnectionError on connection failure", async () => {
    const connError = new Error("ETIMEDOUT") as Error & { code: string };
    connError.code = "ETIMEDOUT";
    queryFn.mockRejectedValue(connError);

    await expect(client.receive(VALID_EVENT, {})).rejects.toThrow(
      OutboxyConnectionError,
    );
  });
});

describe("InboxyClient.receiveBatch()", () => {
  let queryFn: ReturnType<typeof mockQueryFn>;
  let client: InboxyClient<unknown>;

  const EVENTS = [
    { ...VALID_EVENT, idempotencyKey: "order-1", aggregateId: "1" },
    { ...VALID_EVENT, idempotencyKey: "order-2", aggregateId: "2" },
  ];

  beforeEach(() => {
    // receiveBatch calls bulk insert then find-by-idempotency-keys
    queryFn = mockQueryFn()
      .mockResolvedValueOnce([{ id: "id-1" }, { id: "id-2" }])
      .mockResolvedValueOnce([
        { id: "id-1", idempotency_key: "order-1" },
        { id: "id-2", idempotency_key: "order-2" },
      ]);
    client = new InboxyClient(makeConfig(queryFn));
  });

  it("returns empty array for empty input", async () => {
    const result = await client.receiveBatch([], {});

    expect(result).toEqual([]);
    expect(queryFn).not.toHaveBeenCalled();
  });

  it("returns processed results for all new events", async () => {
    const result = await client.receiveBatch(EVENTS, {});

    expect(result).toHaveLength(2);
    expect(result[0]!.status).toBe("processed");
    expect(result[1]!.status).toBe("processed");
  });

  it("returns duplicate for events already in DB", async () => {
    queryFn
      .mockReset()
      .mockResolvedValueOnce([{ id: "id-2" }])
      .mockResolvedValueOnce([
        { id: "id-1", idempotency_key: "order-1" },
        { id: "id-2", idempotency_key: "order-2" },
      ]);

    const result = await client.receiveBatch(EVENTS, {});

    expect(result[0]!.status).toBe("duplicate");
    expect(result[1]!.status).toBe("processed");
  });

  it("throws OutboxyValidationError when an event is missing idempotencyKey", async () => {
    const eventsWithMissing = [
      { ...VALID_EVENT, idempotencyKey: "order-1", aggregateId: "1" },
      { ...VALID_EVENT, idempotencyKey: "", aggregateId: "2" },
    ];

    await expect(client.receiveBatch(eventsWithMissing, {})).rejects.toThrow(
      OutboxyValidationError,
    );
    await expect(client.receiveBatch(eventsWithMissing, {})).rejects.toThrow(
      "idempotencyKey is required for event at index 1",
    );
  });

  it("throws OutboxyValidationError for duplicate idempotency keys within batch", async () => {
    const eventsWithDupKeys = [
      { ...VALID_EVENT, idempotencyKey: "same-key", aggregateId: "1" },
      { ...VALID_EVENT, idempotencyKey: "same-key", aggregateId: "2" },
    ];

    await expect(client.receiveBatch(eventsWithDupKeys, {})).rejects.toThrow(
      OutboxyValidationError,
    );
    await expect(client.receiveBatch(eventsWithDupKeys, {})).rejects.toThrow(
      "Duplicate idempotency keys within batch",
    );
  });

  it("throws OutboxyValidationError for invalid idempotency key format in batch", async () => {
    const eventsWithInvalidKey = [
      { ...VALID_EVENT, idempotencyKey: "valid-key", aggregateId: "1" },
      { ...VALID_EVENT, idempotencyKey: "invalid key!", aggregateId: "2" },
    ];

    await expect(client.receiveBatch(eventsWithInvalidKey, {})).rejects.toThrow(
      OutboxyValidationError,
    );
  });

  it("throws OutboxyConnectionError on DB error during batch insert", async () => {
    const connError = new Error("Connection failed") as Error & {
      code: string;
    };
    connError.code = "ECONNREFUSED";
    queryFn.mockReset().mockRejectedValue(connError);

    await expect(client.receiveBatch(EVENTS, {})).rejects.toThrow(
      OutboxyConnectionError,
    );
    await expect(client.receiveBatch(EVENTS, {})).rejects.toThrow(
      "Database connection failed while receiving events",
    );
  });

  it("re-throws non-connection errors during batch insert", async () => {
    const genericError = new Error("Some DB error");
    queryFn.mockReset().mockRejectedValue(genericError);

    await expect(client.receiveBatch(EVENTS, {})).rejects.toThrow(
      "Some DB error",
    );
  });

  it("chunks large batches that exceed maxParameters", async () => {
    // Each event takes 10 params; maxParameters=20 means 2 events per chunk
    const chunkQueryFn = mockQueryFn()
      .mockResolvedValueOnce([{ id: "id-1" }, { id: "id-2" }])
      .mockResolvedValueOnce([
        { id: "id-1", idempotency_key: "order-1" },
        { id: "id-2", idempotency_key: "order-2" },
      ])
      .mockResolvedValueOnce([{ id: "id-3" }])
      .mockResolvedValueOnce([{ id: "id-3", idempotency_key: "order-3" }]);

    const chunkClient = new InboxyClient({
      adapter: makeAdapter(chunkQueryFn),
      dialect: makeDialect({ maxParameters: 20 }),
    });

    const threeEvents = [
      { ...VALID_EVENT, idempotencyKey: "order-1", aggregateId: "1" },
      { ...VALID_EVENT, idempotencyKey: "order-2", aggregateId: "2" },
      { ...VALID_EVENT, idempotencyKey: "order-3", aggregateId: "3" },
    ];

    const result = await chunkClient.receiveBatch(threeEvents, {});

    expect(result).toHaveLength(3);
    // Two chunks, each with insert + find-by-keys = 4 calls total
    expect(chunkQueryFn).toHaveBeenCalledTimes(4);
  });
});

describe("InboxyClient.receiveBatch() — MySQL (supportsReturning=false)", () => {
  it("returns processed/duplicate based on pre-generated IDs matching DB IDs", async () => {
    const mysqlQueryFn = mockQueryFn()
      .mockResolvedValueOnce([{ id: "" }, { id: "" }])
      .mockResolvedValueOnce([
        { id: "existing-id-1", idempotency_key: "order-1" },
        { id: "existing-id-2", idempotency_key: "order-2" },
      ]);

    const mysqlClient = new InboxyClient({
      adapter: makeAdapter(mysqlQueryFn),
      dialect: makeDialect(MYSQL_DIALECT_OVERRIDES),
    });

    const events = [
      { ...VALID_EVENT, idempotencyKey: "order-1", aggregateId: "1" },
      { ...VALID_EVENT, idempotencyKey: "order-2", aggregateId: "2" },
    ];

    const result = await mysqlClient.receiveBatch(events, {});

    expect(result).toHaveLength(2);
    expect(result[0]!.eventId).toBe("existing-id-1");
    expect(result[1]!.eventId).toBe("existing-id-2");
  });
});

describe("InboxyClient.markFailed()", () => {
  let queryFn: ReturnType<typeof mockQueryFn>;
  let client: InboxyClient<unknown>;

  beforeEach(() => {
    queryFn = mockQueryFn().mockResolvedValue([]);
    client = new InboxyClient(makeConfig(queryFn));
  });

  it("passes eventId and error message to dialect buildMarkFailed", async () => {
    const buildMarkFailed = vi.fn().mockReturnValue({
      sql: "UPDATE inbox_events SET status = failed",
      params: [],
    });
    const dialectWithSpy = makeDialect({ buildMarkFailed });
    const spyClient = new InboxyClient({
      adapter: makeAdapter(queryFn),
      dialect: dialectWithSpy,
    });

    await spyClient.markFailed("event-id-1", "Processing failed", {});

    expect(buildMarkFailed).toHaveBeenCalledOnce();
    expect(buildMarkFailed).toHaveBeenCalledWith({
      eventId: "event-id-1",
      error: "Processing failed",
    });
  });

  it("truncates error messages longer than MAX_ERROR_MESSAGE_LENGTH before passing to dialect", async () => {
    const buildMarkFailed = vi.fn().mockReturnValue({
      sql: "UPDATE inbox_events SET status = failed",
      params: [],
    });
    const dialectWithSpy = makeDialect({ buildMarkFailed });
    const spyClient = new InboxyClient({
      adapter: makeAdapter(queryFn),
      dialect: dialectWithSpy,
    });

    const longError = "e".repeat(10000);
    await spyClient.markFailed("event-id-1", longError, {});

    expect(buildMarkFailed).toHaveBeenCalledOnce();
    const [args] = buildMarkFailed.mock.calls[0] as [
      { eventId: string; error: string },
    ];
    expect(args.error.length).toBeLessThan(10000);
    expect(args.error).toBe(longError.substring(0, args.error.length));
  });

  it("throws OutboxyConnectionError on connection failure", async () => {
    const connError = new Error("Connection reset") as Error & { code: string };
    connError.code = "ECONNRESET";
    queryFn.mockRejectedValue(connError);

    await expect(client.markFailed("event-id-1", "Failed", {})).rejects.toThrow(
      OutboxyConnectionError,
    );
    await expect(client.markFailed("event-id-1", "Failed", {})).rejects.toThrow(
      "Database connection failed while marking event as failed",
    );
  });

  it("re-throws non-connection errors as-is", async () => {
    const genericError = new Error("Unexpected error");
    queryFn.mockRejectedValue(genericError);

    await expect(client.markFailed("event-id-1", "Failed", {})).rejects.toThrow(
      "Unexpected error",
    );
  });
});

describe("createInboxClient()", () => {
  it("returns an InboxyClient instance", () => {
    const queryFn = mockQueryFn().mockResolvedValue([]);
    const config = makeConfig(queryFn);
    const client = createInboxClient(config);

    expect(client).toBeInstanceOf(InboxyClient);
  });

  it("creates a functional client with defaultHeaders and defaultMetadata", async () => {
    const queryFn = mockQueryFn().mockResolvedValue([{ id: "evt-1" }]);
    const client = createInboxClient({
      adapter: makeAdapter(queryFn),
      dialect: makeDialect(),
      defaultHeaders: { "x-source": "test" },
      defaultMetadata: { env: "test" },
    });

    const result = await client.receive(VALID_EVENT, {});

    expect(result.status).toBe("processed");
    expect(result.eventId).toBe("evt-1");
  });
});

describe("InboxyClient.receiveBatch() — PostgreSQL key not found after insert", () => {
  it("returns duplicate with null eventId when key not in DB after insert", async () => {
    const pgQueryFn = mockQueryFn()
      .mockResolvedValueOnce([{ id: "id-2" }])
      .mockResolvedValueOnce([{ id: "id-2", idempotency_key: "order-2" }]);

    const pgClient = new InboxyClient({
      adapter: makeAdapter(pgQueryFn),
      dialect: makeDialect({ supportsReturning: true }),
    });

    const events = [
      { ...VALID_EVENT, idempotencyKey: "order-1", aggregateId: "1" },
      { ...VALID_EVENT, idempotencyKey: "order-2", aggregateId: "2" },
    ];

    const result = await pgClient.receiveBatch(events, {});

    expect(result).toHaveLength(2);
    expect(result[0]!.eventId).toBeNull();
    expect(result[0]!.status).toBe("duplicate");
    expect(result[1]!.eventId).toBe("id-2");
    expect(result[1]!.status).toBe("processed");
  });
});

describe("InboxyClient.receiveBatch() — MySQL key not in DB after insert", () => {
  it("uses pre-generated ID as fallback when DB key not found", async () => {
    // When find-by-keys returns empty, MySQL path falls back to generatedIds
    const mysqlQueryFn = mockQueryFn()
      .mockResolvedValueOnce([{ id: "" }])
      .mockResolvedValueOnce([]);

    const mysqlClient = new InboxyClient({
      adapter: makeAdapter(mysqlQueryFn),
      dialect: makeDialect(MYSQL_DIALECT_OVERRIDES),
    });

    const events = [
      { ...VALID_EVENT, idempotencyKey: "order-1", aggregateId: "1" },
    ];

    const result = await mysqlClient.receiveBatch(events, {});

    expect(result).toHaveLength(1);
    expect(result[0]!.eventId).toMatch(UUID_REGEX);
    // dbId !== generatedId so marked as duplicate
    expect(result[0]!.status).toBe("duplicate");
  });
});

describe("validateInboxFields (via receive)", () => {
  it("accepts eventVersion of exactly 1", async () => {
    const queryFn = mockQueryFn().mockResolvedValue([{ id: "evt-1" }]);
    const client = new InboxyClient(makeConfig(queryFn));
    const event = { ...VALID_EVENT, eventVersion: 1 };

    const result = await client.receive(event, {});

    expect(result.status).toBe("processed");
  });

  it("accepts eventVersion of 100", async () => {
    const queryFn = mockQueryFn().mockResolvedValue([{ id: "evt-1" }]);
    const client = new InboxyClient(makeConfig(queryFn));
    const event = { ...VALID_EVENT, eventVersion: 100 };

    const result = await client.receive(event, {});

    expect(result.status).toBe("processed");
  });

  it("throws for negative eventVersion", async () => {
    const queryFn = mockQueryFn().mockResolvedValue([]);
    const client = new InboxyClient(makeConfig(queryFn));
    const event = { ...VALID_EVENT, eventVersion: -1 };

    await expect(client.receive(event, {})).rejects.toThrow(
      OutboxyValidationError,
    );
  });

  it("skips eventVersion validation when undefined", async () => {
    const queryFn = mockQueryFn().mockResolvedValue([{ id: "evt-1" }]);
    const client = new InboxyClient(makeConfig(queryFn));
    const { eventVersion: _ignored, ...eventWithoutVersion } = {
      ...VALID_EVENT,
      eventVersion: undefined,
    };

    const result = await client.receive(
      eventWithoutVersion as typeof VALID_EVENT,
      {},
    );

    expect(result.status).toBe("processed");
  });
});
