# REST API Reference

Base URL: `http://localhost:5000`

## Authentication

When `API_KEY` is configured, all `/api/v1/*` endpoints require:

```
X-API-Key: <your-api-key>
```

Health and readiness endpoints (`/health`, `/ready`) are always unauthenticated.

## Endpoints

### `GET /health`

Returns service health status. Always returns 200 if the process is running.

**Response**
```json
{"status": "healthy", "service": "clickup-generator"}
```

---

### `GET /ready`

Kubernetes readiness probe.

**Response**
```json
{"status": "ready"}
```

---

### `POST /api/v1/accounts`

Generate a single ClickUp account.

**Headers**

| Header | Required | Description |
|---|---|---|
| `Content-Type` | Yes | `application/json` |
| `X-API-Key` | When configured | API key |
| `X-Correlation-ID` | No | Caller-supplied correlation ID |

**Request body**

```json
{
  "email": "user@example.com",
  "username": "user_abc123",
  "password": "SecurePassword1!",
  "workspace_name": "My Workspace"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `email` | string | Yes | Valid email address |
| `username` | string | Yes | 3–64 alphanumeric characters, `.`, `_`, `-` |
| `password` | string | Yes | ≥12 characters |
| `workspace_name` | string | No | ClickUp workspace name |

**Response — 201 Created**
```json
{
  "success": true,
  "data": {
    "account_id": "...",
    "email": "user@example.com",
    "username": "user_abc123",
    "duration_seconds": 12.5
  },
  "errors": []
}
```

**Response — 400 Bad Request**
```json
{
  "success": false,
  "data": null,
  "errors": [{"code": "VALIDATION_ERROR", "message": "..."}]
}
```

**Response — 401 Unauthorized**
```json
{
  "success": false,
  "errors": [{"code": "UNAUTHORIZED", "message": "Invalid or missing API key"}]
}
```

**Response — 429 Too Many Requests** — rate limit exceeded.

**Response — 500 Internal Server Error** — generation failed.

---

### `POST /api/v1/accounts/batch`

Generate multiple accounts.

**Request body**

```json
{"count": 5}
```

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `count` | integer | No | `1` | Number of accounts to create (1–100) |

**Response — 201 Created**
```json
{
  "success": true,
  "data": [
    {"success": true, "email": "..."},
    {"success": false, "error_code": "ACCOUNT_GENERATION_ERROR", "error_message": "..."}
  ]
}
```

**Response — 400 Bad Request** — `count` is not an integer between 1 and 100.

---

## Error codes

| Code | Description |
|---|---|
| `VALIDATION_ERROR` | Invalid request payload |
| `UNAUTHORIZED` | Missing or invalid API key |
| `RATE_LIMIT_ERROR` | Too many requests |
| `ACCOUNT_GENERATION_ERROR` | Account creation failed |
| `BROWSER_ERROR` | WebDriver failure |
| `INTERNAL_ERROR` | Unexpected server error |

---

<div align="center">

**💰 MONEYPACK 💰**

</div>
