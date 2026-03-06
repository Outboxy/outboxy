/**
 * Mock webhook server for integration testing
 *
 * Provides a configurable HTTP server that records incoming requests
 * and can simulate latency, failures, and custom status codes.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "http";
import type { Server } from "http";
import type { AddressInfo } from "net";

/**
 * Recorded request from the mock server
 */
export interface MockWebhookRequest<T = unknown> {
  headers: Record<string, string | string[] | undefined>;
  body: T;
  timestamp: number;
  method: string;
  url: string;
}

/**
 * Mock webhook server instance
 */
export interface MockWebhookServer {
  /** Server URL (e.g., http://127.0.0.1:3000) */
  url: string;

  /** Recorded requests */
  requests: MockWebhookRequest[];

  /** Set simulated response latency in milliseconds */
  setLatency(ms: number): void;

  /** Set response status code (default: 200) */
  setStatusCode(code: number): void;

  /** Set failure rate (0-1, where 0 = never fail, 1 = always fail) */
  setFailureRate(rate: number): void;

  /** Clear recorded requests */
  clearRequests(): void;

  /** Get total event count from batch requests */
  getTotalEventCount(): number;

  /** Close the server */
  close(): Promise<void>;
}

export interface CreateMockWebhookServerOptions {
  /** Initial latency in milliseconds (default: 10) */
  latencyMs?: number;
  /** Initial status code (default: 200) */
  statusCode?: number;
  /** Initial failure rate (default: 0) */
  failureRate?: number;
}

/**
 * Creates a mock webhook server for testing event delivery
 *
 * @example
 * ```typescript
 * const server = await createMockWebhookServer();
 *
 * // Use server.url as the destination for events
 * await insertEvent({ destinationUrl: server.url });
 *
 * // Check recorded requests
 * expect(server.requests).toHaveLength(1);
 *
 * // Simulate slow responses
 * server.setLatency(100);
 *
 * // Simulate failures
 * server.setFailureRate(0.5); // 50% failure rate
 *
 * // Cleanup
 * await server.close();
 * ```
 */
export async function createMockWebhookServer(
  options: CreateMockWebhookServerOptions = {},
): Promise<MockWebhookServer> {
  const {
    latencyMs: initialLatency = 10,
    statusCode: initialStatusCode = 200,
    failureRate: initialFailureRate = 0,
  } = options;

  let latencyMs = initialLatency;
  let statusCode = initialStatusCode;
  let failureRate = initialFailureRate;

  const requests: MockWebhookRequest[] = [];

  const server: Server = createServer(
    (req: IncomingMessage, res: ServerResponse) => {
      const chunks: Buffer[] = [];

      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const bodyText = Buffer.concat(chunks).toString();
        let body: unknown;

        try {
          body = JSON.parse(bodyText);
        } catch {
          body = bodyText;
        }

        requests.push({
          headers: req.headers,
          body,
          timestamp: Date.now(),
          method: req.method || "POST",
          url: req.url || "/",
        });

        setTimeout(() => {
          const shouldFail = Math.random() < failureRate;

          if (shouldFail) {
            res.writeHead(statusCode >= 400 ? statusCode : 500);
            res.end("Simulated failure");
          } else {
            res.writeHead(200);
            res.end("OK");
          }
        }, latencyMs);
      });
    },
  );

  const url = await new Promise<string>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${addr.port}`);
    });
  });

  return {
    url,
    requests,

    setLatency(ms: number): void {
      latencyMs = ms;
    },

    setStatusCode(code: number): void {
      statusCode = code;
    },

    setFailureRate(rate: number): void {
      failureRate = Math.max(0, Math.min(1, rate));
    },

    clearRequests(): void {
      requests.length = 0;
    },

    getTotalEventCount(): number {
      return requests.reduce((sum, req) => {
        const body = req.body as { count?: number };
        return sum + (body?.count || 1);
      }, 0);
    },

    close(): Promise<void> {
      return new Promise((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
  };
}
