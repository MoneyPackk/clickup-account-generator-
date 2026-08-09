"""Enterprise structured logging configuration."""

import logging
import sys
from typing import Any, Dict, Optional

import structlog

from .config import Settings
from .context import get_correlation_id


class _JsonFormatter:
    """Stub fallback if python-json-logger is not installed."""

    def __init__(self, *args, **kwargs):
        pass

    def format(self, record):
        return record.getMessage()


try:
    from pythonjsonlogger import jsonlogger
    JsonFormatter = jsonlogger.JsonFormatter
except Exception:  # pragma: no cover
    JsonFormatter = _JsonFormatter


def add_correlation_id(logger, method_name, event_dict):
    """Structlog processor to inject correlation ID into log events."""
    event_dict["correlation_id"] = get_correlation_id()
    return event_dict


def add_environment(logger, method_name, event_dict):
    """Structlog processor to inject environment into log events."""
    event_dict["environment"] = "development"
    return event_dict


def setup_logging(settings: Optional[Settings] = None) -> None:
    """Configure structured logging for the application."""
    settings = settings or Settings()

    shared_processors = [
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        add_correlation_id,
        structlog.stdlib.ExtraAdder(),
    ]

    if settings.json_logging:
        formatter = JsonFormatter(
            "%(timestamp)s %(level)s %(name)s %(message)s %(correlation_id)s",
            rename_fields={"levelname": "level", "asctime": "timestamp"},
        )
        processors = shared_processors + [
            structlog.processors.dict_tracebacks,
            structlog.processors.JSONRenderer(),
        ]
    else:
        formatter = logging.Formatter(
            "%(asctime)s - [%(correlation_id)s] - %(name)s - %(levelname)s - %(message)s",
        )
        processors = shared_processors + [
            structlog.dev.ConsoleRenderer(colors=True),
        ]

    structlog.configure(
        processors=processors,
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )

    root_logger = logging.getLogger()
    root_logger.setLevel(getattr(logging, settings.log_level.upper()))

    # Remove existing handlers
    for handler in root_logger.handlers[:]:
        root_logger.removeHandler(handler)

    stream_handler = logging.StreamHandler(sys.stdout)
    stream_handler.setFormatter(formatter)
    root_logger.addHandler(stream_handler)

    app_logger = logging.getLogger("clickup_generator")
    app_logger.setLevel(getattr(logging, settings.log_level.upper()))

    # Suppress noisy third-party loggers
    logging.getLogger("selenium").setLevel(logging.WARNING)
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    logging.getLogger("webdriver_manager").setLevel(logging.WARNING)


def get_logger(name: str) -> structlog.stdlib.BoundLogger:
    """Return a structured logger instance."""
    return structlog.get_logger(name)
