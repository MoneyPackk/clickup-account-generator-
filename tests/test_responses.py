"""Unit tests for src/api/responses.py."""

import pytest

from src.api.responses import APIResponse, ErrorDetail
from src.core.exceptions import (
    AccountGenerationError,
    ClickUpGeneratorError,
    ValidationError,
)


@pytest.mark.unit
class TestAPIResponseOk:
    def test_ok_success_true(self):
        r = APIResponse.ok()
        assert r.success is True

    def test_ok_with_data(self):
        r = APIResponse.ok(data={"key": "val"})
        assert r.data == {"key": "val"}

    def test_ok_no_errors(self):
        r = APIResponse.ok()
        assert r.errors == []

    def test_ok_with_meta(self):
        r = APIResponse.ok(meta={"page": 1})
        assert r.meta == {"page": 1}


@pytest.mark.unit
class TestAPIResponseError:
    def test_error_success_false(self):
        r = APIResponse.error(code="ERR", message="bad")
        assert r.success is False

    def test_error_contains_detail(self):
        r = APIResponse.error(code="E001", message="msg", field="email")
        assert len(r.errors) == 1
        detail = r.errors[0]
        assert detail.code == "E001"
        assert detail.message == "msg"
        assert detail.field == "email"

    def test_error_data_none(self):
        r = APIResponse.error(code="X", message="y")
        assert r.data is None


@pytest.mark.unit
class TestAPIResponseFromException:
    def test_from_clickup_error(self):
        exc = AccountGenerationError("gen failed", step="flow")
        r = APIResponse.from_exception(exc)
        assert r.success is False
        assert r.errors[0].code == "ACCOUNT_GENERATION_ERROR"

    def test_from_validation_error(self):
        exc = ValidationError("bad field", field="email")
        r = APIResponse.from_exception(exc)
        assert r.errors[0].code == "VALIDATION_ERROR"

    def test_from_generic_exception(self):
        exc = RuntimeError("something broke")
        r = APIResponse.from_exception(exc)
        assert r.success is False
        assert r.errors[0].code == "INTERNAL_ERROR"

    def test_model_dump_serializable(self):
        r = APIResponse.ok(data={"x": 1})
        d = r.model_dump()
        assert isinstance(d, dict)
        assert d["success"] is True
