import { request } from "undici";
import type { Logger } from "@outboxy/logging";
import type {
  Publisher,
  PublishResult,
  OutboxEvent,
} from "@outboxy/publisher-core";
import type { HttpPublisherConfig } from "./config.js";
import { httpPublisherConfigSchema } from "./config.js";

/**
 * HTTP Publisher with batch payload support
 *
 * Groups events by destination URL and sends a single HTTP request with all
 * events for that destination. This reduces HTTP requests from N (events)
 * to M (unique destinations).
 *
 * Batch payload format:
 * ```json
 * {
 *   "batch": true,
 *   "count": 5,
 *   "events": [
 *     {"eventId": "...", "eventType": "...", "aggregateType": "...", ...},
 *     {"eventId": "...", "eventType": "...", "aggregateType": "...", ...}
 *   ]
 * }
 * ```
 */
export class HttpPublisher implements Publisher {
  private static readonly BLOCKED_HEADERS = new Set([
    // Transport/framing headers (managed by undici)
    "host",
    "content-length",
    "content-type",
    "transfer-encoding",
    "connection",
    "user-agent",
    // Credential headers (prevent leaking to webhook endpoints)
    "authorization",
    "cookie",
    "proxy-authorization",
    // Proxy/forwarding headers (prevent IP spoofing)
    "x-forwarded-for",
    "x-forwarded-host",
    "x-forwarded-proto",
    "x-real-ip",
  ]);

  private readonly config: HttpPublisherConfig;

  constructor(
    config: Partial<HttpPublisherConfig> = {},
    private readonly logger?: Logger,
  ) {
    this.config = httpPublisherConfigSchema.parse(config);
  }

  async initialize(): Promise<void> {
    this.logger?.debug("HTTP publisher ready");
  }

  async shutdown(): Promise<void> {
    this.logger?.debug("HTTP publisher shutdown");
  }

  /**
   * Publish events to destinations
   *
   * Groups events by destination URL and sends ONE HTTP request per destination.
   */
  async publish(events: OutboxEvent[]): Promise<Map<string, PublishResult>> {
    const eventsByDestination = this.groupByDestination(events);

    this.logger?.debug(
      {
        totalEvents: events.length,
        uniqueDestinations: eventsByDestination.size,
      },
      "Publishing events as batches",
    );

    const results = new Map<string, PublishResult>();

    const batchPromises = Array.from(eventsByDestination.entries()).map(
      async ([destinationUrl, destEvents]) => {
        const batchResults = await this.publishToDestination(
          destinationUrl,
          destEvents,
        );

        for (const [eventId, result] of batchResults) {
          results.set(eventId, result);
        }
      },
    );

    await Promise.all(batchPromises);
    return results;
  }

  private groupByDestination(
    events: OutboxEvent[],
  ): Map<string, OutboxEvent[]> {
    const groups = new Map<string, OutboxEvent[]>();

    for (const event of events) {
      const existing = groups.get(event.destinationUrl) ?? [];
      existing.push(event);
      groups.set(event.destinationUrl, existing);
    }

    return groups;
  }

  private buildUniformResults(
    eventIds: string[],
    result: PublishResult,
  ): Map<string, PublishResult> {
    const results = new Map<string, PublishResult>();
    for (const eventId of eventIds) {
      results.set(eventId, result);
    }
    return results;
  }

  private async publishToDestination(
    destinationUrl: string,
    events: OutboxEvent[],
  ): Promise<Map<string, PublishResult>> {
    const eventIds = events.map((e) => e.id);
    const startTime = Date.now();

    try {
      const batchPayload = {
        batch: true,
        count: events.length,
        events: events.map((event) => ({
          eventId: event.id,
          eventType: event.eventType,
          aggregateType: event.aggregateType,
          aggregateId: event.aggregateId,
          payload: event.payload,
          createdAt: event.createdAt,
        })),
      };

      const eventHeaders = this.extractForwardableHeaders(events[0]?.headers);

      const { statusCode, body } = await request(destinationUrl, {
        method: "POST",
        headers: {
          ...eventHeaders,
          "Content-Type": "application/json",
          "User-Agent": this.config.userAgent,
          "X-Outbox-Batch": "true",
          "X-Outbox-Batch-Size": String(events.length),
          "X-Outbox-Event-IDs": eventIds.join(","),
        },
        body: JSON.stringify(batchPayload),
        bodyTimeout: this.config.timeoutMs,
        headersTimeout: this.config.timeoutMs,
      });

      const responseBody = await body.text();
      const durationMs = Date.now() - startTime;

      if (statusCode >= 200 && statusCode < 300) {
        const individualResults = this.parseIndividualResults(
          responseBody,
          eventIds,
          durationMs,
        );

        if (individualResults) {
          return individualResults;
        }

        this.logger?.debug(
          { destinationUrl, eventCount: events.length, statusCode },
          "Batch publish succeeded",
        );

        return this.buildUniformResults(eventIds, {
          success: true,
          retryable: false,
          durationMs,
        });
      }

      const retryable = statusCode >= 500 || [408, 429].includes(statusCode);

      this.logger?.warn(
        { destinationUrl, eventCount: events.length, statusCode, retryable },
        "Batch publish failed",
      );

      return this.buildUniformResults(eventIds, {
        success: false,
        error: new Error(`HTTP ${statusCode}`),
        retryable,
        durationMs,
      });
    } catch (error) {
      const durationMs = Date.now() - startTime;

      this.logger?.error(
        { err: error, destinationUrl, eventCount: events.length },
        "Batch publish failed with network error",
      );

      return this.buildUniformResults(eventIds, {
        success: false,
        error: error as Error,
        retryable: true,
        durationMs,
      });
    }
  }

  private extractForwardableHeaders(headers: unknown): Record<string, string> {
    if (!headers || typeof headers !== "object" || Array.isArray(headers)) {
      return {};
    }
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(
      headers as Record<string, unknown>,
    )) {
      if (
        typeof value === "string" &&
        !HttpPublisher.BLOCKED_HEADERS.has(key.toLowerCase())
      ) {
        result[key] = value;
      }
    }
    return result;
  }

  private parseIndividualResults(
    responseBody: string,
    eventIds: string[],
    durationMs: number,
  ): Map<string, PublishResult> | null {
    try {
      const parsed = JSON.parse(responseBody) as {
        results?: Record<
          string,
          { success: boolean; retryable?: boolean; error?: string }
        >;
      };

      if (!parsed.results || typeof parsed.results !== "object") {
        return null;
      }

      const results = new Map<string, PublishResult>();

      for (const eventId of eventIds) {
        const eventResult = parsed.results[eventId];

        if (eventResult) {
          if (eventResult.success) {
            results.set(eventId, {
              success: true,
              retryable: false,
              durationMs,
            });
          } else {
            results.set(eventId, {
              success: false,
              error: eventResult.error
                ? new Error(eventResult.error)
                : new Error("Unknown error"),
              retryable: eventResult.retryable ?? true,
              durationMs,
            });
          }
        } else {
          results.set(eventId, { success: true, retryable: false, durationMs });
        }
      }

      return results;
    } catch {
      return null;
    }
  }
}
