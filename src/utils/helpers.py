"""Miscellaneous utility helpers."""

import re
import secrets
from urllib.parse import urlparse


MASK_CHAR = "*"
VISIBLE_PREFIX_LEN = 3
VISIBLE_SUFFIX_LEN = 3


def generate_username(prefix: str = "user") -> str:
    """Generate a unique username."""
    token = secrets.token_hex(4)
    return f"{prefix}_{token}"


def is_valid_url(url: str) -> bool:
    """Check if a string is a valid HTTP/HTTPS URL."""
    try:
        result = urlparse(url)
        return all([result.scheme in ("http", "https"), result.netloc])
    except Exception:
        return False


def mask_email(email: str) -> str:
    """Mask an email address for safe logging."""
    if not isinstance(email, str) or "@" not in email:
        return ""
    local, domain = email.rsplit("@", 1)
    if len(local) <= VISIBLE_PREFIX_LEN + VISIBLE_SUFFIX_LEN:
        masked_local = local[:VISIBLE_PREFIX_LEN] + MASK_CHAR * max(1, len(local) - VISIBLE_PREFIX_LEN)
    else:
        masked_local = (
            local[:VISIBLE_PREFIX_LEN]
            + MASK_CHAR * (len(local) - VISIBLE_PREFIX_LEN - VISIBLE_SUFFIX_LEN)
            + local[-VISIBLE_SUFFIX_LEN:]
        )
    return f"{masked_local}@{domain}"


def mask_password(password: str) -> str:
    """Mask a password for safe logging."""
    if not isinstance(password, str):
        return ""
    return MASK_CHAR * len(password)


def remove_control_chars(value: str) -> str:
    """Remove control characters from a string."""
    return re.sub(r"[\x00-\x1F\x7F]", "", value)
