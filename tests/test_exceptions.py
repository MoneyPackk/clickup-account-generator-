"""Unit tests for src/core/exceptions.py."""

import pytest

from src.core.exceptions import (
    AccountGenerationError,
    BrowserError,
    ClickUpGeneratorError,
    RateLimitError,
    SecretRetrievalError,
    ValidationError,
)


@pytest.mark.unit
class TestExceptionHierarchy:
    def test_all_inherit_from_base(self):
        for cls in [AccountGenerationError, BrowserError, RateLimitError,
                    ValidationError, SecretRetrievalError]:
            assert issubclass(cls, ClickUpGeneratorError)

    def test_clickup_generator_error_is_exception(self):
        assert issubclass(ClickUpGeneratorError, Exception)

    def test_message_stored(self):
        exc = ClickUpGeneratorError("test message")
        assert exc.message == "test message"

    def test_details_default_empty(self):
        exc = ClickUpGeneratorError("msg")
        assert exc.details == {}

    def test_details_stored(self):
        exc = ClickUpGeneratorError("msg", details={"k": "v"})
        assert exc.details == {"k": "v"}


@pytest.mark.unit
class TestAccountGenerationError:
    def test_error_code(self):
        exc = AccountGenerationError("failed")
        assert exc.error_code == "ACCOUNT_GENERATION_ERROR"

    def test_step_stored(self):
        exc = AccountGenerationError("failed", step="signup_flow")
        assert exc.step == "signup_flow"

    def test_step_optional(self):
        exc = AccountGenerationError("failed")
        assert exc.step is None


@pytest.mark.unit
class TestRateLimitError:
    def test_error_code(self):
        exc = RateLimitError("too fast")
        assert exc.error_code == "RATE_LIMIT_ERROR"

    def test_retry_after_default(self):
        exc = RateLimitError("too fast")
        assert exc.retry_after == 60

    def test_retry_after_custom(self):
        exc = RateLimitError("too fast", retry_after=120)
        assert exc.retry_after == 120


@pytest.mark.unit
class TestValidationError:
    def test_error_code(self):
        exc = ValidationError("bad input")
        assert exc.error_code == "VALIDATION_ERROR"

    def test_field_stored(self):
        exc = ValidationError("bad input", field="email")
        assert exc.field == "email"

    def test_field_optional(self):
        exc = ValidationError("bad input")
        assert exc.field is None


@pytest.mark.unit
class TestBrowserError:
    def test_error_code(self):
        exc = BrowserError("driver failed")
        assert exc.error_code == "BROWSER_ERROR"

    def test_browser_error_detail_included(self):
        exc = BrowserError("driver failed", browser_error="timeout")
        assert exc.details["browser_error"] == "timeout"
