import { vi } from "vitest";
import type { Pool } from "pg";
import type { Logger } from "../config.js";

export function makePool(queryResult: object): Pool {
  return {
    query: vi.fn().mockResolvedValue(queryResult),
  } as unknown as Pool;
}

export const noopLogger: Logger = {
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

export function makeLogger(): Logger {
  return {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}
