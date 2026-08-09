"""Prometheus metrics for monitoring account generation."""

from typing import Optional

from prometheus_client import Counter, Gauge, Histogram, start_http_server


class GeneratorMetrics:
    """Prometheus metrics for the account generator."""

    def __init__(self) -> None:
        self.accounts_attempted_total = Counter(
            "accounts_attempted_total",
            "Total number of account generation attempts",
            ["environment"],
        )
        self.accounts_succeeded_total = Counter(
            "accounts_succeeded_total",
            "Total number of successful account generations",
            ["environment"],
        )
        self.accounts_failed_total = Counter(
            "accounts_failed_total",
            "Total number of failed account generations",
            ["environment", "error_code"],
        )
        self.rate_limit_decisions_total = Counter(
            "rate_limit_decisions_total",
            "Total number of rate limit decisions",
            ["environment", "allowed"],
        )
        self.account_generation_duration_seconds = Histogram(
            "account_generation_duration_seconds",
            "Duration of account generation in seconds",
            ["environment"],
            buckets=[1, 5, 10, 30, 60, 120, 300],
        )
        self.active_drivers = Gauge(
            "active_drivers",
            "Number of currently active WebDriver instances",
            ["environment"],
        )
        self.driver_operation_duration_seconds = Histogram(
            "driver_operation_duration_seconds",
            "Duration of WebDriver operations in seconds",
            ["environment", "operation"],
            buckets=[0.1, 0.5, 1, 5, 10, 30],
        )

    def record_attempt(self, environment: str) -> None:
        """Increment the attempt counter."""
        self.accounts_attempted_total.labels(environment=environment).inc()

    def record_success(self, environment: str) -> None:
        """Increment the success counter."""
        self.accounts_succeeded_total.labels(environment=environment).inc()

    def record_failure(self, environment: str, error_code: str) -> None:
        """Increment the failure counter."""
        self.accounts_failed_total.labels(
            environment=environment, error_code=error_code
        ).inc()

    def record_rate_limit(self, environment: str, allowed: bool) -> None:
        """Record a rate limit decision."""
        self.rate_limit_decisions_total.labels(
            environment=environment, allowed=str(allowed)
        ).inc()

    def record_driver_operation(
        self, environment: str, operation: str, duration: float
    ) -> None:
        """Record a WebDriver operation duration."""
        self.driver_operation_duration_seconds.labels(
            environment=environment, operation=operation
        ).observe(duration)

    def start_server(self, port: int) -> None:
        """Start the Prometheus HTTP metrics server."""
        start_http_server(port)


_metrics: Optional[GeneratorMetrics] = None


def get_metrics() -> GeneratorMetrics:
    """Return the singleton metrics instance."""
    global _metrics
    if _metrics is None:
        _metrics = GeneratorMetrics()
    return _metrics
