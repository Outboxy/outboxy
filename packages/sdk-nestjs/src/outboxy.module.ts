import { Module, DynamicModule, Provider } from "@nestjs/common";
import { OutboxyClient, InboxyClient } from "@outboxy/sdk";
import {
  OUTBOXY_MODULE_OPTIONS,
  OUTBOXY_CLIENT,
  INBOXY_CLIENT,
} from "./constants.js";
import type {
  OutboxyModuleOptions,
  OutboxyModuleAsyncOptions,
  OutboxyOptionsFactory,
} from "./interfaces/index.js";

/**
 * NestJS dynamic module for Outboxy transactional outbox pattern
 *
 * Provides dependency injection for OutboxyClient via OUTBOXY_CLIENT token.
 * Optionally provides InboxyClient via INBOXY_CLIENT token when inbox is enabled.
 * Uses an ORM-agnostic adapter pattern - works with any database client.
 *
 * @example Setup with pg PoolClient (outbox only)
 * ```typescript
 * @Module({
 *   imports: [
 *     DatabaseModule,
 *     OutboxyModule.forRootAsync({
 *       imports: [DatabaseModule],
 *       inject: [DATABASE_POOL],
 *       useFactory: (pool: Pool) => ({
 *         adapter: (client: PoolClient) => async (sql, params) => {
 *           const result = await client.query(sql, params);
 *           return result.rows as { id: string }[];
 *         },
 *         defaultDestinationUrl: 'https://webhook.example.com',
 *       }),
 *       isGlobal: true,
 *     }),
 *   ],
 * })
 * export class AppModule {}
 *
 * // In your service
 * @Injectable()
 * export class OrderService {
 *   constructor(
 *     @Inject(OUTBOXY_CLIENT) private readonly outboxy: OutboxyClient<PoolClient>,
 *     @Inject(DATABASE_POOL) private readonly pool: Pool, // Your own pool token
 *   ) {}
 * }
 * ```
 *
 * @example Setup with inbox enabled for atomic inbox→business→outbox chains
 * ```typescript
 * @Module({
 *   imports: [
 *     OutboxyModule.forRootAsync({
 *       inject: [DATABASE_POOL],
 *       useFactory: () => ({
 *         dialect: new PostgreSqlDialect(),
 *         inboxDialect: new PostgreSqlInboxDialect(),
 *         adapter: (client: PoolClient) => async (sql, params) => {
 *           const result = await client.query(sql, params);
 *           return result.rows as { id: string }[];
 *         },
 *         defaultDestinationUrl: 'https://webhook.example.com',
 *         inbox: { enabled: true, dialect: new PostgreSqlInboxDialect() },
 *       }),
 *       isGlobal: true,
 *     }),
 *   ],
 * })
 * export class AppModule {}
 *
 * // In your service - atomic chain
 * @Injectable()
 * export class PaymentService {
 *   constructor(
 *     @Inject(OUTBOXY_CLIENT) private readonly outbox: OutboxyClient<PoolClient>,
 *     @Inject(INBOXY_CLIENT) private readonly inbox: InboxyClient<PoolClient>,
 *   ) {}
 *
 *   async handlePaymentCompleted(event: IncomingEvent) {
 *     const client = await this.pool.connect();
 *     try {
 *       await client.query('BEGIN');
 *
 *       const result = await this.inbox.receive(event, client);
 *       if (result.status === 'duplicate') {
 *         await client.query('COMMIT');
 *         return;
 *       }
 *
 *       await this.processPayment(event.payload, client);
 *       await this.outbox.publish(this.buildFulfillmentEvent(event), client);
 *
 *       await client.query('COMMIT');
 *     } finally {
 *       client.release();
 *     }
 *   }
 * }
 * ```
 */
@Module({})
export class OutboxyModule {
  /**
   * Register module with asynchronous configuration
   *
   * Requires an adapter function that converts your executor to a QueryFn.
   *
   * @param options - Async module configuration with factory
   * @returns Configured dynamic module
   */
  static forRootAsync<T = unknown>(
    options: OutboxyModuleAsyncOptions<T>,
  ): DynamicModule {
    const providers: Provider[] = [
      ...this.createAsyncProviders(options),
      {
        provide: OUTBOXY_CLIENT,
        useFactory: (factoryResult: OutboxyModuleOptions<T>) => {
          return new OutboxyClient<T>({
            dialect: factoryResult.dialect,
            adapter: factoryResult.adapter,
            defaultDestinationUrl: factoryResult.defaultDestinationUrl,
            defaultDestinationType: factoryResult.defaultDestinationType,
            defaultMaxRetries: factoryResult.defaultMaxRetries,
            defaultHeaders: factoryResult.defaultHeaders,
            defaultMetadata: factoryResult.defaultMetadata,
          });
        },
        inject: [OUTBOXY_MODULE_OPTIONS],
      },
      {
        provide: INBOXY_CLIENT,
        useFactory: (factoryResult: OutboxyModuleOptions<T>) => {
          // Return undefined when inbox is not enabled
          // Users should use @Optional() when injecting
          if (!factoryResult.inbox?.enabled) {
            return undefined;
          }
          if (!factoryResult.inbox.dialect) {
            throw new Error(
              "Inbox is enabled but inbox.dialect is not provided. " +
                "Import InboxSqlDialect from @outboxy/dialect-postgres or @outboxy/dialect-mysql",
            );
          }
          return new InboxyClient<T>({
            dialect: factoryResult.inbox.dialect,
            adapter: factoryResult.adapter,
            defaultHeaders: factoryResult.defaultHeaders,
            defaultMetadata: factoryResult.defaultMetadata,
          });
        },
        inject: [OUTBOXY_MODULE_OPTIONS],
      },
    ];

    const module: DynamicModule = {
      module: OutboxyModule,
      imports: options.imports || [],
      providers,
      exports: [OUTBOXY_CLIENT, INBOXY_CLIENT],
    };

    if (options.isGlobal) {
      return { ...module, global: true };
    }

    return module;
  }

  /**
   * Create async providers based on configuration pattern
   */
  private static createAsyncProviders<T>(
    options: OutboxyModuleAsyncOptions<T>,
  ): Provider[] {
    if (options.useFactory) {
      return [
        {
          provide: OUTBOXY_MODULE_OPTIONS,
          useFactory: options.useFactory,
          inject: options.inject || [],
        },
      ];
    }

    if (options.useClass) {
      return [
        {
          provide: options.useClass,
          useClass: options.useClass,
        },
        {
          provide: OUTBOXY_MODULE_OPTIONS,
          useFactory: async (factory: OutboxyOptionsFactory<T>) =>
            factory.createOutboxyOptions(),
          inject: [options.useClass],
        },
      ];
    }

    if (options.useExisting) {
      return [
        {
          provide: OUTBOXY_MODULE_OPTIONS,
          useFactory: async (factory: OutboxyOptionsFactory<T>) =>
            factory.createOutboxyOptions(),
          inject: [options.useExisting],
        },
      ];
    }

    throw new Error("Invalid OutboxyModule async configuration");
  }
}
