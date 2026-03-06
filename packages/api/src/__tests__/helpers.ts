import { vi } from "vitest";
import type { DatabaseAdapter } from "@outboxy/db-adapter-core";

export function createMockAdapter(): DatabaseAdapter {
  return {
    checkHealth: vi.fn().mockResolvedValue({
      healthy: true,
      totalConnections: 1,
      idleConnections: 1,
      waitingClients: 0,
    }),
    eventService: {
      getEventById: vi.fn(),
      replayEvent: vi.fn(),
      replayEventsInRange: vi.fn(),
    },
    shutdown: vi.fn(),
  } as unknown as DatabaseAdapter;
}
