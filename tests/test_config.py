"""Unit tests for src/core/config.py."""

import os

import pytest

from src.core.config import (
    ClickUpSettings,
    DatabaseSettings,
    PasswordSettings,
    RateLimitSettings,
    Settings,
)


@pytest.mark.unit
class TestDatabaseSettings:
    def test_default_sqlite_url(self):
        s = DatabaseSettings()
        assert "sqlite" in s.url

    def test_override_via_env(self, monkeypatch):
        monkeypatch.setenv("DATABASE_URL", "******localhost/db")
        s = DatabaseSettings()
        assert s.url == "******localhost/db"


@pytest.mark.unit
class TestClickUpSettings:
    def test_default_base_url(self):
        s = ClickUpSettings()
        assert "clickup.com" in s.base_url

    def test_headless_default_true(self):
        s = ClickUpSettings()
        assert s.headless is True


@pytest.mark.unit
class TestPasswordSettings:
    def test_defaults(self):
        s = PasswordSettings()
        assert s.min_length == 16
        assert s.require_uppercase is True
        assert s.require_special is True


@pytest.mark.unit
class TestRateLimitSettings:
    def test_enabled_by_default(self):
        s = RateLimitSettings()
        assert s.enabled is True

    def test_burst_default(self):
        s = RateLimitSettings()
        assert s.burst == 10


@pytest.mark.unit
class TestSettings:
    def test_default_environment(self):
        s = Settings()
        assert s.environment == "development"

    def test_clickup_signup_url(self):
        s = Settings()
        url = s.clickup_signup_url
        assert url.startswith("https://")
        assert "signup" in url

    def test_nested_settings_exist(self):
        s = Settings()
        assert hasattr(s, "database")
        assert hasattr(s, "clickup")
        assert hasattr(s, "chrome")
        assert hasattr(s, "password")
        assert hasattr(s, "rate_limit")
        assert hasattr(s, "secrets")

    def test_api_key_default_none(self):
        s = Settings()
        assert s.api_key is None

    def test_flask_secret_key_default_empty(self):
        s = Settings()
        assert s.flask_secret_key == ""

    def test_api_key_from_env(self, monkeypatch):
        monkeypatch.setenv("API_KEY", "super-secret")
        s = Settings()
        assert s.api_key == "super-secret"
