"""Context manager and lifecycle handling for WebDriver instances."""

from contextlib import contextmanager
from time import perf_counter
from typing import Generator, Optional

from selenium.webdriver.remote.webdriver import WebDriver

from src.core.config import Settings
from src.core.exceptions import BrowserError
from src.core.logger import get_logger
from src.core.metrics import get_metrics

from .driver_factory import ChromeDriverFactory, WebDriverFactory

logger = get_logger(__name__)


class WebDriverManager:
    """Manage WebDriver lifecycle with metrics and error handling."""

    def __init__(
        self,
        factory: Optional[WebDriverFactory] = None,
        settings: Optional[Settings] = None,
    ) -> None:
        self.settings = settings or Settings()
        self.factory = factory or ChromeDriverFactory(self.settings.chrome)
        self.metrics = get_metrics()
        self._driver: Optional[WebDriver] = None

    def create(self) -> WebDriver:
        """Create a new WebDriver instance."""
        start = perf_counter()
        try:
            driver = self.factory.create_driver()
            self._driver = driver
            self.metrics.active_drivers.labels(environment=self.settings.environment).inc()
            return driver
        finally:
            duration = perf_counter() - start
            self.metrics.record_driver_operation(
                environment=self.settings.environment,
                operation="create",
                duration=duration,
            )

    def quit(self) -> None:
        """Quit the WebDriver instance."""
        if self._driver:
            try:
                start = perf_counter()
                self._driver.quit()
                self.metrics.active_drivers.labels(environment=self.settings.environment).dec()
                logger.info("WebDriver quit successfully")
            except Exception as exc:
                logger.warning("Failed to quit WebDriver cleanly", error=str(exc))
            finally:
                self._driver = None
                duration = perf_counter() - start
                self.metrics.record_driver_operation(
                    environment=self.settings.environment,
                    operation="quit",
                    duration=duration,
                )

    @contextmanager
    def managed(self) -> Generator[WebDriver, None, None]:
        """Context manager for safe WebDriver lifecycle."""
        driver = None
        try:
            driver = self.create()
            yield driver
        finally:
            self.quit()

    def __enter__(self) -> WebDriver:
        """Enter context and return driver."""
        return self.create()

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        """Exit context and cleanup driver."""
        self.quit()
