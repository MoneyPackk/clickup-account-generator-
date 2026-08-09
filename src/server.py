"""Flask HTTP server for REST API access to the generator."""

from functools import wraps
from typing import Any, Callable

from flask import Flask, jsonify, request

from src.account.generator import ClickUpAccountGenerator
from src.api.responses import APIResponse
from src.api.schemas import AccountPayload, GenerationResult
from src.core.config import Settings
from src.core.context import ContextManager, get_correlation_id
from src.core.exceptions import ClickUpGeneratorError
from src.core.logger import get_logger, setup_logging
from src.security.rate_limiter import RateLimiter
from src.security.validation import AccountValidator

logger = get_logger(__name__)
app = Flask(__name__)


def configure_app(settings: Settings = None) -> Flask:
    """Configure Flask app with security and logging."""
    settings = settings or Settings()
    setup_logging(settings)
    app.config["SETTINGS"] = settings
    app.config["SECRET_KEY"] = "change-me-in-production"
    return app


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
@with_correlation_id
def create_batch():
    """Generate multiple ClickUp accounts."""
    settings = app.config.get("SETTINGS", Settings())
    data = request.get_json(force=True, silent=True) or {}
    count = data.get("count", 1)

    try:
        AccountValidator().validate_username(str(count))
    except Exception:
        pass

    generator = ClickUpAccountGenerator(settings=settings)

    try:
        results = generator.generate_batch(count=count)
        response = APIResponse[list[GenerationResult]].ok(data=results)
        return jsonify(response.model_dump()), 201
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
