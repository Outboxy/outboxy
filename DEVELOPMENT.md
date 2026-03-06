# Development

This guide covers everything a new contributor needs to set up the project, run tests, and build packages.

## Prerequisites

- **Node.js** >= 20.0.0
- **pnpm** >= 8.0.0 (the repo pins `pnpm@8.15.0` via `packageManager` in `package.json`)
- **Docker** — required for integration tests (Testcontainers starts PostgreSQL, MySQL, and Kafka containers automatically)

## Setup

Clone the repository and install dependencies:

```bash
git clone https://github.com/outboxy/outboxy.git
cd outboxy
pnpm install
pnpm build
```

## Running the Services Locally

Each command below requires `DATABASE_URL` to be set in your environment.

```bash
# Start the API server
pnpm dev:api

# Start the worker
pnpm dev:worker

# Run database migrations
pnpm migrate
```

Both `dev:api` and `dev:worker` use `tsx watch` for live reloading.

## Tests

Tests use Vitest. Integration tests rely on Testcontainers, which automatically starts PostgreSQL 16, MySQL 8.0, and Redpanda (Kafka-compatible) containers. Docker must be running before you execute integration tests.

The global test setup in `packages/testing-utils/src/globalSetup.ts` starts containers once and reuses them across all test packages. Containers use `.withReuse()`, so subsequent runs skip container startup.

### Run All Tests

The following command runs unit tests first, then integration tests sequentially:

```bash
pnpm test
```

### Test Coverage

```bash
pnpm test:coverage
```

### E2E Tests

The `packages/e2e` package provides targeted commands for each test area:

```bash
pnpm --filter @outboxy/e2e test:api
pnpm --filter @outboxy/e2e test:worker
pnpm --filter @outboxy/e2e test:http
pnpm --filter @outboxy/e2e test:kafka
pnpm --filter @outboxy/e2e test:migrations
pnpm --filter @outboxy/e2e test:transaction
pnpm --filter @outboxy/e2e test:idempotency
```

## Build

The following command builds all packages in dependency order. Each package compiles TypeScript via `tsc --project tsconfig.build.json`:

```bash
pnpm build
```

## Linting and Formatting

```bash
pnpm lint          # Run ESLint across all packages
pnpm lint:fix      # Run ESLint with auto-fix
pnpm format        # Format with Prettier
pnpm format:check  # Check formatting without writing changes
```

The ESLint configuration (`eslint.config.js`) includes a custom `no-raw-sql` rule that prevents raw SQL strings in the SDK layer, enforcing use of dialect methods instead.

## Type Checking

The following command runs `tsc --noEmit` across all packages. The root `tsconfig.json` targets ES2022 with `NodeNext` module resolution and strict mode enabled:

```bash
pnpm typecheck
```

## Tooling Scripts

```bash
pnpm graph              # Regenerate the package dependency graph (docs/package-graph.svg)
pnpm generate:env-docs  # Regenerate environment variable documentation
```

## Docker

The Dockerfile is at `packages/server/Dockerfile`. It uses a multi-stage build (Node 22 Alpine) and produces a single image that runs the API server, worker, or migrations depending on the command argument.

Build and verify the image locally:

```bash
docker build -t outboxy -f packages/server/Dockerfile .
docker run --rm outboxy help
```

## Project Structure

```
packages/
  api/                  Fastify REST API server
  worker/               Outbox event polling and publishing service
  server/               Deployment package (CLI + Docker)
  sdk/                  Node.js SDK
  sdk-nestjs/           NestJS integration
  schema/               Shared constants and types
  logging/              Shared logging (pino)
  migrations/           Database migration runner
  db-adapter-core/      Core DB adapter interfaces
  db-adapter-postgres/  PostgreSQL adapter
  db-adapter-mysql/     MySQL adapter
  dialect-core/         Core SQL dialect interface
  dialect-postgres/     PostgreSQL dialect
  dialect-mysql/        MySQL dialect
  publisher-core/       Core publisher interfaces
  publisher-http/       HTTP webhook publisher
  publisher-kafka/      Kafka publisher
  testing-utils/        Test helpers and Testcontainers setup
  e2e/                  End-to-end integration tests
```
