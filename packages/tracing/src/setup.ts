/**
 * OTel SDK initialization (side-effect import)
 *
 * Import via `@outboxy/tracing/setup` or `OUTBOXY_PRELOAD=@outboxy/tracing/setup`.
 * Guarded by OTEL_EXPORTER_OTLP_ENDPOINT — no overhead when disabled.
 *
 * Must be loaded before application code so auto-instrumentations
 * can monkey-patch http/pg/undici modules.
 */

import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

if (endpoint) {
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? "outboxy",
    }),
    traceExporter: new OTLPTraceExporter({
      url: `${endpoint}/v1/traces`,
    }),
    instrumentations: [
      new HttpInstrumentation(),
      new UndiciInstrumentation(),
      new PgInstrumentation(),
    ],
  });

  sdk.start();

  const shutdown = () => {
    sdk.shutdown().catch(() => {
      // Best-effort span flush; application controls process lifecycle
    });
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
