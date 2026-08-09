"""Unit tests for src/server.py Flask endpoints."""

import pytest
from unittest.mock import MagicMock, patch

from src.api.schemas import GenerationResult
from src.core.config import Settings
from src.server import app, configure_app


def _make_settings(api_key=None, flask_secret_key="test-secret") -> Settings:
    s = Settings()
    s.api_key = api_key
    s.flask_secret_key = flask_secret_key
    return s


@pytest.fixture()
def client_no_auth():
    """Flask test client with no API key configured (open access)."""
    settings = _make_settings(api_key=None)
    with patch("src.server.setup_logging"):
        configure_app(settings)
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


@pytest.fixture()
def client_with_auth():
    """Flask test client with API key 'test-api-key'."""
    settings = _make_settings(api_key="test-api-key")
    with patch("src.server.setup_logging"):
        configure_app(settings)
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


# ---------------------------------------------------------------------------
# Health / readiness
# ---------------------------------------------------------------------------

@pytest.mark.unit
class TestHealthEndpoints:
    def test_health(self, client_no_auth):
        resp = client_no_auth.get("/health")
        assert resp.status_code == 200
        assert resp.json["status"] == "healthy"

    def test_ready(self, client_no_auth):
        resp = client_no_auth.get("/ready")
        assert resp.status_code == 200
        assert resp.json["status"] == "ready"


# ---------------------------------------------------------------------------
# API key enforcement
# ---------------------------------------------------------------------------

@pytest.mark.unit
class TestApiKeyAuth:
    def test_no_key_configured_allows_through(self, client_no_auth):
        """When API_KEY is not set, all requests are allowed."""
        mock_result = GenerationResult(
            success=True, email="u@example.com", username="u"
        )
        with patch("src.server.ClickUpAccountGenerator") as MockGen:
            MockGen.return_value.generate_account.return_value = mock_result
            resp = client_no_auth.post(
                "/api/v1/accounts",
                json={"email": "u@example.com", "username": "u_abc", "password": "P@ssw0rd!1234567"},
            )
        assert resp.status_code != 401

    def test_wrong_api_key_returns_401(self, client_with_auth):
        resp = client_with_auth.post(
            "/api/v1/accounts",
            json={"email": "u@example.com", "username": "u_abc", "password": "P@ssw0rd!1234567"},
            headers={"X-API-Key": "wrong-key"},
        )
        assert resp.status_code == 401

    def test_missing_api_key_returns_401(self, client_with_auth):
        resp = client_with_auth.post(
            "/api/v1/accounts",
            json={"email": "u@example.com", "username": "u_abc", "password": "P@ssw0rd!1234567"},
        )
        assert resp.status_code == 401

    def test_correct_api_key_allowed(self, client_with_auth):
        mock_result = GenerationResult(
            success=True, email="u@example.com", username="u_abc"
        )
        with patch("src.server.ClickUpAccountGenerator") as MockGen:
            MockGen.return_value.generate_account.return_value = mock_result
            resp = client_with_auth.post(
                "/api/v1/accounts",
                json={"email": "u@example.com", "username": "u_abc", "password": "P@ssw0rd!1234567"},
                headers={"X-API-Key": "test-api-key"},
            )
        assert resp.status_code in (201, 500)  # not 401

    def test_health_bypasses_api_key(self, client_with_auth):
        """Health check must not require an API key."""
        resp = client_with_auth.get("/health")
        assert resp.status_code == 200


# ---------------------------------------------------------------------------
# POST /api/v1/accounts
# ---------------------------------------------------------------------------

@pytest.mark.unit
class TestCreateAccount:
    def test_valid_payload_returns_201(self, client_no_auth):
        mock_result = GenerationResult(
            success=True,
            email="user@example.com",
            username="user_xyz",
        )
        with patch("src.server.ClickUpAccountGenerator") as MockGen:
            MockGen.return_value.generate_account.return_value = mock_result
            resp = client_no_auth.post(
                "/api/v1/accounts",
                json={
                    "email": "user@example.com",
                    "username": "user_xyz",
                    "password": "P@ssw0rd!123456",
                },
            )
        assert resp.status_code == 201
        assert resp.json["success"] is True

    def test_invalid_payload_returns_400(self, client_no_auth):
        resp = client_no_auth.post(
            "/api/v1/accounts",
            json={"email": "not-an-email", "username": "x", "password": "short"},
        )
        assert resp.status_code == 400
        assert resp.json["success"] is False

    def test_missing_body_returns_400(self, client_no_auth):
        resp = client_no_auth.post("/api/v1/accounts", json={})
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# POST /api/v1/accounts/batch
# ---------------------------------------------------------------------------

@pytest.mark.unit
class TestCreateBatch:
    def test_valid_count_returns_201(self, client_no_auth):
        mock_results = [
            GenerationResult(success=True, email=f"u{i}@x.com", username=f"u{i}")
            for i in range(3)
        ]
        with patch("src.server.ClickUpAccountGenerator") as MockGen:
            MockGen.return_value.generate_batch.return_value = mock_results
            resp = client_no_auth.post("/api/v1/accounts/batch", json={"count": 3})
        assert resp.status_code == 201
        assert resp.json["success"] is True

    def test_count_zero_returns_400(self, client_no_auth):
        resp = client_no_auth.post("/api/v1/accounts/batch", json={"count": 0})
        assert resp.status_code == 400

    def test_count_over_100_returns_400(self, client_no_auth):
        resp = client_no_auth.post("/api/v1/accounts/batch", json={"count": 101})
        assert resp.status_code == 400

    def test_count_string_returns_400(self, client_no_auth):
        resp = client_no_auth.post("/api/v1/accounts/batch", json={"count": "five"})
        assert resp.status_code == 400

    def test_missing_count_defaults_to_1(self, client_no_auth):
        mock_results = [GenerationResult(success=True, email="u@x.com", username="u")]
        with patch("src.server.ClickUpAccountGenerator") as MockGen:
            MockGen.return_value.generate_batch.return_value = mock_results
            resp = client_no_auth.post("/api/v1/accounts/batch", json={})
        assert resp.status_code == 201


# ---------------------------------------------------------------------------
# configure_app safety check
# ---------------------------------------------------------------------------

@pytest.mark.unit
class TestConfigureApp:
    def test_empty_secret_key_raises(self):
        settings = _make_settings(flask_secret_key="")
        with patch("src.server.setup_logging"):
            with pytest.raises(RuntimeError, match="FLASK_SECRET_KEY"):
                configure_app(settings)
