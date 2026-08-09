"""Token bucket rate limiter implementation."""

from collections import defaultdict
from time import time
from typing import Dict, Optional

from src.core.config import RateLimitSettings, Settings
from src.core.exceptions import RateLimitError


class RateLimiter:
    """In-memory token bucket rate limiter."""

    def __init__(self, settings: Optional[RateLimitSettings] = None) -> None:
        self.settings = settings or Settings().rate_limit
        self.buckets: Dict[str, Dict[str, float]] = defaultdict(
            lambda: {"tokens": float(self.settings.burst), "last_updated": time()},
        )

    def _replenish(self, bucket: Dict[str, float]) -> None:
        """Replenish tokens based on elapsed time."""
        now = time()
        elapsed = now - bucket["last_updated"]
        rate = self.settings.requests / max(1, self.settings.window)
        bucket["tokens"] = min(
            float(self.settings.burst),
            bucket["tokens"] + elapsed * rate,
        )
        bucket["last_updated"] = now

    def is_allowed(self, key: str) -> bool:
        """Check if a request is allowed under rate limit."""
        if not self.settings.enabled:
            return True

        bucket = self.buckets[key]
        self._replenish(bucket)

        if bucket["tokens"] >= 1:
            bucket["tokens"] -= 1
            return True
        return False

    def retry_after(self, key: str) -> int:
        """Estimate seconds until the next token is available."""
        bucket = self.buckets[key]
        self._replenish(bucket)
        rate = self.settings.requests / max(1, self.settings.window)
        tokens_needed = 1 - bucket["tokens"]
        return max(0, int(tokens_needed / rate)) if rate > 0 else self.settings.window

    def check_rate_limit(self, key: str) -> None:
        """Raise RateLimitError if key is over the limit."""
        if not self.is_allowed(key):
            raise RateLimitError(
                message="Rate limit exceeded. Please try again later.",
                retry_after=self.retry_after(key),
            )


class RedisRateLimiter(RateLimiter):
    """Future: Redis-backed distributed rate limiter."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        raise NotImplementedError("Redis rate limiter not yet implemented")
