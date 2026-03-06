import { vi } from "vitest";
import type { Pool } from "mysql2/promise";
import type { Logger } from "../config.js";

export function makePool(...results: unknown[]): Pool {
  const queryFn = vi.fn();
  results.forEach((r) => queryFn.mockResolvedValueOnce(r));
  return {
    execute: queryFn,
    query: queryFn,
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
