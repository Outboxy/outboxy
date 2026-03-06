import type {
  AdapterFn,
  DestinationType,
  SqlDialect,
  InboxSqlDialect,
} from "@outboxy/sdk";
import type {
  ModuleMetadata,
  Type,
  InjectionToken,
  OptionalFactoryDependency,
} from "@nestjs/common";

/**
 * Inbox configuration options
 */
export interface InboxModuleOptions {
  /**
   * Enable inbox client for event deduplication
   *
   * When enabled, INBOXY_CLIENT token will be available for injection.
   *
   * @default false
   */
  enabled: boolean;

  /**
   * SQL dialect for inbox-specific operations
   *
   * Required when inbox is enabled.
   * Import from @outboxy/dialect-postgres or @outboxy/dialect-mysql
   *
   * @example PostgreSQL
   * ```typescript
   * import { PostgreSqlInboxDialect } from '@outboxy/dialect-postgres';
   * inboxDialect: new PostgreSqlInboxDialect()
   * ```
   */
  dialect?: InboxSqlDialect;
}

/**
 * Options for OutboxyModule.forRootAsync()
 *
 * Provides an ORM-agnostic configuration using adapter functions.
 * Works with any executor type (pg PoolClient, Drizzle transaction, TypeORM, etc.)
 */
export interface OutboxyModuleOptions<T = unknown> {
  /**
   * SQL dialect for database-specific SQL generation
   *
   * Import from @outboxy/dialect-postgres or @outboxy/dialect-mysql
   *
   * @example PostgreSQL
   * ```typescript
   * import { PostgresDialect } from '@outboxy/dialect-postgres';
   * dialect: new PostgresDialect()
   * ```
   *
   * @example MySQL
   * ```typescript
   * import { MySqlDialect } from '@outboxy/dialect-mysql';
   * dialect: new MySqlDialect()
   * ```
   */
  dialect: SqlDialect;

  /**
   * Adapter function that converts your executor to a QueryFn
   *
   * @example pg PoolClient
   * ```typescript
   * adapter: (client: PoolClient) => async (sql, params) => {
   *   const result = await client.query(sql, params);
   *   return result.rows as { id: string }[];
   * }
   * ```
   *
   * @example Drizzle transaction
   * ```typescript
   * adapter: (tx: DrizzleTransaction) => async (sql, params) => {
   *   return await tx.execute(sql.raw(sql, params));
   * }
   * ```
   */
  adapter: AdapterFn<T>;

  /**
   * Default destination URL for events
   */
  defaultDestinationUrl?: string;

  /**
   * Default destination type for events
   *
   * Determines which publisher the worker will use. Can be overridden per-event.
   *
   * Valid values: "http", "kafka", "sqs", "rabbitmq", "pubsub"
   *
   * @default "http"
   */
  defaultDestinationType?: DestinationType;

  /**
   * Default max retries for event delivery
   *
   * @default 5
   */
  defaultMaxRetries?: number;

  /**
   * Default HTTP headers to include with each event
   */
  defaultHeaders?: Record<string, unknown>;

  /**
   * Default metadata to include with each event
   */
  defaultMetadata?: Record<string, unknown>;

  /**
   * Inbox configuration for event deduplication
   *
   * When enabled, provides InboxyClient for receiving and deduplicating incoming events.
   *
   * @example
   * ```typescript
   * inbox: {
   *   enabled: true,
   *   dialect: new PostgreSqlInboxDialect(),
   * }
   * ```
   */
  inbox?: InboxModuleOptions;
}

/**
 * Factory interface for useClass/useExisting patterns
 */
export interface OutboxyOptionsFactory<T = unknown> {
  createOutboxyOptions():
    | Promise<OutboxyModuleOptions<T>>
    | OutboxyModuleOptions<T>;
}

/**
 * Options for OutboxyModule.forRootAsync()
 */
export interface OutboxyModuleAsyncOptions<T = unknown> extends Pick<
  ModuleMetadata,
  "imports"
> {
  /**
   * Make module global
   *
   * @default false
   */
  isGlobal?: boolean;

  /**
   * Dependencies to inject into useFactory
   */
  inject?: (InjectionToken | OptionalFactoryDependency)[];

  /**
   * Factory function returning options
   */
  useFactory?: (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...args: any[]
  ) => Promise<OutboxyModuleOptions<T>> | OutboxyModuleOptions<T>;

  /**
   * Use an existing class to create options
   */
  useClass?: Type<OutboxyOptionsFactory<T>>;

  /**
   * Use an existing instance to create options
   */
  useExisting?: Type<OutboxyOptionsFactory<T>>;
}
