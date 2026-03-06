/**
 * Outboxy Node.js SDK
 *
 * Simplified client library for integrating Outboxy into Node.js applications.
 * Provides a minimal API for publishing events - user manages their own transactions.
 *
 * @packageDocumentation
 */

// Re-export error types for consumers
export * from "./errors.js";

// Re-export types for consumers
export type {
  DestinationType,
  QueryFn,
  AdapterFn,
  OutboxyConfig,
  PublishEventInput,
} from "./types.js";

// Re-export client
export { OutboxyClient, createClient } from "./client.js";

// Re-export inbox types for consumers
export type {
  InboxyConfig,
  InboxReceiveEventInput,
  InboxReceiveResult,
} from "./inbox-types.js";

// Re-export inbox client
export { InboxyClient, createInboxClient } from "./inbox-client.js";

// Re-export unified factory
export { createOutboxy } from "./create-outboxy.js";
export type { UnifiedOutboxyConfig, OutboxyClients } from "./create-outboxy.js";

// Re-export dialect interfaces for consumers
export type {
  SqlDialect,
  BuildInsertParams,
  BuildBulkInsertParams,
  SqlStatement,
  InboxSqlDialect,
  BuildInboxInsertParams,
  BuildInboxBulkInsertParams,
} from "@outboxy/dialect-core";
