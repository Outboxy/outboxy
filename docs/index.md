# Outboxy Documentation

Outboxy implements the transactional outbox and inbox patterns as a service, providing reliable event delivery from database transactions to external systems.

## Getting Started

- [README](../README.md) -- Project overview, quick start with Docker, and package summary.
- [Development Guide](../DEVELOPMENT.md) -- Prerequisites, local setup, running tests, and build commands.
- [Contributing](../CONTRIBUTING.md) -- Branch conventions, pull request process, and changeset workflow.
- [Security Policy](../SECURITY.md) -- Supported versions and vulnerability reporting procedure.

## Integration

- [@outboxy/sdk](../packages/sdk/README.md) -- Node.js SDK providing `OutboxyClient` (outbox) and `InboxyClient` (inbox), including configuration options and usage examples.
- [@outboxy/sdk-nestjs](../packages/sdk-nestjs/README.md) -- NestJS module with async registration, dependency injection, and inbox support.

## Architecture

- [System Architecture](architecture.md) -- Package dependency graph, layered design, and component relationships.
- [Event Lifecycle](event-lifecycle.md) -- Outbox event statuses, polling loop, retry logic, DLQ, and `FOR UPDATE SKIP LOCKED` semantics.
- [Inbox Pattern](inbox-pattern.md) -- Idempotent consumption, deduplication via `ON CONFLICT DO NOTHING`, and exactly-once processing.

## Internals

- [Database Adapters and Dialects](database-adapters.md) -- Adapter vs. dialect layers, error normalization, migration system, and how to add a new database.
- [Publisher Plugins](publisher-plugins.md) -- Publisher interface, HTTP and Kafka implementations, and how to add a new publisher.

## Operations

- [Deployment Guide](deployment.md) -- Docker quick start, environment variables, Kubernetes setup, and production recommendations.
- [@outboxy/api](../packages/api/README.md) -- REST API endpoints, configuration options, and Swagger UI.
- [@outboxy/worker](../packages/worker/README.md) -- Polling loop, adaptive intervals, Prometheus metrics, and graceful shutdown.
- [@outboxy/server](../packages/server/README.md) -- CLI commands, Docker image structure, and combined deployment.

## Auto-Generated Artifacts

These files are generated from source code via `pnpm graph` and `pnpm generate:env-docs`. Do not edit them by hand.

- [Package Dependency Graph](package-graph.svg) ([DOT source](package-graph.dot)) -- Visual map of inter-package dependencies.
- [Environment Variables Reference](deployment/.env.example) -- Full list of supported environment variables with defaults.
- [Kubernetes ConfigMap](deployment/kubernetes/configmap.yaml) -- Non-sensitive configuration template for Kubernetes deployments.
- [Kubernetes Secret Template](deployment/kubernetes/secret.yaml) -- Sensitive configuration template; replace placeholders before applying.
