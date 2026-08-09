# Architecture Overview

## Layer diagram

```
┌────────────────────────────────────────────────┐
│  Presentation Layer                            │
│  src/server.py (Flask REST API)                │
│  src/cli/commands.py (Click CLI)               │
└────────────────────┬───────────────────────────┘
                     │
┌────────────────────▼───────────────────────────┐
│  Domain Layer                                  │
│  src/account/generator.py                      │
│    ClickUpAccountGenerator                     │
└──┬──────────────┬──────────────────────────────┘
   │              │
┌──▼──────────┐  ┌▼────────────────────────────┐
│ Browser     │  │ Database                    │
│ src/browser/│  │ src/database/               │
│  factory    │  │  models, repository         │
│  manager    │  │  (SQLAlchemy + Alembic)      │
└─────────────┘  └─────────────────────────────┘
   │
┌──▼──────────────────────────────────────────────┐
│  Infrastructure / Cross-cutting                 │
│  src/core/config.py     — Pydantic settings     │
│  src/core/logger.py     — structlog + JSON      │
│  src/core/metrics.py    — Prometheus counters   │
│  src/core/context.py    — correlation ID ctx    │
│  src/core/exceptions.py — exception hierarchy  │
│  src/security/          — validation, rate      │
│                           limiting, secrets     │
│  src/api/               — HTTP client, schemas  │
│  src/utils/             — helpers               │
└─────────────────────────────────────────────────┘
```

## Key components

### `src/core/config.py`
Pydantic-settings `Settings` tree. All configuration comes from environment variables or a `.env` file. Sub-settings objects (`DatabaseSettings`, `ClickUpSettings`, etc.) are composed into the root `Settings` class.

### `src/account/generator.py`
The domain core. `ClickUpAccountGenerator` orchestrates:
1. Rate limit check
2. Email/password generation and validation
3. Database record creation
4. Browser-based signup via Selenium
5. Audit logging and metrics recording

Dependencies are injected via the constructor, making the class testable in isolation.

### `src/browser/`
`ChromeDriverFactory` builds a `WebDriver` with production-safe Chrome flags. `WebDriverManager` wraps it in a context manager (`managed()`) that always calls `driver.quit()` on exit.

### `src/database/`
- `base.py` — Engine factory (SQLite-aware), `SessionLocal`, `get_db_context()` context manager
- `models.py` — `Account` and `AuditLog` SQLAlchemy models
- `repository.py` — Repository pattern: `AccountRepository`, `AuditRepository`
- `alembic/` — Alembic migration environment; run `alembic upgrade head` to apply migrations

### `src/security/`
- `validation.py` — `PasswordValidator`, `AccountValidator` (email, username, domain)
- `rate_limiter.py` — In-memory token bucket; pluggable (Redis backend stub)
- `secrets.py` — `SecretsManager` facade over `environment`, `vault`, and `aws` backends

### `src/api/`
- `schemas.py` — Pydantic request/response models
- `responses.py` — `APIResponse` envelope with `ok()`, `error()`, `from_exception()` helpers
- `client.py` — `ClickUpAPIClient` with retry via `tenacity`

### `src/server.py`
Flask application. Endpoints:
- `GET /health`, `GET /ready` — unauthenticated probes
- `POST /api/v1/accounts` — create one account (requires `X-API-Key` when configured)
- `POST /api/v1/accounts/batch` — create multiple accounts

### `src/cli/commands.py`
Click CLI with commands: `create`, `setup-db`, `status`, `secret`.

## Data flow for account creation

```
Client Request
  → API key check (require_api_key decorator)
  → Rate limit check (RateLimiter)
  → Payload validation (Pydantic AccountPayload)
  → ClickUpAccountGenerator.generate_account()
      → RateLimiter (domain-level)
      → PasswordValidator.generate()
      → AccountValidator.validate_email()
      → DB: AccountRepository.create() [status=CREATING]
      → AuditRepository.log(STARTED)
      → WebDriverManager.managed()
          → ChromeDriverFactory.create_driver()
          → _execute_signup_flow (Selenium)
      → DB: AccountRepository.set_clickup_metadata() [status=ACTIVE]
      → AuditRepository.log(SUCCEEDED)
      → Metrics: record_success()
  → APIResponse.ok(GenerationResult)
  → HTTP 201
```

---

<div align="center">

**💰 MONEYPACK 💰**

</div>
