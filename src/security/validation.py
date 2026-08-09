"""Input validation and sanitization utilities."""

import re
import secrets
import string
from typing import Optional

from src.core.config import PasswordSettings, Settings
from src.core.exceptions import ValidationError


class PasswordValidator:
    """Validate password policy and generate secure passwords."""

    def __init__(self, settings: Optional[PasswordSettings] = None) -> None:
        self.settings = settings or PasswordSettings()

    def generate(self) -> str:
        """Generate a cryptographically secure password meeting policy."""
        length = self.settings.min_length
        special_chars = self.settings.special_chars

        characters = string.ascii_letters + string.digits + special_chars

        while True:
            password = "".join(secrets.choice(characters) for _ in range(length))
            if self.validate(password):
                return password

    def validate(self, password: str) -> bool:
        """Validate password against configured policy."""
        if not isinstance(password, str):
            raise ValidationError("Password must be a string", field="password")

        if len(password) < self.settings.min_length:
            raise ValidationError(
                f"Password must be at least {self.settings.min_length} characters",
                field="password",
            )

        if len(password) > self.settings.max_length:
            raise ValidationError(
                f"Password must be at most {self.settings.max_length} characters",
                field="password",
            )

        checks = {
            "uppercase": (
                self.settings.require_uppercase,
                any(c.isupper() for c in password),
                "Password must contain at least one uppercase letter",
            ),
            "lowercase": (
                self.settings.require_lowercase,
                any(c.islower() for c in password),
                "Password must contain at least one lowercase letter",
            ),
            "digit": (
                self.settings.require_digits,
                any(c.isdigit() for c in password),
                "Password must contain at least one digit",
            ),
            "special": (
                self.settings.require_special,
                any(c in self.settings.special_chars for c in password),
                f"Password must contain at least one special character from {self.settings.special_chars}",
            ),
        }

        for field, (required, passed, message) in checks.items():
            if required and not passed:
                raise ValidationError(message, field=field)

        return True


class AccountValidator:
    """Validate account generation inputs."""

    EMAIL_PATTERN = re.compile(
        r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$",
    )
    USERNAME_PATTERN = re.compile(r"^[a-zA-Z0-9_-]+$")

    def __init__(self, allowed_domains: Optional[list] = None) -> None:
        self.allowed_domains = allowed_domains or []

    def validate_email(self, email: str) -> None:
        """Validate email format and allowed domains."""
        if not isinstance(email, str) or not email.strip():
            raise ValidationError("Email is required", field="email")

        if len(email) > 254:
            raise ValidationError("Email exceeds maximum length", field="email")

        if not self.EMAIL_PATTERN.match(email):
            raise ValidationError("Invalid email format", field="email")

        if self.allowed_domains:
            domain = email.split("@")[1].lower()
            if domain not in [d.lower() for d in self.allowed_domains]:
                raise ValidationError(
                    f"Email domain must be one of: {', '.join(self.allowed_domains)}",
                    field="email",
                )

    def validate_username(self, username: str) -> None:
        """Validate username format."""
        if not isinstance(username, str) or not username.strip():
            raise ValidationError("Username is required", field="username")

        if len(username) < 3 or len(username) > 64:
            raise ValidationError(
                "Username must be between 3 and 64 characters",
                field="username",
            )

        if not self.USERNAME_PATTERN.match(username):
            raise ValidationError(
                "Username may only contain letters, numbers, underscores, and hyphens",
                field="username",
            )

    def validate_domain(self, domain: str) -> str:
        """Sanitize and validate a domain string."""
        if not isinstance(domain, str) or not domain.strip():
            raise ValidationError("Domain is required", field="domain")

        domain = domain.strip().lower()

        if not re.match(r"^[a-z0-9]([a-z0-9\-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9\-]{0,61}[a-z0-9])?)*$", domain):
            raise ValidationError("Invalid domain format", field="domain")

        return domain

    def sanitize_input(self, value: str) -> str:
        """Sanitize user-provided input."""
        if not isinstance(value, str):
            return ""
        value = value.strip()
        value = re.sub(r"[<>\"']", "", value)
        return value
