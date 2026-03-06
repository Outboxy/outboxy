import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Pool } from "pg";

describe("shutdownPool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should resolve when pool ends successfully", async () => {
    const { shutdownPool } = await import("../connection/pg-pool.js");
    const mockPool = {
      end: vi.fn().mockResolvedValue(undefined),
    } as unknown as Pool;

    await expect(shutdownPool(mockPool)).resolves.toBeUndefined();
    expect(mockPool.end).toHaveBeenCalledOnce();
  });

  it("should reject when pool.end() fails", async () => {
    const { shutdownPool } = await import("../connection/pg-pool.js");
    const mockPool = {
      end: vi.fn().mockRejectedValue(new Error("end error")),
    } as unknown as Pool;

    await expect(shutdownPool(mockPool)).rejects.toThrow("end error");
  });

  it("should reject with timeout error when shutdown exceeds timeoutMs", async () => {
    const { shutdownPool } = await import("../connection/pg-pool.js");

    const mockPool = {
      // Promise that never resolves (simulate hung shutdown)
      end: vi.fn().mockReturnValue(
        new Promise<void>((resolve) => {
          // Store resolve so we can call it after the test to avoid unhandled rejection
          setTimeout(resolve, 999999);
        }),
      ),
    } as unknown as Pool;

    // Use .catch() to avoid unhandled rejection warning
    let caughtError: Error | null = null;
    const promise = shutdownPool(mockPool, 100).catch((e: Error) => {
      caughtError = e;
    });

    await vi.advanceTimersByTimeAsync(200);
    await promise;

    expect(caughtError).toBeInstanceOf(Error);
    expect(caughtError!.message).toBe("Pool shutdown timeout after 100ms");
  });

  it("should use default timeout of 10000ms", async () => {
    const { shutdownPool } = await import("../connection/pg-pool.js");

    const mockPool = {
      end: vi.fn().mockReturnValue(
        new Promise<void>((resolve) => {
          setTimeout(resolve, 999999);
        }),
      ),
    } as unknown as Pool;

    let caughtError: Error | null = null;
    const promise = shutdownPool(mockPool).catch((e: Error) => {
      caughtError = e;
    });

    await vi.advanceTimersByTimeAsync(15000);
    await promise;

    expect(caughtError).toBeInstanceOf(Error);
    expect(caughtError!.message).toBe("Pool shutdown timeout after 10000ms");
  });

  it("should clear timeout when pool ends successfully before timeout fires", async () => {
    const { shutdownPool } = await import("../connection/pg-pool.js");

    const mockPool = {
      end: vi.fn().mockResolvedValue(undefined),
    } as unknown as Pool;

    const promise = shutdownPool(mockPool, 5000);
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBeUndefined();
  });
});
