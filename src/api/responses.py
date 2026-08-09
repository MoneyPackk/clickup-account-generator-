"""Standardized API response wrappers."""

from typing import Any, Dict, Generic, Optional, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T")


class ErrorDetail(BaseModel):
    """Detailed error information."""

    code: str
    message: str
    field: Optional[str] = None
    details: Optional[Dict[str, Any]] = None


class APIResponse(BaseModel, Generic[T]):
    """Standard API response envelope."""

    success: bool = True
    data: Optional[T] = None
    errors: list[ErrorDetail] = Field(default_factory=list)
    correlation_id: Optional[str] = None
    meta: Optional[Dict[str, Any]] = None

    @classmethod
    def ok(cls, data: Optional[T] = None, meta: Optional[Dict[str, Any]] = None) -> "APIResponse[T]":
        """Create a successful API response."""
        return cls(success=True, data=data, meta=meta)

    @classmethod
    def error(
        cls,
        code: str,
        message: str,
        field: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None,
    ) -> "APIResponse[T]":
        """Create an error API response."""
        return cls(
            success=False,
            errors=[ErrorDetail(code=code, message=message, field=field, details=details)],
        )

    @classmethod
    def from_exception(cls, exc: Exception) -> "APIResponse[T]":
        """Create an error response from an exception."""
        from src.core.exceptions import ClickUpGeneratorError

        if isinstance(exc, ClickUpGeneratorError):
            return cls.error(
                code=exc.error_code,
                message=exc.message,
                details=exc.details,
            )
        return cls.error(
            code="INTERNAL_ERROR",
            message=str(exc) or "An unexpected error occurred",
        )
