"""Secrets management backend implementations."""

import os
from abc import ABC, abstractmethod
from typing import Any, Dict, Optional

from src.core.config import SecretsSettings, Settings
from src.core.exceptions import SecretRetrievalError


class BaseSecretsManager(ABC):
    """Abstract base class for secrets managers."""

    @abstractmethod
    def get(self, key: str, default: Optional[str] = None) -> Optional[str]:
        """Retrieve a secret value by key."""
        raise NotImplementedError

    @abstractmethod
    def get_dict(self, key: str, default: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
        """Retrieve a secret as a dictionary."""
        raise NotImplementedError


class EnvironmentSecrets(BaseSecretsManager):
    """Secrets manager backed by environment variables."""

    def get(self, key: str, default: Optional[str] = None) -> Optional[str]:
        return os.getenv(key, default)

    def get_dict(self, key: str, default: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
        value = os.getenv(key)
        if value is None:
            return default
        return {"value": value}


class HashiCorpVaultSecrets(BaseSecretsManager):
    """Secrets manager backed by HashiCorp Vault."""

    def __init__(self, settings: SecretsSettings) -> None:
        try:
            import hvac
        except ImportError as exc:
            raise SecretRetrievalError(
                "hvac package required for Vault integration. Install with 'pip install hvac'.",
            ) from exc

        self.settings = settings
        self.client = hvac.Client(
            url=settings.vault_addr,
            token=settings.vault_token,
        )

        if not self.client.is_authenticated():
            raise SecretRetrievalError("Failed to authenticate with HashiCorp Vault")

    def get(self, key: str, default: Optional[str] = None) -> Optional[str]:
        try:
            response = self.client.secrets.kv.v2.read_secret_version(
                path=f"{self.settings.vault_path}/{key}",
            )
            return response["data"]["data"].get("value", default)
        except Exception as exc:
            raise SecretRetrievalError(
                f"Failed to retrieve secret '{key}' from Vault",
                details={"vault_path": self.settings.vault_path},
            ) from exc

    def get_dict(self, key: str, default: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
        try:
            response = self.client.secrets.kv.v2.read_secret_version(
                path=f"{self.settings.vault_path}/{key}",
            )
            return response["data"]["data"]
        except Exception as exc:
            raise SecretRetrievalError(
                f"Failed to retrieve secret '{key}' from Vault",
                details={"vault_path": self.settings.vault_path},
            ) from exc


class AWSSecretsManager(BaseSecretsManager):
    """Secrets manager backed by AWS Secrets Manager."""

    def __init__(self, settings: SecretsSettings) -> None:
        try:
            import boto3
        except ImportError as exc:
            raise SecretRetrievalError(
                "boto3 package required for AWS Secrets Manager integration. Install with 'pip install boto3'.",
            ) from exc

        self.settings = settings
        self.client = boto3.client(
            service_name="secretsmanager",
            region_name=settings.aws_region,
        )

    def _get_secret(self, key: str) -> Optional[Dict[str, Any]]:
        try:
            import json
            response = self.client.get_secret_value(SecretId=f"{self.settings.aws_secret_name}/{key}")
            return json.loads(response["SecretString"])
        except Exception as exc:
            raise SecretRetrievalError(
                f"Failed to retrieve secret '{key}' from AWS Secrets Manager",
                details={"secret_name": self.settings.aws_secret_name},
            ) from exc

    def get(self, key: str, default: Optional[str] = None) -> Optional[str]:
        secret = self._get_secret(key)
        if secret is None:
            return default
        return secret.get("value", default)

    def get_dict(self, key: str, default: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
        return self._get_secret(key) or default


def get_secret_manager(settings: Optional[Settings] = None) -> BaseSecretsManager:
    """Factory function to return configured secrets manager."""
    settings = settings or Settings()
    backend = settings.secrets.backend

    managers = {
        "environment": EnvironmentSecrets,
        "vault": HashiCorpVaultSecrets,
        "aws": AWSSecretsManager,
    }

    manager_class = managers.get(backend)
    if manager_class is None:
        raise SecretRetrievalError(
            f"Unknown secrets backend: {backend}",
            details={"available_backends": list(managers.keys())},
        )

    return manager_class(settings.secrets)
