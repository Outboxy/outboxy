import { EventEmitter } from "node:events";
import { afterEach, beforeEach, vi } from "vitest";

const SIGNAL_EVENTS: readonly string[] = [
  "SIGTERM",
  "SIGINT",
  "unhandledRejection",
  "uncaughtException",
];

// Use EventEmitter interface to avoid process overload issues with non-signal events
const processEmitter = process as unknown as EventEmitter;

/**
 * Tracks process signal listeners added during a test and removes them in afterEach.
 * Prevents listener leaks across tests that register SIGTERM/SIGINT/etc handlers.
 */
export function useSignalListenerCleanup(): void {
  let snapshots: Record<string, Set<Function>>;

  beforeEach(() => {
    snapshots = Object.fromEntries(
      SIGNAL_EVENTS.map((e) => [e, new Set(processEmitter.listeners(e))]),
    );
  });

  afterEach(() => {
    for (const event of SIGNAL_EVENTS) {
      const before = snapshots[event]!;
      for (const listener of processEmitter.listeners(event)) {
        if (!before.has(listener as Function)) {
          processEmitter.removeListener(
            event,
            listener as (...args: unknown[]) => void,
          );
        }
      }
    }
  });
}

export function mockProcessExit(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
}

export function createMockLogger(): Record<string, unknown> {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: vi.fn().mockReturnThis(),
    level: "info",
    silent: vi.fn(),
  };
}

export function findSignalHandler<T extends Function>(
  onSpy: ReturnType<typeof vi.spyOn>,
  signal: string,
): T {
  const call = onSpy.mock.calls.find((c: unknown[]) => c[0] === signal);
  const handler = call?.[1] as T | undefined;
  if (!handler) {
    throw new Error(`No handler registered for ${signal}`);
  }
  return handler;
}
