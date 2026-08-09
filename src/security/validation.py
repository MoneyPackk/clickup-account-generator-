"""Validation and sanitization for account generation inputs."""

import re
from typing import Optional

from email_validator import EmailNotValidError, validate_email

from src.core.config import PasswordSettings, Settings
from src.core.exceptions import ValidationError


class PasswordValidator:
    """Validate and generate strong passwords."""

    def __init__(self, settings: Optional[PasswordSettings] = None) -> None:
        self.settings = settings or Settings().password

    def validate(self, password: str) -> None:
        """Validate a password against configured policy."""
        if not isinstance(password, str):
            raise ValidationError("Password must be a string", field="password")

        if len(password) < self.settings.min_length:
            raise ValidationError(
                f"Password must be at least {self.settings.min_length} characters",
                field="password",
            )

        if len(password) > self.settings.max_length:
            raise ValidationError(
                f"Password must not exceed {self.settings.max_length} characters",
                field="password",
            )

        if self.settings.require_uppercase and not any(c.isupper() for c in password):
            raise ValidationError(
                "Password must contain at least one uppercase letter",
                field="password",
            )

        if self.settings.require_lowercase and not any(c.islower() for c in password):
            raise ValidationError(
                "Password must contain at least one lowercase letter",
                field="password",
            )

        if self.settings.require_digits and not any(c.isdigit() for c in password):
            raise ValidationError(
                "Password must contain at least one digit",
                field="password",
            )

        if self.settings.require_special and not any(c in self.settings.special_chars for c in password):
            raise ValidationError(
                "Password must contain at least one special character",
                field="password",
            )

    def generate(self) -> str:
        """Generate a password meeting policy requirements."""
        from src.utils.helpers import generate_password

        return generate_password(
            min_length=self.settings.min_length,
            max_length=self.settings.max_length,
            require_uppercase=self.settings.require_uppercase,
            require_lowercase=self.settings.require_lowercase,
            require_digits=self.settings.require_digits,
            require_special=self.settings.require_special,
            special_chars=self.settings.special_chars,
        )


class AccountValidator:
    """Validate account-related inputs."""

    USERNAME_PATTERN = re.compile(r"^[a-zA-Z0-9_.-]{3,64}$")

    def validate_email(self, email: str) -> None:
        """Validate an email address."""
        if not isinstance(email, str) or not email.strip():
            raise ValidationError("Email is required", field="email")
        try:
            validate_email(email)
        except EmailNotValidError as exc:
            raise ValidationError(f"Invalid email: {exc}", field="email") from exc

    def validate_username(self, username: str) -> None:
        """Validate a username."""
        if not isinstance(username, str) or not username.strip():
            raise ValidationError("Username is required", field="username")
        if not self.USERNAME_PATTERN.match(username):
            raise ValidationError(
                "Username must be 3-64 alphanumeric characters with . _ -",
                field="username",
            )

    def validate_domain(self, domain: str) -> None:
        """Validate an email domain."""
        from src.utils.helpers import is_valid_domain

        if not isinstance(domain, str) or not domain.strip():
            raise ValidationError("Domain is required", field="domain")
        if not is_valid_domain(domain):
            raise ValidationError("Invalid domain format", field="domain")
