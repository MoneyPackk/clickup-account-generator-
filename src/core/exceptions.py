"""Custom exception hierarchy for the ClickUp account generator."""

from typing import Any, Dict, Optional


class ClickUpGeneratorError(Exception):
    """Base exception for all application errors."""

    error_code: str = "INTERNAL_ERROR"

    def __init__(
        self,
        message: str,
        details: Optional[Dict[str, Any]] = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.details = details or {}


class AccountGenerationError(ClickUpGeneratorError):
    """Raised when account generation fails."""

    error_code = "ACCOUNT_GENERATION_ERROR"

    def __init__(
        self,
        message: str,
        step: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None,
    ) -> None:
        super().__init__(message, details)
        self.step = step


class BrowserError(ClickUpGeneratorError):
    """Raised when a browser/WebDriver operation fails."""

    error_code = "BROWSER_ERROR"

    def __init__(
        self,
        message: str,
        browser_error: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None,
    ) -> None:
        merged = dict(details or {})
        if browser_error:
            merged["browser_error"] = browser_error
        super().__init__(message, merged)


class RateLimitError(ClickUpGeneratorError):
    """Raised when a rate limit is exceeded."""

    error_code = "RATE_LIMIT_ERROR"

    def __init__(
        self,
        message: str,
        retry_after: int = 60,
        details: Optional[Dict[str, Any]] = None,
    ) -> None:
        super().__init__(message, details)
        self.retry_after = retry_after


class ValidationError(ClickUpGeneratorError):
    """Raised when input validation fails."""

    error_code = "VALIDATION_ERROR"

    def __init__(
        self,
        message: str,
        field: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None,
    ) -> None:
        super().__init__(message, details)
        self.field = field


class SecretRetrievalError(ClickUpGeneratorError):
    """Raised when a secret cannot be retrieved."""

    error_code = "SECRET_RETRIEVAL_ERROR"
