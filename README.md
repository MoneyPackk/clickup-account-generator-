# ClickUp Account Generator (Enterprise Edition)

A production-ready, scalable Python service for automated ClickUp account generation. Built with enterprise-grade security, observability, and maintainability.

> **Legal Notice**: Automated account creation may violate the ClickUp terms of service. This tool is intended only for authorized testing and internal automation scenarios where ClickUp-assistive tooling is permitted.

## Features

- **Automated ClickUp signup** via Selenium WebDriver
- **Strong password generation** with configurable policy
- **Email/username validation** using Pydantic
- **PostgreSQL/SQLite persistence** with SQLAlchemy and Alembic migrations
- **Audit logging** for compliance
- **Rate limiting** via token bucket
- **Prometheus metrics** for monitoring
- **Structured logging** with correlation IDs
- **Multi-backend secrets** (environment, HashiCorp Vault, AWS Secrets Manager)
- **REST API** via Flask
- **Docker & Docker Compose** production setup
- **CI/CD** with GitHub Actions

## Table of Contents

- [Features](#features)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [CLI Usage](#cli-usage)
- [HTTP API](#http-api)
- [Running with Docker](#running-with-docker)
- [Database Migrations](#database-migrations)
- [Testing](#testing)
- [Architecture](#architecture)
- [Deployment](#deployment)
- [Contributing](#contributing)
- [License](#license)

## Quick Start

```bash
# Clone and enter repository
git clone https://github.com/MoneyPackk/clickup-account-generator-.git
cd clickup-account-generator-

# Create virtual environment
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements-dev.txt

# Copy environment template
cp .env.example .env
# Edit .env to add your configuration

# Create DB tables
python -m src.main setup-db

# Create a single account
python -m src.main create --email-domain example.com --count 1
```

## Configuration

All configuration is handled via environment variables or a `.env` file. See:

- [`.env.example`](./.env.example) for a full template
- [`docs/CONFIGURATION.md`](./docs/CONFIGURATION.md) for detailed options
- `config/dev.yaml`, `config/staging.yaml`, `config/prod.yaml` for environment presets

## CLI Usage

The tool exposes a Click-based CLI:

```bash
# Show help
python -m src.cli.commands --help

# Create accounts
python -m src.cli.commands create --email-domain company.com --count 5

# Create with table output
python -m src.cli.commands create --count 3 -o table

# Show config status
python -m src.cli.commands status

# Create DB tables
python -m src.cli.commands setup-db
```

Legacy CLI is also available:

```bash
python -m src.main --setup-db --count 1 --email-domain company.com
```

## HTTP API

Start the server:

```bash
python src/server.py
```

Create an account:

```bash
curl -X POST http://localhost:5000/api/v1/accounts \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "username": "user_123",
    "password": "SecurePassword1!",
    "workspace_name": "My Workspace"
  }'
```

See [`docs/API.md`](./docs/API.md) for the complete API reference.

## Running with Docker

```bash
# Start app + database
docker-compose up -d app db

# Run migrations
docker-compose exec app alembic upgrade head

# View logs
docker-compose logs -f app

# Optional Prometheus monitoring profile
docker-compose --profile monitoring up -d
```

## Database Migrations

Alembic is used for migrations:

```bash
# Create a new migration
alembic revision --autogenerate -m "add new table"

# Apply all migrations
alembic upgrade head

# Downgrade
alembic downgrade -1
```

## Testing

```bash
# Run unit tests
pytest -m unit

# Run integration tests (requires Postgres)
pytest -m integration

# With coverage
pytest --cov=src --cov-report=html
```

## Architecture

The project follows Clean Architecture principles with clear separation between infrastructure, domain, and presentation layers:

- `src/core/` - Configuration, logging, metrics, exceptions, context
- `src/security/` - Validation, secrets, rate limiting
- `src/database/` - Models, repository pattern, migrations
- `src/browser/` - Selenium driver factory and lifecycle manager
- `src/api/` - ClickUp API client and reusable schemas
- `src/account/` - Account generation domain logic
- `src/server.py` - Flask HTTP API
- `src/cli/commands.py` - CLI entrypoint

See [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) for deeper design details.

## Deployment

See [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) for full deployment instructions, including Kubernetes examples, secret management, and production security checklist.

## Monitoring

- Prometheus metrics exposed on port `8000` by default
- Health: `GET /health`
- Readiness: `GET /ready`
- Metrics: `GET /metrics` (when Prometheus server is enabled)

## Contributing

See [`docs/CONTRIBUTING.md`](./docs/CONTRIBUTING.md) for development setup, code standards, and pull request process.

## License

This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.

## Disclaimer

Use responsibly and in compliance with applicable laws and platform terms of service.
