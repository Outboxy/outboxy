import {
  createServer,
  type Server,
  type IncomingMessage,
  type ServerResponse,
} from "http";
import type { Registry } from "prom-client";
import { type Logger } from "@outboxy/logging";
import { getGlobalRegistry } from "./registry.js";

/**
 * Metrics HTTP server configuration
 */
export interface MetricsServerConfig {
  /** HTTP server port */
  port: number;
  /** Bind address (default: "0.0.0.0") */
  host?: string;
  /** Metrics endpoint path (default: "/metrics") */
  path?: string;
}

/**
 * Metrics HTTP server interface
 */
export interface MetricsServer {
  /** Start the HTTP server */
  start(): Promise<void>;
  /** Stop the HTTP server */
  stop(): Promise<void>;
  /** Get the bound port (actual port after server starts) */
  getPort(): number;
}

/**
 * Create a minimal HTTP server for Prometheus metrics
 *
 * Exposes:
 * - GET /metrics - Prometheus text format
 * - GET /health - JSON health check
 *
 * @param config - Server configuration
 * @param logger - Logger instance
 * @param registry - prom-client Registry (defaults to global)
 */
export function createMetricsServer(
  config: MetricsServerConfig,
  logger: Logger,
  registry?: Registry,
): MetricsServer {
  const reg = registry ?? getGlobalRegistry();
  const host = config.host ?? "0.0.0.0";
  const path = config.path ?? "/metrics";

  let server: Server | null = null;
  let actualPort: number | null = null;

  const handler = async (
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> => {
    const url = req.url ?? "";

    if (url === path && req.method === "GET") {
      try {
        const metrics = await reg.metrics();
        res.setHeader("Content-Type", reg.contentType);
        res.statusCode = 200;
        res.end(metrics);
      } catch (error) {
        logger.error({ err: error }, "Failed to collect metrics");
        res.statusCode = 500;
        res.end("Internal Server Error");
      }
    } else if (url === "/health" && req.method === "GET") {
      res.setHeader("Content-Type", "application/json");
      res.statusCode = 200;
      res.end(JSON.stringify({ status: "ok" }));
    } else {
      res.statusCode = 404;
      res.end("Not Found");
    }
  };

  return {
    async start(): Promise<void> {
      return new Promise((resolve, reject) => {
        server = createServer((req, res) => {
          handler(req, res).catch((error) => {
            logger.error({ err: error }, "Request handler error");
            res.statusCode = 500;
            res.end("Internal Server Error");
          });
        });

        server.on("error", (error) => {
          logger.error({ err: error }, "Metrics server error");
          reject(error);
        });

        server.listen(config.port, host, () => {
          const addr = server!.address();
          if (addr && typeof addr !== "string") {
            actualPort = addr.port;
          }
          logger.info(
            { port: actualPort ?? config.port, host, path },
            "Metrics server started",
          );
          resolve();
        });
      });
    },

    async stop(): Promise<void> {
      return new Promise((resolve) => {
        if (server) {
          server.close(() => {
            logger.info("Metrics server stopped");
            resolve();
          });
        } else {
          resolve();
        }
      });
    },

    getPort(): number {
      return actualPort ?? config.port;
    },
  };
}
