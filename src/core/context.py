"""Request context management with correlation ID support."""

import uuid
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Optional

_correlation_id: ContextVar[str] = ContextVar("correlation_id", default="")


def get_correlation_id() -> str:
    """Return the current correlation ID, generating one if absent."""
    cid = _correlation_id.get()
    if not cid:
        cid = uuid.uuid4().hex
        _correlation_id.set(cid)
    return cid


def set_correlation_id(correlation_id: str) -> None:
    """Set the correlation ID for the current context."""
    _correlation_id.set(correlation_id)


class ContextManager:
    """Context manager that sets and clears the correlation ID."""

    def __init__(self, correlation_id: Optional[str] = None) -> None:
        self._correlation_id = correlation_id or uuid.uuid4().hex
        self._token = None

    def __enter__(self) -> "ContextManager":
        self._token = _correlation_id.set(self._correlation_id)
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        if self._token is not None:
            _correlation_id.reset(self._token)
