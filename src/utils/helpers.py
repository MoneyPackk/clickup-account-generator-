"""General-purpose helper utilities."""

import re
import secrets
import string
from typing import Optional


SANITIZE_PATTERN = re.compile(r"[<>'\"&\r\n]|(--|;/|\*)")


def generate_username(prefix: str = "user", length: int = 10) -> str:
    """Generate a cryptographically random username with a prefix and alphanumeric suffix."""
    alphabet = string.ascii_lowercase + string.digits
    suffix = "".join(secrets.choice(alphabet) for _ in range(length))
    return f"{prefix}_{suffix}"


def generate_password(
    min_length: int = 16,
    max_length: int = 64,
    require_uppercase: bool = True,
    require_lowercase: bool = True,
    require_digits: bool = True,
    require_special: bool = True,
    special_chars: str = "!@#$%^&*()_+-=[]{}|;:,.<>?",
) -> str:
    """Generate a cryptographically secure password meeting policy requirements."""
    if min_length < 8 or max_length < min_length:
        raise ValueError("Invalid password length parameters")

    alphabet = string.ascii_lowercase + string.ascii_uppercase + string.digits + special_chars
    length_range = max(min_length, max_length) - min_length
    length = min_length + (secrets.randbelow(length_range + 1) if length_range > 0 else 0)

    while True:
        password = "".join(secrets.choice(alphabet) for _ in range(length))
        if require_uppercase and not any(c.isupper() for c in password):
            continue
        if require_lowercase and not any(c.islower() for c in password):
            continue
        if require_digits and not any(c.isdigit() for c in password):
            continue
        if require_special and not any(c in special_chars for c in password):
            continue
        return password


def mask_email(email: str) -> str:
    """Mask the local part of an email address for logging."""
    if "@" not in email:
        return "***"
    local, domain = email.rsplit("@", 1)
    if len(local) <= 2:
        return f"***@{domain}"
    return f"{local[0]}{'*' * (len(local) - 2)}{local[-1]}@{domain}"


def sanitize_input(value: str, max_length: int = 255) -> str:
    """Sanitize untrusted string input."""
    if not isinstance(value, str):
        raise TypeError("Input must be a string")
    value = value[:max_length]
    value = SANITIZE_PATTERN.sub("", value)
    return value.strip()


def is_valid_domain(domain: str) -> bool:
    """Check if a string looks like a valid domain."""
    pattern = re.compile(
        r"^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$"
    )
    return bool(pattern.match(domain))
