import {
  propagation,
  context,
  trace,
  SpanStatusCode,
  type Context,
} from "@opentelemetry/api";
import type {
  Publisher,
  PublishResult,
  OutboxEvent,
} from "@outboxy/publisher-core";

const tracer = trace.getTracer("outboxy-worker");

const TRACE_HEADERS = new Set(["traceparent", "tracestate"]);

/**
 * Wrap a Publisher with OTel tracing.
 *
 * Restores the trace context stored in event headers (by the SDK's
 * `propagation.inject()`) and creates an `outbox.deliver` span that
 * bridges the async gap between producer and consumer.
 */
export function wrapPublisher(publisher: Publisher): Publisher {
  return {
    initialize: publisher.initialize?.bind(publisher),
    shutdown: publisher.shutdown?.bind(publisher),

    async publish(events: OutboxEvent[]): Promise<Map<string, PublishResult>> {
      if (events.length === 0) return publisher.publish(events);

      const parentContext = extractStoredContext(events[0]!);

      // Strip trace context headers so HttpPublisher doesn't forward them —
      // UndiciInstrumentation injects the correct (fresh) traceparent from
      // the active span context. Forwarding the original creates duplicate
      // headers that produce invalid W3C TraceContext values.
      const cleanedEvents = stripTraceHeaders(events);

      const eventTypes = [...new Set(events.map((e) => e.eventType))].join(",");

      return tracer.startActiveSpan(
        `outbox.deliver ${eventTypes}`,
        {
          attributes: {
            "outbox.batch_size": events.length,
            "outbox.destination_url": events[0]!.destinationUrl,
            "outbox.event_types": eventTypes,
          },
        },
        parentContext,
        async (span) => {
          try {
            return await publisher.publish(cleanedEvents);
          } catch (err) {
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: String(err),
            });
            throw err;
          } finally {
            span.end();
          }
        },
      );
    },
  };
}

function stripTraceHeaders(events: OutboxEvent[]): OutboxEvent[] {
  return events.map((event) => {
    const headers = event.headers;
    if (!headers || typeof headers !== "object" || Array.isArray(headers)) {
      return event;
    }
    const entries = Object.entries(headers as Record<string, unknown>);
    const hasTraceHeaders = entries.some(([k]) =>
      TRACE_HEADERS.has(k.toLowerCase()),
    );
    if (!hasTraceHeaders) return event;

    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of entries) {
      if (!TRACE_HEADERS.has(key.toLowerCase())) {
        cleaned[key] = value;
      }
    }
    return { ...event, headers: cleaned };
  });
}

function extractStoredContext(event: OutboxEvent): Context {
  const headers = event.headers;
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) {
    return context.active();
  }
  return propagation.extract(
    context.active(),
    headers as Record<string, unknown>,
  );
}
