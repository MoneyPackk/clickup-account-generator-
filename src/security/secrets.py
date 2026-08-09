"""Secrets management abstraction supporting env, Vault, and AWS."""

import os
from abc import ABC, abstractmethod
from typing import Dict, Optional

from src.core.config import SecretsSettings, Settings
from src.core.exceptions import SecretRetrievalError
from src.core.logger import get_logger

logger = get_logger(__name__)


class SecretsBackend(ABC):
    """Abstract secrets backend."""

    @abstractmethod
    def get_secret(self, key: str) -> Optional[str]:
        """Retrieve a secret by key."""
        raise NotImplementedError

    @abstractmethod
    def get_all_secrets(self) -> Dict[str, str]:
        """Retrieve all secrets as a dictionary."""
        raise NotImplementedError


class EnvironmentSecretsBackend(SecretsBackend):
    """Backend that reads secrets from environment variables."""

    def get_secret(self, key: str) -> Optional[str]:
        return os.environ.get(key)

    def get_all_secrets(self) -> Dict[str, str]:
        return dict(os.environ)


class VaultSecretsBackend(SecretsBackend):
    """Backend for HashiCorp Vault (optional)."""

    def __init__(self, settings: SecretsSettings) -> None:
        self.settings = settings
        self._client = None

    def _get_client(self):
        if self._client is None:
            try:
                import hvac
                self._client = hvac.Client(
                    url=self.settings.vault_addr,
                    token=self.settings.vault_token,
                )
            except ImportError as exc:
                raise SecretRetrievalError(
                    "hvac library required for Vault backend",
                    details={"error": str(exc)},
                ) from exc
        return self._client

    def get_secret(self, key: str) -> Optional[str]:
        try:
            client = self._get_client()
            path = self.settings.vault_path or "secret/clickup-generator"
            response = client.secrets.kv.v2.read_secret_version(path=path)
            return response["data"]["data"].get(key)
        except Exception as exc:
            raise SecretRetrievalError(
                "Failed to retrieve secret from Vault",
                details={"key": key, "error": str(exc)},
            ) from exc

    def get_all_secrets(self) -> Dict[str, str]:
        try:
            client = self._get_client()
            path = self.settings.vault_path or "secret/clickup-generator"
            response = client.secrets.kv.v2.read_secret_version(path=path)
            return response["data"]["data"]
        except Exception as exc:
            raise SecretRetrievalError(
                "Failed to retrieve secrets from Vault",
                details={"error": str(exc)},
            ) from exc


class AWSSecretsBackend(SecretsBackend):
    """Backend for AWS Secrets Manager (optional)."""

    def __init__(self, settings: SecretsSettings) -> None:
        self.settings = settings
        self._client = None

    def _get_client(self):
        if self._client is None:
            try:
                import boto3
                self._client = boto3.client(
                    "secretsmanager",
                    region_name=self.settings.aws_region,
                )
            except ImportError as exc:
                raise SecretRetrievalError(
                    "boto3 library required for AWS backend",
                    details={"error": str(exc)},
                ) from exc
        return self._client

    def get_secret(self, key: str) -> Optional[str]:
        try:
            import json
            client = self._get_client()
            secret_name = self.settings.aws_secret_name or "clickup-generator"
            response = client.get_secret_value(SecretId=secret_name)
            secrets_dict = json.loads(response["SecretString"])
            return secrets_dict.get(key)
        except Exception as exc:
            raise SecretRetrievalError(
                "Failed to retrieve secret from AWS",
                details={"key": key, "error": str(exc)},
            ) from exc

    def get_all_secrets(self) -> Dict[str, str]:
        try:
            import json
            client = self._get_client()
            secret_name = self.settings.aws_secret_name or "clickup-generator"
            response = client.get_secret_value(SecretId=secret_name)
            return json.loads(response["SecretString"])
        except Exception as exc:
            raise SecretRetrievalError(
                "Failed to retrieve secrets from AWS",
                details={"error": str(exc)},
            ) from exc


class SecretsManager:
    """Facade for retrieving secrets from configured backend."""

    BACKENDS = {
        "environment": EnvironmentSecretsBackend,
        "vault": VaultSecretsBackend,
        "aws": AWSSecretsBackend,
    }

    def __init__(self, settings: Optional[SecretsSettings] = None) -> None:
        self.settings = settings or Settings().secrets
        backend_class = self.BACKENDS.get(self.settings.backend)
        if backend_class is None:
            raise SecretRetrievalError(f"Unsupported secrets backend: {self.settings.backend}")
        self.backend = backend_class(self.settings)
        logger.info("Secrets manager initialized", backend=self.settings.backend)

    def get_secret(self, key: str) -> Optional[str]:
        """Get a secret value."""
        return self.backend.get_secret(key)

    def get_required_secret(self, key: str) -> str:
        """Get a secret or raise an error if missing."""
        value = self.get_secret(key)
        if value is None:
            raise SecretRetrievalError(f"Required secret not found: {key}")
        return value

    def get_all_secrets(self) -> Dict[str, str]:
        """Get all available secrets."""
        return self.backend.get_all_secrets()


def get_secrets_manager(settings: Optional[SecretsSettings] = None) -> SecretsManager:
    """Return a secrets manager instance."""
    return SecretsManager(settings)
