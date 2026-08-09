<div align="center">

```
███╗   ███╗ ██████╗ ███╗   ██╗███████╗██╗   ██╗██████╗  █████╗  ██████╗██╗  ██╗
████╗ ████║██╔═══██╗████╗  ██║██╔════╝╚██╗ ██╔╝██╔══██╗██╔══██╗██╔════╝██║ ██╔╝
██╔████╔██║██║   ██║██╔██╗ ██║█████╗   ╚████╔╝ ██████╔╝███████║██║     █████╔╝
██║╚██╔╝██║██║   ██║██║╚██╗██║██╔══╝    ╚██╔╝  ██╔═══╝ ██╔══██║██║     ██╔═██╗
██║ ╚═╝ ██║╚██████╔╝██║ ╚████║███████╗   ██║   ██║     ██║  ██║╚██████╗██║  ██╗
╚═╝     ╚═╝ ╚═════╝ ╚═╝  ╚═══╝╚══════╝   ╚═╝   ╚═╝     ╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝
```

### 💰 A project by **MONEYPACK** 💰

---

```
 ██████╗██╗     ██╗ ██████╗██╗  ██╗██╗   ██╗██████╗
██╔════╝██║     ██║██╔════╝██║ ██╔╝██║   ██║██╔══██╗
██║     ██║     ██║██║     █████╔╝ ██║   ██║██████╔╝
██║     ██║     ██║██║     ██╔═██╗ ██║   ██║██╔═══╝
╚██████╗███████╗██║╚██████╗██║  ██╗╚██████╔╝██║
 ╚═════╝╚══════╝╚═╝ ╚═════╝╚═╝  ╚═╝ ╚═════╝ ╚═╝
```

# ⚡ ClickUp Account Generator — Enterprise Edition

**Automated · Secure · Observable · Production-Ready**

[![Python](https://img.shields.io/badge/Python-3.11%2B-blue?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)
[![Flask](https://img.shields.io/badge/Flask-REST%20API-black?style=for-the-badge&logo=flask&logoColor=white)](https://flask.palletsprojects.com/)
[![Selenium](https://img.shields.io/badge/Selenium-WebDriver-43B02A?style=for-the-badge&logo=selenium&logoColor=white)](https://www.selenium.dev/)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Database-336791?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Prometheus](https://img.shields.io/badge/Prometheus-Metrics-E6522C?style=for-the-badge&logo=prometheus&logoColor=white)](https://prometheus.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)](./LICENSE)

> 🔐 **Legal Notice**: Automated account creation may violate the ClickUp Terms of Service. This tool is intended **only** for authorized testing and internal automation scenarios where automated tooling is explicitly permitted.

</div>

---

## ✨ Features

| Category | What's Included |
|---|---|
| 🤖 **Automation** | Selenium WebDriver-based signup flow |
| 🔑 **Security** | Strong password generation, API key auth, constant-time comparison |
| ✅ **Validation** | Email/username validation via Pydantic & email-validator |
| 🗄️ **Persistence** | PostgreSQL/SQLite via SQLAlchemy + Alembic migrations |
| 📋 **Audit** | Full audit log trail for every action |
| 🚦 **Rate Limiting** | Token bucket rate limiter per IP and correlation ID |
| 📊 **Observability** | Prometheus metrics, structured JSON logging, correlation IDs |
| 🔒 **Secrets** | Env vars, HashiCorp Vault, or AWS Secrets Manager |
| 🌐 **REST API** | Flask HTTP API with OpenAPI-style responses |
| 🐳 **Docker** | Full Docker Compose stack with monitoring profile |
| ⚙️ **CI/CD** | GitHub Actions pipeline |

---

## 📚 Table of Contents

- [✨ Features](#-features)
- [🚀 Quick Start](#-quick-start)
- [⚙️ Configuration](#️-configuration)
- [🖥️ CLI Usage](#️-cli-usage)
- [🌐 HTTP API](#-http-api)
- [🐳 Running with Docker](#-running-with-docker)
- [🗄️ Database Migrations](#️-database-migrations)
- [🧪 Testing](#-testing)
- [🏗️ Architecture](#️-architecture)
- [🚢 Deployment](#-deployment)
- [🤝 Contributing](#-contributing)
- [📄 License](#-license)

---

## 🚀 Quick Start

```bash
# 1. Clone the repo
git clone https://github.com/MoneyPackk/clickup-account-generator-.git
cd clickup-account-generator-

# 2. Set up your Python environment
python -m venv venv
source venv/bin/activate       # Windows: venv\Scripts\activate
pip install -r requirements-dev.txt

# 3. Configure
cp .env.example .env
# ✏️  Edit .env — set FLASK_SECRET_KEY, API_KEY, DATABASE_URL, etc.

# 4. Initialise the database
python -m src.cli.commands setup-db

# 5. Generate your first account
python -m src.cli.commands create --email-domain example.com --count 1
```

---

## ⚙️ Configuration

All configuration is driven by environment variables or a `.env` file.

| Resource | Purpose |
|---|---|
| [`.env.example`](./.env.example) | Full variable template |
| [`docs/CONFIGURATION.md`](./docs/CONFIGURATION.md) | Detailed option reference |

**Key variables to set before running:**

```bash
FLASK_SECRET_KEY=<strong-random-value>   # Required — app will refuse to start without it
API_KEY=<your-api-key>                   # Recommended — secures all API endpoints
DATABASE_URL=postgresql://...            # Recommended for production (defaults to SQLite)
ENVIRONMENT=production
```

---

## 🖥️ CLI Usage

```bash
# Show all commands
python -m src.cli.commands --help

# Generate accounts
python -m src.cli.commands create --email-domain company.com --count 5

# Output as a table
python -m src.cli.commands create --count 3 -o table

# Check config / connectivity status
python -m src.cli.commands status

# Bootstrap the database
python -m src.cli.commands setup-db
```

<details>
<summary>Legacy CLI (backward-compat)</summary>

```bash
python -m src.main --setup-db --count 1 --email-domain company.com
```

</details>

---

## 🌐 HTTP API

Start the server:

```bash
python src/server.py
```

### Create an account

```bash
curl -X POST http://localhost:5000/api/v1/accounts \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "email": "user@example.com",
    "username": "user_123"
  }'
```

### Batch create

```bash
curl -X POST http://localhost:5000/api/v1/accounts/batch \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{"count": 5}'
```

### Health checks

```bash
curl http://localhost:5000/health    # liveness
curl http://localhost:5000/ready     # readiness
```

📖 Full reference → [`docs/API.md`](./docs/API.md)

---

## 🐳 Running with Docker

```bash
# Start app + Postgres
docker-compose up -d app db

# Apply migrations
docker-compose exec app alembic upgrade head

# Stream logs
docker-compose logs -f app

# Add Prometheus + Grafana monitoring
docker-compose --profile monitoring up -d
```

---

## 🗄️ Database Migrations

```bash
# Auto-generate a migration from model changes
alembic revision --autogenerate -m "describe your change"

# Apply all pending migrations
alembic upgrade head

# Roll back one step
alembic downgrade -1
```

---

## 🧪 Testing

```bash
# Unit tests only (fast, no external deps)
pytest -m unit

# Integration tests (requires a running Postgres)
pytest -m integration

# Full suite with coverage report
pytest --cov=src --cov-report=html
open htmlcov/index.html
```

---

## 🏗️ Architecture

```
src/
├── core/        # Config, logging, metrics, exceptions, request context
├── security/    # Validation, secrets backends, rate limiter
├── database/    # SQLAlchemy models, repository pattern, Alembic
├── browser/     # Selenium driver factory & lifecycle management
├── api/         # ClickUp API client, schemas, response helpers
├── account/     # Account generation domain logic (core use-case)
├── cli/         # Click-based CLI entrypoint
└── server.py    # Flask REST API
```

The project follows **Clean Architecture** — infrastructure is kept at the edges, business logic stays in `src/account/` and `src/core/`.

📖 Deep dive → [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)

---

## 🚢 Deployment

📖 [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) covers:

- Docker & docker-compose
- Kubernetes manifests
- Secret management (Vault / AWS)
- Production security checklist

---

## 📊 Monitoring

| Endpoint | Purpose |
|---|---|
| `GET /health` | Liveness probe |
| `GET /ready` | Readiness probe |
| `:8000/metrics` | Prometheus scrape target |

Grafana dashboards can be connected to the Prometheus instance started via `docker-compose --profile monitoring up`.

---

## 🤝 Contributing

See [`docs/CONTRIBUTING.md`](./docs/CONTRIBUTING.md) for:
- Dev environment setup
- Code style & standards
- Pull request process

---

## 📄 License

Released under the **MIT License** — see [`LICENSE`](./LICENSE) for details.

---

<div align="center">

```
💰  MONEYPACK  💰
```

**Built & maintained by [MONEYPACK](https://github.com/MoneyPackk)**

*© MONEYPACK — Use responsibly and in compliance with all applicable laws and platform terms of service.*

</div>
