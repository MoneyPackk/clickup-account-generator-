"""Factory for creating Selenium WebDriver instances."""

from abc import ABC, abstractmethod
from typing import List, Optional

from selenium import webdriver
from selenium.webdriver.chrome.options import Options as ChromeOptions
from selenium.webdriver.chrome.service import Service as ChromeService
from selenium.webdriver.remote.webdriver import WebDriver

from src.core.config import ChromeSettings, Settings
from src.core.exceptions import BrowserError
from src.core.logger import get_logger

logger = get_logger(__name__)


class WebDriverFactory(ABC):
    """Abstract factory for creating WebDriver instances."""

    @abstractmethod
    def create_driver(self) -> WebDriver:
        """Create and return a configured WebDriver instance."""
        raise NotImplementedError


class ChromeDriverFactory(WebDriverFactory):
    """Factory for creating Chrome WebDriver instances."""

    def __init__(self, settings: Optional[ChromeSettings] = None) -> None:
        self.settings = settings or Settings().chrome

    def _build_options(self) -> ChromeOptions:
        """Build ChromeOptions with security and stability flags."""
        options = ChromeOptions()

        if self.settings.binary:
            options.binary_location = self.settings.binary

        if self.settings.disable_gpu:
            options.add_argument("--disable-gpu")

        if self.settings.no_sandbox:
            options.add_argument("--no-sandbox")

        if self.settings.disable_dev_shm:
            options.add_argument("--disable-dev-shm-usage")

        options.add_argument("--disable-blink-features=AutomationControlled")
        options.add_argument("--disable-extensions")
        options.add_argument("--disable-infobars")
        options.add_argument("--window-size=1920,1080")
        options.add_argument("--lang=en-US")

        if self.settings.user_agents:
            options.add_argument(f"--user-agent={self.settings.user_agents[0]}")
        else:
            options.add_argument(
                "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            )

        options.add_experimental_option("excludeSwitches", ["enable-automation"])
        options.add_experimental_option("useAutomationExtension", False)

        return options

    def create_driver(self) -> WebDriver:
        """Create a Chrome WebDriver instance."""
        try:
            options = self._build_options()

            try:
                from webdriver_manager.chrome import ChromeDriverManager
                service = ChromeService(ChromeDriverManager().install())
            except Exception:
                logger.warning("webdriver_manager failed, falling back to system chromedriver")
                service = ChromeService() if not self.settings.driver_path else ChromeService(self.settings.driver_path)

            driver = webdriver.Chrome(service=service, options=options)
            driver.execute_script(
                "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})",
            )
            logger.info("Chrome driver created successfully")
            return driver
        except Exception as exc:
            raise BrowserError(
                "Failed to create Chrome WebDriver",
                browser_error=str(exc),
            ) from exc


def get_driver_factory(settings: Optional[Settings] = None) -> WebDriverFactory:
    """Return configured WebDriver factory."""
    settings = settings or Settings()
    return ChromeDriverFactory(settings.chrome)
