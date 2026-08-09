"""Pydantic-settings based configuration for the ClickUp account generator."""

from typing import List, Optional

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class DatabaseSettings(BaseSettings):
    """Database connection settings."""

    model_config = SettingsConfigDict(
        env_prefix="",
        extra="ignore",
        populate_by_name=True,
    )

    url: str = Field(default="sqlite:///./clickup_generator.db", alias="DATABASE_URL")
    pool_size: int = Field(default=5, alias="DATABASE_POOL_SIZE")
    pool_overflow: int = Field(default=10, alias="DATABASE_POOL_OVERFLOW")
    pool_recycle: int = Field(default=3600, alias="DATABASE_POOL_RECYCLE")
    echo: bool = Field(default=False, alias="DATABASE_ECHO")


class ClickUpSettings(BaseSettings):
    """ClickUp integration settings."""

    model_config = SettingsConfigDict(
        env_prefix="",
        extra="ignore",
        populate_by_name=True,
    )

    base_url: str = Field(default="https://app.clickup.com", alias="CLICKUP_BASE_URL")
    signup_path: str = Field(default="/signup", alias="CLICKUP_SIGNUP_PATH")
    dashboard_path: str = Field(default="/dashboard", alias="CLICKUP_DASHBOARD_PATH")
    timeout: int = Field(default=30, alias="CLICKUP_TIMEOUT")
    retries: int = Field(default=3, alias="CLICKUP_RETRIES")
    retry_backoff: float = Field(default=2.0, alias="CLICKUP_RETRY_BACKOFF")
    headless: bool = Field(default=True, alias="CLICKUP_HEADLESS")


class ChromeSettings(BaseSettings):
    """Chrome WebDriver settings."""

    model_config = SettingsConfigDict(
        env_prefix="",
        extra="ignore",
        populate_by_name=True,
    )

    binary: Optional[str] = Field(default=None, alias="CHROME_BINARY")
    driver_path: Optional[str] = Field(default=None, alias="CHROME_DRIVER_PATH")
    disable_gpu: bool = Field(default=True, alias="CHROME_DISABLE_GPU")
    no_sandbox: bool = Field(default=True, alias="CHROME_NO_SANDBOX")
    disable_dev_shm: bool = Field(default=True, alias="CHROME_DISABLE_DEV_SHM")
    user_agents: List[str] = Field(default_factory=list)


class PasswordSettings(BaseSettings):
    """Password policy settings."""

    model_config = SettingsConfigDict(
        env_prefix="",
        extra="ignore",
        populate_by_name=True,
    )

    min_length: int = Field(default=16, alias="PASSWORD_MIN_LENGTH")
    max_length: int = Field(default=64, alias="PASSWORD_MAX_LENGTH")
    require_uppercase: bool = Field(default=True, alias="PASSWORD_REQUIRE_UPPERCASE")
    require_lowercase: bool = Field(default=True, alias="PASSWORD_REQUIRE_LOWERCASE")
    require_digits: bool = Field(default=True, alias="PASSWORD_REQUIRE_DIGITS")
    require_special: bool = Field(default=True, alias="PASSWORD_REQUIRE_SPECIAL")
    special_chars: str = Field(
        default="!@#$%^&*()_+-=[]{}|;:,.<>?",
        alias="PASSWORD_SPECIAL_CHARS",
    )


class RateLimitSettings(BaseSettings):
    """Rate limiting settings."""

    model_config = SettingsConfigDict(
        env_prefix="",
        extra="ignore",
        populate_by_name=True,
    )

    enabled: bool = Field(default=True, alias="RATE_LIMIT_ENABLED")
    requests: int = Field(default=100, alias="RATE_LIMIT_REQUESTS")
    window: int = Field(default=3600, alias="RATE_LIMIT_WINDOW")
    burst: int = Field(default=10, alias="BURST_LIMIT")


class SecretsSettings(BaseSettings):
    """Secrets management settings."""

    model_config = SettingsConfigDict(
        env_prefix="",
        extra="ignore",
        populate_by_name=True,
    )

    backend: str = Field(default="environment", alias="SECRETS_BACKEND")
    vault_addr: str = Field(default="http://localhost:8200", alias="VAULT_ADDR")
    vault_token: Optional[str] = Field(default=None, alias="VAULT_TOKEN")
    vault_path: Optional[str] = Field(default="secret/clickup-generator", alias="VAULT_PATH")
    aws_region: str = Field(default="us-east-1", alias="AWS_REGION")
    aws_secret_name: Optional[str] = Field(default="clickup-generator", alias="AWS_SECRET_NAME")


class Settings(BaseSettings):
    """Root application settings."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        populate_by_name=True,
    )

    environment: str = Field(default="development", alias="ENVIRONMENT")
    debug: bool = Field(default=False, alias="DEBUG")
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")
    json_logging: bool = Field(default=False, alias="JSON_LOGGING")
    metrics_enabled: bool = Field(default=True, alias="METRICS_ENABLED")
    prometheus_port: int = Field(default=8000, alias="PROMETHEUS_PORT")
    sentry_dsn: Optional[str] = Field(default=None, alias="SENTRY_DSN")
    api_key: Optional[str] = Field(default=None, alias="API_KEY")
    flask_secret_key: str = Field(default="", alias="FLASK_SECRET_KEY")

    database: DatabaseSettings = Field(default_factory=DatabaseSettings)
    clickup: ClickUpSettings = Field(default_factory=ClickUpSettings)
    chrome: ChromeSettings = Field(default_factory=ChromeSettings)
    password: PasswordSettings = Field(default_factory=PasswordSettings)
    rate_limit: RateLimitSettings = Field(default_factory=RateLimitSettings)
    secrets: SecretsSettings = Field(default_factory=SecretsSettings)

    @property
    def clickup_signup_url(self) -> str:
        """Full URL to the ClickUp signup page."""
        return f"{self.clickup.base_url}{self.clickup.signup_path}"
