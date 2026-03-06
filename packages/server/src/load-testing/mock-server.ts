/**
 * Mock webhook server for load testing
 *
 * Provides a minimal-latency HTTP server that accepts event deliveries.
 * Latency is measured from DB timestamps, not the mock server.
 */

import { createServer, type Server } from "http";
import type { AddressInfo } from "net";

export interface MockServerConfig {
  responseDelayMs?: number;
  failureRate?: number;
}

export interface MockServer {
  url: string;
  server: Server;
  receivedCount: number;
  close: () => Promise<void>;
  reset: () => void;
}

/**
 * Create a mock webhook server for load testing
 *
 * Accepts event deliveries with minimal latency (~1-2ms).
 * Does not track latency — use DB-based latency calculation instead.
 */
export async function createMockServer(
  config: MockServerConfig = {},
): Promise<MockServer> {
  const { responseDelayMs = 0, failureRate = 0 } = config;
  let receivedCount = 0;

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];

    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      receivedCount++;

      const shouldFail = failureRate > 0 && Math.random() < failureRate;

      const sendResponse = () => {
        if (shouldFail) {
          res.writeHead(500);
          res.end("Internal Server Error");
        } else {
          res.writeHead(200);
          res.end("OK");
        }
      };

      if (responseDelayMs > 0) {
        setTimeout(sendResponse, responseDelayMs);
      } else {
        sendResponse();
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      const url = `http://127.0.0.1:${addr.port}`;

      const mockServer: MockServer = {
        url,
        server,
        get receivedCount() {
          return receivedCount;
        },
        close: () =>
          new Promise<void>((resolveClose) => {
            server.close(() => resolveClose());
          }),
        reset: () => {
          receivedCount = 0;
        },
      };

      resolve(mockServer);
    });

    server.on("error", reject);
  });
}
