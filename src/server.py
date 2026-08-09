"""Flask HTTP server for REST API access to the generator."""

import secrets
from functools import wraps
from typing import Any, Callable

from flask import Flask, jsonify, request

from src.account.generator import ClickUpAccountGenerator
from src.api.responses import APIResponse
from src.api.schemas import AccountPayload, GenerationResult
from src.core.config import Settings
from src.core.context import ContextManager, get_correlation_id
from src.core.exceptions import ClickUpGeneratorError, ValidationError
from src.core.logger import get_logger, setup_logging
from src.security.rate_limiter import RateLimiter

logger = get_logger(__name__)
app = Flask(__name__)


def configure_app(settings: Settings = None) -> Flask:
    """Configure Flask app with security and logging."""
    settings = settings or Settings()
    setup_logging(settings)
    app.config["SETTINGS"] = settings
    # Require an explicitly configured secret key; refuse to start with an empty one.
    if not settings.flask_secret_key:
        raise RuntimeError(
            "FLASK_SECRET_KEY environment variable must be set to a strong random value."
        )
    app.config["SECRET_KEY"] = settings.flask_secret_key
    return app


def require_api_key(f: Callable[..., Any]) -> Callable[..., Any]:
    """Decorator that enforces API key authentication on protected endpoints."""
    @wraps(f)
    def wrapper(*args, **kwargs):
        settings: Settings = app.config.get("SETTINGS", Settings())
        configured_key = settings.api_key
        if not configured_key:
            # API key enforcement is disabled — allow through (development mode).
            return f(*args, **kwargs)
        provided_key = request.headers.get("X-API-Key")
        # Reject immediately if the header is absent to avoid leaking timing
        # information about the key length via compare_digest.
        if not provided_key:
            return jsonify({"success": False, "errors": [{"code": "UNAUTHORIZED", "message": "Invalid or missing API key"}]}), 401
        # Use constant-time comparison to prevent timing attacks.
        if not secrets.compare_digest(provided_key, configured_key):
            return jsonify({"success": False, "errors": [{"code": "UNAUTHORIZED", "message": "Invalid or missing API key"}]}), 401
        return f(*args, **kwargs)
    return wrapper


def with_correlation_id(f: Callable[..., Any]) -> Callable[..., Any]:
    """Decorator to ensure correlation ID for each request."""
    @wraps(f)
    def wrapper(*args, **kwargs):
        correlation_id = request.headers.get("X-Correlation-ID") or get_correlation_id()
        with ContextManager(correlation_id=correlation_id):
            return f(*args, **kwargs)
    return wrapper


@app.route("/health", methods=["GET"])
def health():
    """Health check endpoint."""
    return jsonify({"status": "healthy", "service": "clickup-generator"}), 200


@app.route("/ready", methods=["GET"])
def ready():
    """Readiness probe endpoint."""
    return jsonify({"status": "ready"}), 200


@app.route("/api/v1/accounts", methods=["POST"])
@require_api_key
@with_correlation_id
def create_account():
    """Generate a new ClickUp account."""
    settings = app.config.get("SETTINGS", Settings())
    rate_limiter = RateLimiter(settings.rate_limit)
    try:
        rate_limiter.check_rate_limit(f"http:{request.remote_addr}")
    except ClickUpGeneratorError as exc:
        response = APIResponse[GenerationResult].from_exception(exc)
        return jsonify(response.model_dump()), 429

    try:
        data = request.get_json(force=True, silent=True) or {}
        payload = AccountPayload(**data)
    except Exception as exc:
        response = APIResponse[GenerationResult].error(
            code="VALIDATION_ERROR",
            message=str(exc),
        )
        return jsonify(response.model_dump()), 400

    generator = ClickUpAccountGenerator(
        settings=settings,
        email_domain=payload.email.split("@")[1],
    )

    try:
        result = generator.generate_account(
            username=payload.username,
            enable_two_factor=False,
        )
        response = APIResponse[GenerationResult].ok(data=result)
        return jsonify(response.model_dump()), 201
    except ClickUpGeneratorError as exc:
        response = APIResponse[GenerationResult].from_exception(exc)
        return jsonify(response.model_dump()), 500


@app.route("/api/v1/accounts/batch", methods=["POST"])
@require_api_key
@with_correlation_id
def create_batch():
    """Generate multiple ClickUp accounts."""
    settings = app.config.get("SETTINGS", Settings())
    data = request.get_json(force=True, silent=True) or {}
    count = data.get("count", 1)

    if not isinstance(count, int) or count < 1 or count > 100:
        response = APIResponse[list].error(
            code="VALIDATION_ERROR",
            message="count must be an integer between 1 and 100",
            field="count",
        )
        return jsonify(response.model_dump()), 400

    generator = ClickUpAccountGenerator(settings=settings)

    try:
        results = generator.generate_batch(count=count)
        response = APIResponse[list[GenerationResult]].ok(data=results)
        return jsonify(response.model_dump()), 201
    except ValidationError as exc:
        response = APIResponse.from_exception(exc)
        return jsonify(response.model_dump()), 400
    except Exception as exc:
        response = APIResponse.from_exception(exc)
        return jsonify(response.model_dump()), 500


@app.errorhandler(Exception)
def handle_exception(exc):
    """Global error handler."""
    logger.exception("Unhandled exception", exc=str(exc))
    response = APIResponse.from_exception(exc)
    return jsonify(response.model_dump()), 500


if __name__ == "__main__":
    configure_app()
    app.run(host="0.0.0.0", port=5000, debug=False)
