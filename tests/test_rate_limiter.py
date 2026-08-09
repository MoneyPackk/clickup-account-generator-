"""Unit tests for src/security/rate_limiter.py."""

import time

import pytest

from src.core.config import RateLimitSettings
from src.core.exceptions import RateLimitError
from src.security.rate_limiter import RateLimiter


def _settings(enabled=True, requests=10, window=60, burst=5) -> RateLimitSettings:
    s = RateLimitSettings()
    s.enabled = enabled
    s.requests = requests
    s.window = window
    s.burst = burst
    return s


@pytest.mark.unit
class TestRateLimiter:
    def test_allows_within_burst(self):
        limiter = RateLimiter(_settings(burst=5))
        for _ in range(5):
            assert limiter.is_allowed("key1") is True

    def test_blocks_over_burst(self):
        limiter = RateLimiter(_settings(burst=2, requests=2, window=3600))
        assert limiter.is_allowed("key2") is True
        assert limiter.is_allowed("key2") is True
        assert limiter.is_allowed("key2") is False

    def test_disabled_always_allows(self):
        limiter = RateLimiter(_settings(enabled=False))
        for _ in range(100):
            assert limiter.is_allowed("any") is True

    def test_check_rate_limit_raises(self):
        limiter = RateLimiter(_settings(burst=1, requests=1, window=3600))
        limiter.is_allowed("key3")  # consume the token
        with pytest.raises(RateLimitError):
            limiter.check_rate_limit("key3")

    def test_check_rate_limit_ok_does_not_raise(self):
        limiter = RateLimiter(_settings(burst=5))
        limiter.check_rate_limit("key4")  # should not raise

    def test_different_keys_are_independent(self):
        limiter = RateLimiter(_settings(burst=1))
        assert limiter.is_allowed("a") is True
        assert limiter.is_allowed("b") is True

    def test_retry_after_returns_non_negative(self):
        limiter = RateLimiter(_settings(burst=1, requests=1, window=60))
        limiter.is_allowed("k")  # exhaust
        assert limiter.retry_after("k") >= 0
