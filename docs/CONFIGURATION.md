# Configuration Reference

All configuration is supplied via environment variables or a `.env` file in the project root.
The `Settings` class (in `src/core/config.py`) loads values using [pydantic-settings](https://docs.pydantic.dev/latest/concepts/pydantic_settings/).

## Application

| Variable | Default | Description |
|---|---|---|
| `ENVIRONMENT` | `development` | Runtime environment label (`development`, `staging`, `production`) |
| `DEBUG` | `false` | Enable debug mode |
| `LOG_LEVEL` | `INFO` | Logging level (`DEBUG`, `INFO`, `WARNING`, `ERROR`) |
| `JSON_LOGGING` | `false` | Output logs as JSON (recommended for production) |

## Flask / API Security

| Variable | Default | Description |
|---|---|---|
| `FLASK_SECRET_KEY` | *(required)* | Secret key for Flask session signing. Generate with `python -c "import secrets; print(secrets.token_hex(32))"`. **Must** be set before starting the server. |
| `API_KEY` | *(empty — disabled)* | When set, all `/api/v1/*` requests must include `X-API-Key: <value>`. Leave empty in development to disable auth. |

## Database

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `sqlite:///./clickup_generator.db` | SQLAlchemy connection URL. Use PostgreSQL in production: `******host/db` |
| `DATABASE_POOL_SIZE` | `5` | Connection pool size (ignored for SQLite) |
| `DATABASE_POOL_OVERFLOW` | `10` | Max overflow connections (ignored for SQLite) |
| `DATABASE_POOL_RECYCLE` | `3600` | Connection recycle interval in seconds (ignored for SQLite) |
| `DATABASE_ECHO` | `false` | Log all SQL statements |

## ClickUp

| Variable | Default | Description |
|---|---|---|
| `CLICKUP_BASE_URL` | `https://app.clickup.com` | Base URL of the ClickUp application |
| `CLICKUP_SIGNUP_PATH` | `/signup` | Path to the signup page |
| `CLICKUP_DASHBOARD_PATH` | `/dashboard` | Path used to detect successful login |
| `CLICKUP_TIMEOUT` | `30` | Selenium wait timeout in seconds |
| `CLICKUP_RETRIES` | `3` | Number of HTTP retry attempts |
| `CLICKUP_RETRY_BACKOFF` | `2.0` | Exponential backoff multiplier |
| `CLICKUP_HEADLESS` | `true` | Run Chrome in headless mode |

## Chrome / WebDriver

| Variable | Default | Description |
|---|---|---|
| `CHROME_BINARY` | *(auto)* | Path to the Chrome binary |
| `CHROME_DRIVER_PATH` | *(auto)* | Path to the ChromeDriver binary |
| `CHROME_DISABLE_GPU` | `true` | Pass `--disable-gpu` flag |
| `CHROME_NO_SANDBOX` | `true` | Pass `--no-sandbox` flag (required in containers) |
| `CHROME_DISABLE_DEV_SHM` | `true` | Pass `--disable-dev-shm-usage` (required in containers) |

## Password Policy

| Variable | Default | Description |
|---|---|---|
| `PASSWORD_MIN_LENGTH` | `16` | Minimum generated password length |
| `PASSWORD_MAX_LENGTH` | `64` | Maximum generated password length |
| `PASSWORD_REQUIRE_UPPERCASE` | `true` | Require at least one uppercase letter |
| `PASSWORD_REQUIRE_LOWERCASE` | `true` | Require at least one lowercase letter |
| `PASSWORD_REQUIRE_DIGITS` | `true` | Require at least one digit |
| `PASSWORD_REQUIRE_SPECIAL` | `true` | Require at least one special character |
| `PASSWORD_SPECIAL_CHARS` | `!@#$%^&*()_+-=[]{}|;:,.<>?` | Allowed special characters |

## Rate Limiting

| Variable | Default | Description |
|---|---|---|
| `RATE_LIMIT_ENABLED` | `true` | Enable/disable rate limiting |
| `RATE_LIMIT_REQUESTS` | `100` | Maximum requests per window |
| `RATE_LIMIT_WINDOW` | `3600` | Window duration in seconds |
| `BURST_LIMIT` | `10` | Token bucket burst capacity |

## Secrets Management

| Variable | Default | Description |
|---|---|---|
| `SECRETS_BACKEND` | `environment` | Backend: `environment`, `vault`, or `aws` |
| `VAULT_ADDR` | `http://localhost:8200` | HashiCorp Vault address |
| `VAULT_TOKEN` | *(empty)* | Vault token |
| `VAULT_PATH` | `secret/clickup-generator` | KV v2 path in Vault |
| `AWS_REGION` | `us-east-1` | AWS region for Secrets Manager |
| `AWS_SECRET_NAME` | `clickup-generator` | AWS Secrets Manager secret name |

## Monitoring

| Variable | Default | Description |
|---|---|---|
| `METRICS_ENABLED` | `true` | Enable Prometheus metrics |
| `PROMETHEUS_PORT` | `8000` | Port for the Prometheus metrics HTTP server |
| `SENTRY_DSN` | *(empty)* | Sentry DSN for error tracking |
