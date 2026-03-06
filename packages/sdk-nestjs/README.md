# @outboxy/sdk-nestjs

NestJS integration module for the Outboxy transactional outbox and inbox patterns. Provides dependency injection for `OutboxyClient` and `InboxyClient`.

## Installation

```bash
npm install @outboxy/sdk-nestjs @outboxy/sdk
```

Install peer dependencies:

```bash
npm install @nestjs/common @nestjs/core rxjs reflect-metadata
```

Install a dialect package and database driver:

```bash
# PostgreSQL
npm install @outboxy/dialect-postgres pg

# MySQL
npm install @outboxy/dialect-mysql mysql2
```

---

## Module Registration

The module only supports async registration via `forRootAsync()`. One of `useFactory`, `useClass`, or `useExisting` is required.

### Basic Setup (useFactory)

The following example registers the module with a static factory function:

```typescript
import { Module } from "@nestjs/common";
import { OutboxyModule } from "@outboxy/sdk-nestjs";
import { PostgreSqlDialect } from "@outboxy/dialect-postgres";
import { PoolClient } from "pg";

@Module({
  imports: [
    OutboxyModule.forRootAsync({
      useFactory: () => ({
        dialect: new PostgreSqlDialect(),
        adapter: (client: PoolClient) => async (sql, params) => {
          const result = await client.query(sql, params);
          return result.rows as { id: string }[];
        },
        defaultDestinationUrl: "https://webhook.example.com",
      }),
      isGlobal: true,
    }),
  ],
})
export class AppModule {}
```

### With Dependency Injection

The following example injects a database pool from another module into the factory:

```typescript
import { Module } from "@nestjs/common";
import { OutboxyModule } from "@outboxy/sdk-nestjs";
import { PostgreSqlDialect } from "@outboxy/dialect-postgres";
import { DatabaseModule, DATABASE_POOL } from "./database.module";
import { Pool, PoolClient } from "pg";

@Module({
  imports: [
    DatabaseModule,
    OutboxyModule.forRootAsync({
      imports: [DatabaseModule],
      inject: [DATABASE_POOL],
      useFactory: (pool: Pool) => ({
        dialect: new PostgreSqlDialect(),
        adapter: (client: PoolClient) => async (sql, params) => {
          const result = await client.query(sql, params);
          return result.rows as { id: string }[];
        },
        defaultDestinationUrl: process.env.WEBHOOK_URL,
      }),
      isGlobal: true,
    }),
  ],
})
export class AppModule {}
```

### With Inbox Enabled

To use the inbox pattern for event deduplication, set `inbox.enabled: true` and provide an inbox dialect:

```typescript
import {
  PostgreSqlDialect,
  PostgreSqlInboxDialect,
} from "@outboxy/dialect-postgres";
import { PoolClient } from "pg";

OutboxyModule.forRootAsync({
  useFactory: () => ({
    dialect: new PostgreSqlDialect(),
    adapter: (client: PoolClient) => async (sql, params) => {
      const result = await client.query(sql, params);
      return result.rows as { id: string }[];
    },
    defaultDestinationUrl: "https://webhook.example.com",
    inbox: {
      enabled: true,
      dialect: new PostgreSqlInboxDialect(),
    },
  }),
  isGlobal: true,
});
```

### Using useClass

The following example provides options through a dedicated configuration service:

```typescript
import { Injectable } from "@nestjs/common";
import { PostgreSqlDialect } from "@outboxy/dialect-postgres";
import {
  OutboxyModuleOptions,
  OutboxyOptionsFactory,
} from "@outboxy/sdk-nestjs";
import { PoolClient } from "pg";

@Injectable()
class OutboxyConfigService implements OutboxyOptionsFactory {
  createOutboxyOptions(): OutboxyModuleOptions {
    return {
      dialect: new PostgreSqlDialect(),
      adapter: (client: PoolClient) => async (sql, params) => {
        const result = await client.query(sql, params);
        return result.rows as { id: string }[];
      },
    };
  }
}

OutboxyModule.forRootAsync({
  useClass: OutboxyConfigService,
});
```

---

## Injecting Clients

### OutboxyClient

Inject the outbox client using the `OUTBOXY_CLIENT` token. The following example publishes an outbox event inside a service method:

```typescript
import { Injectable, Inject } from "@nestjs/common";
import { OUTBOXY_CLIENT, OutboxyClient } from "@outboxy/sdk-nestjs";
import { Pool, PoolClient } from "pg";

@Injectable()
export class OrderService {
  constructor(
    @Inject(OUTBOXY_CLIENT)
    private readonly outboxy: OutboxyClient<PoolClient>,
    @Inject("DATABASE_POOL")
    private readonly pool: Pool,
  ) {}

  async createOrder(data: CreateOrderDto) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const result = await client.query(
        "INSERT INTO orders (customer_id, total) VALUES ($1, $2) RETURNING id",
        [data.customerId, data.total],
      );
      const orderId = result.rows[0].id;

      await this.outboxy.publish(
        {
          aggregateType: "Order",
          aggregateId: orderId,
          eventType: "OrderCreated",
          payload: { customerId: data.customerId, total: data.total },
        },
        client,
      );

      await client.query("COMMIT");
      return orderId;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
```

### InboxyClient

When inbox is enabled, inject the inbox client using the `INBOXY_CLIENT` token. Use `@Optional()` when inbox may not be configured. The following example shows an atomic chain: deduplicate an inbox event, run business logic, and publish a downstream outbox event:

```typescript
import { Injectable, Inject, Optional } from "@nestjs/common";
import {
  OUTBOXY_CLIENT,
  INBOXY_CLIENT,
  OutboxyClient,
  InboxyClient,
} from "@outboxy/sdk-nestjs";
import { Pool, PoolClient } from "pg";

@Injectable()
export class PaymentService {
  constructor(
    @Inject(OUTBOXY_CLIENT)
    private readonly outbox: OutboxyClient<PoolClient>,
    @Inject(INBOXY_CLIENT)
    @Optional()
    private readonly inbox: InboxyClient<PoolClient>,
    @Inject("DATABASE_POOL")
    private readonly pool: Pool,
  ) {}

  async handlePaymentCompleted(event: IncomingEvent) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const result = await this.inbox.receive(
        {
          idempotencyKey: event.id,
          aggregateType: "Payment",
          aggregateId: event.paymentId,
          eventType: "PaymentCompleted",
          payload: event.payload,
        },
        client,
      );

      if (result.status === "duplicate") {
        await client.query("COMMIT");
        return;
      }

      // Business logic
      await client.query("UPDATE orders SET status = $1 WHERE id = $2", [
        "paid",
        event.orderId,
      ]);

      // Publish a downstream outbox event in the same transaction
      await this.outbox.publish(
        {
          aggregateType: "Order",
          aggregateId: event.orderId,
          eventType: "OrderPaid",
          payload: { orderId: event.orderId },
        },
        client,
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
```

---

## Configuration Options

### OutboxyModuleAsyncOptions

| Option        | Type                                | Required | Default | Description                                |
| ------------- | ----------------------------------- | -------- | ------- | ------------------------------------------ |
| `useFactory`  | `(...args) => OutboxyModuleOptions` | \*       | —       | Factory function returning options         |
| `useClass`    | `Type<OutboxyOptionsFactory>`       | \*       | —       | Class implementing `OutboxyOptionsFactory` |
| `useExisting` | `Type<OutboxyOptionsFactory>`       | \*       | —       | Existing provider implementing the factory |
| `imports`     | `ModuleMetadata["imports"]`         | No       | `[]`    | Modules to import for dependency injection |
| `inject`      | `InjectionToken[]`                  | No       | `[]`    | Tokens to inject into `useFactory`         |
| `isGlobal`    | `boolean`                           | No       | `false` | Register as a global module                |

\*One of `useFactory`, `useClass`, or `useExisting` is required.

### OutboxyModuleOptions

| Option                   | Type                      | Required | Default  | Description                         |
| ------------------------ | ------------------------- | -------- | -------- | ----------------------------------- |
| `dialect`                | `SqlDialect`              | Yes      | —        | SQL dialect for outbox operations   |
| `adapter`                | `AdapterFn<T>`            | Yes      | —        | Converts your executor to `QueryFn` |
| `defaultDestinationUrl`  | `string`                  | No       | —        | Default delivery URL                |
| `defaultDestinationType` | `DestinationType`         | No       | `"http"` | Default delivery type               |
| `defaultMaxRetries`      | `number`                  | No       | `5`      | Default max retry attempts          |
| `defaultHeaders`         | `Record<string, unknown>` | No       | `{}`     | Default HTTP headers                |
| `defaultMetadata`        | `Record<string, unknown>` | No       | `{}`     | Default metadata                    |
| `inbox`                  | `InboxModuleOptions`      | No       | —        | Inbox configuration (see below)     |

### InboxModuleOptions

| Option    | Type              | Required | Default | Description                                                     |
| --------- | ----------------- | -------- | ------- | --------------------------------------------------------------- |
| `enabled` | `boolean`         | Yes      | `false` | Enable the inbox client for event deduplication                 |
| `dialect` | `InboxSqlDialect` | No\*     | —       | Inbox dialect (`PostgreSqlInboxDialect` or `MySqlInboxDialect`) |

\*Required when `enabled` is `true`.

---

## Exported Tokens

| Token                    | Provides                       | Description                              |
| ------------------------ | ------------------------------ | ---------------------------------------- |
| `OUTBOXY_CLIENT`         | `OutboxyClient<T>`             | Always available                         |
| `INBOXY_CLIENT`          | `InboxyClient<T> \| undefined` | Available when `inbox.enabled` is `true` |
| `OUTBOXY_MODULE_OPTIONS` | `OutboxyModuleOptions`         | For advanced DI scenarios                |

## License

MIT
