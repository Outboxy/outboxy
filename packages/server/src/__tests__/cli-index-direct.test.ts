/**
 * Tests that directly import cli/index.ts to get coverage on the side-effect
 * module execution (the top-level main() call).
 *
 * Each test needs vi.resetModules() + fresh process.argv to re-run the
 * module-level code.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useSignalListenerCleanup, mockProcessExit } from "./helpers.js";

const mockApiMain = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockWorkerMain = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockRunMigrations = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined),
);

vi.mock("../cli/api.js", () => ({
  apiMain: mockApiMain,
}));

vi.mock("../cli/worker.js", () => ({
  workerMain: mockWorkerMain,
}));

vi.mock("@outboxy/migrations", () => ({
  runMigrations: mockRunMigrations,
}));

const SAVED_ENV_KEYS = ["DATABASE_URL", "OUTBOXY_PRELOAD"] as const;

describe("cli/index - direct module execution", () => {
  useSignalListenerCleanup();

  const originalArgv = process.argv.slice();
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.argv = [...originalArgv];
    savedEnv = Object.fromEntries(
      SAVED_ENV_KEYS.map((k) => [k, process.env[k]]),
    );
  });

  afterEach(() => {
    process.argv = originalArgv;
    for (const key of SAVED_ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  it("should dispatch 'api' command when process.argv[2] is 'api'", async () => {
    process.argv[2] = "api";

    await import("../cli/index.js");
    await vi.waitFor(() => {
      expect(mockApiMain).toHaveBeenCalled();
    });
  });

  it("should dispatch 'worker' command when process.argv[2] is 'worker'", async () => {
    process.argv[2] = "worker";

    await import("../cli/index.js");
    await vi.waitFor(() => {
      expect(mockWorkerMain).toHaveBeenCalled();
    });
  });

  it("should dispatch 'migrate' command when process.argv[2] is 'migrate'", async () => {
    process.argv[2] = "migrate";
    process.env.DATABASE_URL = "postgresql://localhost:5432/testdb";

    await import("../cli/index.js");
    await vi.waitFor(() => {
      expect(mockRunMigrations).toHaveBeenCalledWith(
        "postgresql://localhost:5432/testdb",
      );
    });
  });

  it("should exit with code 1 when 'migrate' is called without DATABASE_URL", async () => {
    process.argv[2] = "migrate";
    delete process.env.DATABASE_URL;

    const exitSpy = mockProcessExit();

    await import("../cli/index.js");
    await vi.waitFor(() => {
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  it("should exit with code 1 for unknown command", async () => {
    process.argv[2] = "unknown-xyz";

    const exitSpy = mockProcessExit();

    await import("../cli/index.js");
    await vi.waitFor(() => {
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  it("should exit with code 0 for 'help' command", async () => {
    process.argv[2] = "help";

    const exitSpy = mockProcessExit();

    await import("../cli/index.js");
    await vi.waitFor(() => {
      expect(exitSpy).toHaveBeenCalledWith(0);
    });
  });

  it("should exit with code 0 for '--help' flag", async () => {
    process.argv[2] = "--help";

    const exitSpy = mockProcessExit();

    await import("../cli/index.js");
    await vi.waitFor(() => {
      expect(exitSpy).toHaveBeenCalledWith(0);
    });
  });

  it("should default to 'help' when no command is provided", async () => {
    process.argv.splice(2);

    const exitSpy = mockProcessExit();

    await import("../cli/index.js");
    await vi.waitFor(() => {
      expect(exitSpy).toHaveBeenCalledWith(0);
    });
  });

  it("should load preload modules before dispatching when OUTBOXY_PRELOAD is set", async () => {
    process.argv[2] = "api";
    process.env.OUTBOXY_PRELOAD = "nonexistent-preload-module-xyz";

    await import("../cli/index.js");
    await vi.waitFor(() => {
      expect(mockApiMain).toHaveBeenCalled();
    });
  });

  it("should catch and log fatal error when main() throws", async () => {
    process.argv[2] = "api";
    mockApiMain.mockRejectedValueOnce(new Error("startup failure"));

    const exitSpy = mockProcessExit();
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await import("../cli/index.js");
    await vi.waitFor(() => {
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
    consoleErrorSpy.mockRestore();
  });
});
