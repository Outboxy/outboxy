# @outboxy/api

Fastify-based REST API server for Outboxy. Provides admin and observability endpoints for managing outbox events. Outbox event creation is handled by the SDK (direct database insert within a transaction), not by this API.

## Installation

```bash
npm install @outboxy/api
```

This package is typically used via `@outboxy/server`, which wires up the database adapter and CLI. See the [deployment guide](../../docs/deployment.md) for production setup.

---

## Endpoints

### Health

| Method | Path      | Description                                                                                  |
| ------ | --------- | -------------------------------------------------------------------------------------------- |
| GET    | `/health` | Liveness probe. Returns `200` with `{ "status": "ok" }`.                                     |
| GET    | `/ready`  | Readiness probe. Checks database connectivity. Returns `503` if the database is unreachable. |

The `/ready` response includes connection pool statistics: `totalConnections`, `idleConnections`, and `waitingClients`.

### Events

| Method | Path          | Description                      |
| ------ | ------------- | -------------------------------- |
| GET    | `/events/:id` | Get outbox event status by UUID. |

Returns full outbox event details: status, retry count, payload, headers, destination, timestamps, and error information. Returns `404` if the outbox event does not exist.

### Admin

| Method | Path                  | Description                                 |
| ------ | --------------------- | ------------------------------------------- |
| POST   | `/admin/replay/:id`   | Replay a single failed or DLQ outbox event. |
| POST   | `/admin/replay/range` | Bulk replay outbox events in a date range.  |

`POST /admin/replay/:id` resets a `failed` or `dlq` outbox event back to `pending`. Returns `422` if the outbox event is in a non-replayable status.

`POST /admin/replay/range` accepts a JSON body:

```json
{
  "startDate": "2024-01-01T00:00:00Z",
  "endDate": "2024-01-02T00:00:00Z",
  "status": "dlq",
  "aggregateType": "order",
  "limit": 100
}
```

- `status` defaults to `"dlq"`.
- `limit` defaults to `100` (max `1000`).
- `aggregateType` is optional.

### Documentation

| Path    | Description                    |
| ------- | ------------------------------ |
| `/docs` | Swagger UI (OpenAPI 3.1 spec). |

Swagger UI is enabled by default. Disable it by setting `SWAGGER_ENABLED=false`.

---

## Configuration

Configuration is loaded from environment variables and validated with Zod at startup.

| Variable             | Default       | Description                   |
| -------------------- | ------------- | ----------------------------- |
| `PORT`               | `3000`        | API server port               |
| `HOST`               | `0.0.0.0`     | Bind address                  |
| `LOG_LEVEL`          | `info`        | Pino log level                |
| `REQUEST_TIMEOUT_MS` | `30000`       | Request timeout (ms)          |
| `BODY_LIMIT`         | `1048576`     | Max request body size (bytes) |
| `SWAGGER_ENABLED`    | `true`        | Enable Swagger UI at `/docs`  |
| `NODE_ENV`           | `development` | Node.js environment           |

See [docs/deployment/.env.example](../../docs/deployment/.env.example) for the full configuration reference.

---

## Error Handling

All error responses share a consistent JSON shape:

```json
{
  "statusCode": 400,
  "error": "Validation Error",
  "message": "Request validation failed",
  "requestId": "abc-123",
  "details": {}
}
```

Mapped error types:

- `400` — Zod validation errors, `ConstraintViolationError`
- `404` — `NotFoundError`
- `409` — `ConflictError`, `ConstraintViolationError`
- `422` — `InvalidStateError`
- `500` — Unhandled errors (message hidden in production)

---

## Architecture

The API package exports a `createServer` function that accepts a `DatabaseAdapter` instance. The API does not manage database connections — the caller (typically `@outboxy/server`) creates and shuts down the adapter. This allows the same API binary to work with PostgreSQL (`@outboxy/db-adapter-postgres`) or MySQL (`@outboxy/db-adapter-mysql`).

The server registers three Fastify plugins:

1. **error-handler** — Centralized error-to-HTTP-response mapping.
2. **database** — Decorates the Fastify instance with the adapter.
3. **swagger** — OpenAPI spec and Swagger UI (conditional on `SWAGGER_ENABLED`).
