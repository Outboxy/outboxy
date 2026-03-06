import { Writable } from "node:stream";

export interface LogEntry {
  level: number;
  time: string;
  service?: string;
  version?: string;
  msg?: string;
  err?: {
    type: string;
    message: string;
    stack?: string;
  };
  [key: string]: unknown;
}

/**
 * Test utility for capturing Pino log output
 *
 * Provides a Writable stream that captures JSON log entries
 * for verification in tests.
 *
 * @example
 * const capture = new LogCapture();
 * const logger = createLogger({ service: "test", prettyPrint: false }, capture.stream);
 *
 * logger.info({ requestId: "123" }, "Hello");
 *
 * expect(capture.getLastLog()).toMatchObject({
 *   service: "test",
 *   requestId: "123",
 *   msg: "Hello",
 * });
 */
export class LogCapture {
  private logs: LogEntry[] = [];

  readonly stream = new Writable({
    write: (chunk, _encoding, callback) => {
      const line = chunk.toString().trim();
      if (line) {
        this.logs.push(JSON.parse(line));
      }
      callback();
    },
  });

  getLogs(): LogEntry[] {
    return this.logs;
  }

  getLastLog(): LogEntry | undefined {
    return this.logs[this.logs.length - 1];
  }

  clear(): void {
    this.logs = [];
  }
}
