# Deployment Guide

## Prerequisites

- Docker ≥ 24 and Docker Compose v2
- A PostgreSQL 15+ instance (or use the bundled Compose service)
- Chrome/Chromium available in the container (included in the `Dockerfile`)

## Environment variables

Copy `.env.example` to `.env` and fill in all required values:

```bash
cp .env.example .env
```

**Minimum required for production:**

```dotenv
ENVIRONMENT=production
FLASK_SECRET_KEY=<64-char random hex>   # python -c "import secrets; print(secrets.token_hex(32))"
API_KEY=<strong-random-token>
DATABASE_URL=******db-host:5432/clickup_generator
JSON_LOGGING=true
LOG_LEVEL=INFO
CLICKUP_HEADLESS=true
```

## Docker Compose

```bash
# Start application + PostgreSQL
docker-compose up -d app db

# Apply database migrations
docker-compose exec app alembic upgrade head

# View logs
docker-compose logs -f app

# Optional: start Prometheus monitoring
docker-compose --profile monitoring up -d
```

## Database migrations

Run migrations before starting the application (or during a rolling deploy init-container):

```bash
# Apply all pending migrations
alembic upgrade head

# Generate a new migration after model changes
alembic revision --autogenerate -m "describe change"

# Rollback one step
alembic downgrade -1
```

## Kubernetes

A minimal Deployment pattern:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: clickup-generator
spec:
  replicas: 2
  template:
    spec:
      initContainers:
        - name: migrate
          image: yourrepo/clickup-generator:latest
          command: ["alembic", "upgrade", "head"]
          envFrom:
            - secretRef:
                name: clickup-generator-secrets
      containers:
        - name: app
          image: yourrepo/clickup-generator:latest
          command: ["gunicorn", "-w", "4", "-b", "0.0.0.0:5000", "src.server:app"]
          ports:
            - containerPort: 5000
            - containerPort: 8000   # Prometheus metrics
          envFrom:
            - secretRef:
                name: clickup-generator-secrets
          livenessProbe:
            httpGet:
              path: /health
              port: 5000
          readinessProbe:
            httpGet:
              path: /ready
              port: 5000
```

Store all secrets (`FLASK_SECRET_KEY`, `API_KEY`, `DATABASE_URL`) in a Kubernetes `Secret` or reference them from HashiCorp Vault / AWS Secrets Manager by setting `SECRETS_BACKEND=vault` or `SECRETS_BACKEND=aws`.

## Security checklist

- [ ] `FLASK_SECRET_KEY` set to a unique 64-char hex value
- [ ] `API_KEY` set and rotated regularly
- [ ] `DATABASE_URL` uses TLS (`sslmode=require` for Postgres)
- [ ] Container runs as a non-root user
- [ ] TLS termination at load balancer / ingress (not in Flask)
- [ ] `RATE_LIMIT_ENABLED=true`
- [ ] `JSON_LOGGING=true` and logs shipped to a SIEM
- [ ] Prometheus metrics scraped and dashboards configured
- [ ] Sentry DSN configured for error alerting

## Scaling

The application is stateless — horizontal scaling is supported. Rate limiting uses an in-memory token bucket, so with multiple replicas you should switch to the Redis-backed `RedisRateLimiter` (not yet implemented; see `src/security/rate_limiter.py`).
