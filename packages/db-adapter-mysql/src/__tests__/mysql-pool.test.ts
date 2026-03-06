import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ConnectionError } from "../errors.js";

vi.mock("mysql2/promise", () => {
  const mockConnection = {
    ping: vi.fn().mockResolvedValue(undefined),
    release: vi.fn(),
    query: vi.fn(),
  };

  const mockPool = {
    getConnection: vi.fn().mockResolvedValue(mockConnection),
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    _mockConnection: mockConnection,
  };

  const mysql = {
    createPool: vi.fn().mockReturnValue(mockPool),
    _mockPool: mockPool,
    _mockConnection: mockConnection,
  };

  return { default: mysql };
});

const testLogger = {
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe("parseConnectionString (via createPool)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should throw ConnectionError for invalid connection string format", async () => {
    const { createPool } = await import("../connection/mysql-pool.js");

    await expect(
      createPool({ connectionString: "not-a-valid-url" }, testLogger),
    ).rejects.toBeInstanceOf(ConnectionError);
  });

  it("should throw ConnectionError when host is missing", async () => {
    const { createPool } = await import("../connection/mysql-pool.js");

    await expect(
      createPool({ connectionString: "mysql:///dbname" }, testLogger),
    ).rejects.toBeInstanceOf(ConnectionError);
  });

  it("should throw ConnectionError when database name is missing", async () => {
    const { createPool } = await import("../connection/mysql-pool.js");

    await expect(
      createPool({ connectionString: "mysql://localhost/" }, testLogger),
    ).rejects.toBeInstanceOf(ConnectionError);
  });
});

describe("createPool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should create pool successfully with valid connection string", async () => {
    const mysql = await import("mysql2/promise");
    const { createPool } = await import("../connection/mysql-pool.js");

    const pool = await createPool(
      { connectionString: "mysql://user:pass@localhost:3306/mydb" },
      testLogger,
    );

    expect(pool).toBeDefined();
    expect(mysql.default.createPool).toHaveBeenCalled();
  });

  it("should register lifecycle event handlers", async () => {
    const mysql = await import("mysql2/promise");
    const { createPool } = await import("../connection/mysql-pool.js");

    await createPool(
      { connectionString: "mysql://user:pass@localhost:3306/mydb" },
      testLogger,
    );

    const poolInstance = (mysql.default.createPool as ReturnType<typeof vi.fn>)
      .mock.results[0]?.value;
    const eventNames = (
      poolInstance.on as ReturnType<typeof vi.fn>
    ).mock.calls.map((c: unknown[]) => c[0]);
    expect(eventNames).toContain("acquire");
    expect(eventNames).toContain("release");
    expect(eventNames).toContain("enqueue");
    expect(eventNames).toContain("connection");
  });

  it("should use config values for pool options", async () => {
    const mysql = await import("mysql2/promise");
    const { createPool } = await import("../connection/mysql-pool.js");

    await createPool(
      {
        connectionString: "mysql://user:pass@localhost:3306/mydb",
        maxConnections: 5,
        connectionTimeoutMs: 3000,
      },
      testLogger,
    );

    expect(mysql.default.createPool).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionLimit: 5,
        connectTimeout: 3000,
      }),
    );
  });

  it("should use default port 3306 when not specified", async () => {
    const mysql = await import("mysql2/promise");
    const { createPool } = await import("../connection/mysql-pool.js");

    await createPool(
      { connectionString: "mysql://user:pass@localhost/mydb" },
      testLogger,
    );

    expect(mysql.default.createPool).toHaveBeenCalledWith(
      expect.objectContaining({
        port: 3306,
      }),
    );
  });

  it("should decode URL-encoded credentials", async () => {
    const mysql = await import("mysql2/promise");
    const { createPool } = await import("../connection/mysql-pool.js");

    await createPool(
      {
        connectionString: "mysql://my%40user:p%40ss%21word@localhost:3306/mydb",
      },
      testLogger,
    );

    expect(mysql.default.createPool).toHaveBeenCalledWith(
      expect.objectContaining({
        user: "my@user",
        password: "p@ss!word",
      }),
    );
  });

  it("should throw ConnectionError when all retries fail", async () => {
    const mysql = await import("mysql2/promise");
    const { createPool } = await import("../connection/mysql-pool.js");

    const failingPool = {
      getConnection: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
      end: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
    };

    (mysql.default.createPool as ReturnType<typeof vi.fn>).mockReturnValue(
      failingPool,
    );

    // maxRetries: 0 means only 1 attempt (loop runs maxRetries+1 = 1 time),
    // so no retry delay and no unhandled secondary rejection
    let caughtError: unknown;
    try {
      await createPool(
        {
          connectionString: "mysql://user:pass@localhost:3306/mydb",
          maxRetries: 0,
          retryDelayMs: 10,
        },
        testLogger,
      );
    } catch (e) {
      caughtError = e;
    }

    expect(caughtError).toBeInstanceOf(ConnectionError);
    expect((caughtError as ConnectionError).message).toContain(
      "Failed to connect to MySQL",
    );
  });

  it("should log warnings on retry attempts", async () => {
    const mysql = await import("mysql2/promise");
    const { createPool } = await import("../connection/mysql-pool.js");

    const failingPool = {
      getConnection: vi
        .fn()
        .mockRejectedValueOnce(new Error("first fail"))
        .mockResolvedValueOnce({
          ping: vi.fn().mockResolvedValue(undefined),
          release: vi.fn(),
        }),
      end: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
    };

    (mysql.default.createPool as ReturnType<typeof vi.fn>).mockReturnValue(
      failingPool,
    );

    const promise = createPool(
      {
        connectionString: "mysql://user:pass@localhost:3306/mydb",
        maxRetries: 2,
        retryDelayMs: 10,
      },
      testLogger,
    );

    await vi.runAllTimersAsync();
    await promise;

    expect(testLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ attempt: 1, error: "first fail" }),
      "Failed to create MySQL connection pool",
    );
  });
});

describe("shutdownPool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should resolve when pool ends successfully", async () => {
    const { shutdownPool } = await import("../connection/mysql-pool.js");
    const mockPool = {
      end: vi.fn().mockResolvedValue(undefined),
    } as unknown as Awaited<
      ReturnType<typeof import("../connection/mysql-pool.js").createPool>
    >;

    await expect(shutdownPool(mockPool)).resolves.toBeUndefined();
    expect(mockPool.end).toHaveBeenCalledOnce();
  });

  it("should reject when pool.end() fails", async () => {
    const { shutdownPool } = await import("../connection/mysql-pool.js");
    const mockPool = {
      end: vi.fn().mockRejectedValue(new Error("end error")),
    } as unknown as Awaited<
      ReturnType<typeof import("../connection/mysql-pool.js").createPool>
    >;

    await expect(shutdownPool(mockPool)).rejects.toThrow("end error");
  });

  it("should reject with timeout error when shutdown exceeds timeoutMs", async () => {
    const { shutdownPool } = await import("../connection/mysql-pool.js");
    const mockPool = {
      end: vi
        .fn()
        .mockImplementation(
          () => new Promise<void>((resolve) => setTimeout(resolve, 999999)),
        ),
    } as unknown as Awaited<
      ReturnType<typeof import("../connection/mysql-pool.js").createPool>
    >;

    let caughtError: Error | null = null;
    const promise = shutdownPool(mockPool, 100).catch((e: Error) => {
      caughtError = e;
    });

    await vi.advanceTimersByTimeAsync(200);
    await promise;

    expect(caughtError).toBeInstanceOf(Error);
    expect(caughtError!.message).toBe("Pool shutdown timed out after 100ms");
  });
});
