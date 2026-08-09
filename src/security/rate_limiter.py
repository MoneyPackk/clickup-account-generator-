"""Token bucket rate limiter for account generation."""

import time
from threading import Lock
from typing import Dict, Optional

from src.core.config import RateLimitSettings
from src.core.exceptions import RateLimitError


class RateLimiter:
    """Thread-safe token bucket rate limiter."""

    def __init__(self, settings: Optional[RateLimitSettings] = None) -> None:
        self.settings = settings or RateLimitSettings()
        self._buckets: Dict[str, Dict[str, float]] = {}
        self._lock = Lock()

    def _get_bucket(self, key: str) -> Dict[str, float]:
        """Get or create a rate limit bucket for the given key."""
        if key not in self._buckets:
            self._buckets[key] = {
                "tokens": float(self.settings.burst),
                "last_update": time.time(),
            }
        return self._buckets[key]

    def _add_tokens(self, bucket: Dict[str, float]) -> None:
        """Replenish tokens based on elapsed time."""
        now = time.time()
        elapsed = now - bucket["last_update"]
        tokens_to_add = elapsed * (self.settings.requests / self.settings.window)
        bucket["tokens"] = min(
            self.settings.burst,
            bucket["tokens"] + tokens_to_add,
        )
        bucket["last_update"] = now

    def is_allowed(self, key: str) -> bool:
        """Check if request is allowed under rate limit."""
        if not self.settings.enabled:
            return True

        with self._lock:
            bucket = self._get_bucket(key)
            self._add_tokens(bucket)

            if bucket["tokens"] >= 1.0:
                bucket["tokens"] -= 1.0
                return True
            return False

    def check_rate_limit(self, key: str) -> None:
        """Check rate limit and raise RateLimitError if exceeded."""
        if not self.is_allowed(key):
            retry_after = int(self.settings.window / self.settings.requests)
            raise RateLimitError(
                message="Rate limit exceeded. Please try again later.",
                retry_after=retry_after,
                details={"key": key},
            )

    def get_remaining(self, key: str) -> int:
        """Return approximate remaining requests for key."""
        with self._lock:
            bucket = self._get_bucket(key)
            self._add_tokens(bucket)
            return int(bucket["tokens"])

    def reset(self, key: str) -> None:
        """Reset rate limit bucket for a key."""
        with self._lock:
            self._buckets.pop(key, None)


def get_rate_limiter(settings: Optional[RateLimitSettings] = None) -> RateLimiter:
    """Return a RateLimiter instance."""
    return RateLimiter(settings=settings)
