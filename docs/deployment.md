# Deployment Guide

Outboxy ships as a single Docker image that runs either the API server or the worker, selected by a CLI argument. Both processes require a PostgreSQL or MySQL database.

## Quick Start (Docker)

Build from the repo root, then run each process in its own container.

```bash
# Build the image
docker build -t outboxy -f packages/server/Dockerfile .

# Run database migrations
docker run --rm \
  -e DATABASE_URL=postgresql://user:pass@host:5432/outboxy \
  outboxy migrate

# Start the API server
docker run -d \
  -p 3000:3000 \
  -e DATABASE_URL=postgresql://user:pass@host:5432/outboxy \
  outboxy api

# Start the worker
docker run -d \
  -p 9090:9090 \
  -e DATABASE_URL=postgresql://user:pass@host:5432/outboxy \
  outboxy worker
```

## Environment Variables

[`docs/deployment/.env.example`](./deployment/.env.example) is the complete reference — it lists every variable with descriptions and defaults. The file is generated from source; run `pnpm generate:env-docs` to regenerate it along with the Kubernetes ConfigMap and Secret templates.

| Variable         | Required | Default | Description                           |
| ---------------- | -------- | ------- | ------------------------------------- |
| `DATABASE_URL`   | Yes      | --      | PostgreSQL or MySQL connection string |
| `DATABASE_TYPE`  | No       | auto    | Force `postgresql` or `mysql`         |
| `PUBLISHER_TYPE` | No       | `http`  | `http` or `kafka`                     |
| `KAFKA_BROKERS`  | If Kafka | --      | Comma-separated broker addresses      |
| `PORT`           | No       | `3000`  | API server port                       |
| `METRICS_PORT`   | No       | `9090`  | Worker Prometheus metrics port        |
| `WORKER_COUNT`   | No       | `1`     | Worker instances per container        |
| `BATCH_SIZE`     | No       | `10`    | Outbox events per polling batch       |
| `DB_POOL_MAX`    | No       | `20`    | Maximum database connections in pool  |
| `LOG_LEVEL`      | No       | `info`  | Logging level                         |

## Docker Image

The Dockerfile at `packages/server/Dockerfile` uses a five-stage multi-stage build:

1. **base** -- Node 22 Alpine with pnpm enabled.
2. **deps** -- Installs all workspace dependencies.
3. **builder** -- Compiles TypeScript for all packages in dependency order.
4. **prod-deps** -- Installs production-only dependencies.
5. **production** -- Copies compiled output and production dependencies. Runs as non-root user `outboxy` (UID 1001).

Exposed ports:

- `3000` -- API server
- `9090` -- Worker Prometheus metrics

The image includes a built-in health check that polls `/health` every 30 seconds:

```bash
wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1
```

## Kubernetes

Pre-generated templates are available in [`docs/deployment/kubernetes/`](./deployment/kubernetes/). Apply them in this order:

1. Populate secrets and apply the Secret template:

```bash
# Edit docs/deployment/kubernetes/secret.yaml to replace placeholders, then:
kubectl apply -f docs/deployment/kubernetes/secret.yaml
```

2. Apply the ConfigMap:

```bash
kubectl apply -f docs/deployment/kubernetes/configmap.yaml
```

3. Create your own Deployment manifests for the API pods, worker pods, and a one-time migration Job. The following pod spec demonstrates how to wire the ConfigMap and Secret into an API container:

```yaml
containers:
  - name: outboxy-api
    image: outboxy:latest
    args: ["api"]
    ports:
      - containerPort: 3000
    envFrom:
      - configMapRef:
          name: outboxy-config
      - secretRef:
          name: outboxy-secrets
    livenessProbe:
      httpGet:
        path: /health
        port: 3000
    readinessProbe:
      httpGet:
        path: /ready
        port: 3000
```

For the worker, replace `args: ["api"]` with `args: ["worker"]` and expose port `9090` for Prometheus scraping. For the migration job, use `args: ["migrate"]` with `restartPolicy: OnFailure`.

## Production Recommendations

- **Run API and worker separately.** The two processes have different scaling and resource profiles.
- **Database pool sizing.** The worker calculates its pool size automatically as `(WORKER_COUNT * 2) + 1`. For the API, the default `DB_POOL_MAX=20` suits most workloads.
- **Horizontal scaling.** Add worker pods freely. Workers coordinate via `FOR UPDATE SKIP LOCKED`, so no leader election is needed. See [architecture.md](./architecture.md) for details on the worker layer.
- **Monitoring.** Scrape `/metrics` on port `9090` from worker pods. The API exposes `/health` and `/ready` for liveness and readiness probes.
- **Graceful shutdown.** Both processes handle `SIGINT` and `SIGTERM`. Set `terminationGracePeriodSeconds` in Kubernetes to match `SHUTDOWN_TIMEOUT_MS` (default: 30 seconds).
- **Retry and DLQ.** Failed events are retried with exponential backoff and moved to a dead-letter queue after `MAX_RETRIES` attempts. See [event-lifecycle.md](./event-lifecycle.md) for the full status flow.
