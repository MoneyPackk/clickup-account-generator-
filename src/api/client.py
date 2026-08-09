"""ClickUp API client abstraction with retries and error handling."""

from typing import Any, Dict, Optional

import requests
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from src.core.config import Settings
from src.core.exceptions import AccountGenerationError, BrowserError
from src.core.logger import get_logger

logger = get_logger(__name__)


class ClickUpAPIClient:
    """Enterprise client for interacting with ClickUp web/API endpoints."""

    def __init__(self, settings: Optional[Settings] = None) -> None:
        self.settings = settings or Settings()
        self.session = requests.Session()
        self.session.headers.update(
            {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Accept": "application/json",
                "Accept-Language": "en-US,en;q=0.9",
            }
        )

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=2, min=1, max=10),
        retry=retry_if_exception_type(requests.RequestException),
        reraise=True,
    )
    def get_signup_page(self) -> str:
        """Fetch the ClickUp signup page content."""
        url = self.settings.clickup_signup_url
        logger.info("Fetching signup page", url=url)
        response = self.session.get(url, timeout=self.settings.clickup.timeout)
        response.raise_for_status()
        return response.text

    def post_signup_form(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Submit signup form data to ClickUp."""
        url = f"{self.settings.clickup.base_url}/signup"
        logger.info("Submitting signup form")

        response = self.session.post(
            url,
            json=payload,
            timeout=self.settings.clickup.timeout,
        )
        response.raise_for_status()
        return response.json()

    def verify_email_otp(self, email: str, otp: str) -> bool:
        """Verify email OTP with ClickUp."""
        logger.info("Verifying email OTP", email=email)
        # Placeholder for actual ClickUp OTP verification endpoint
        return True

    def close(self) -> None:
        """Close the HTTP session."""
        self.session.close()

    def __enter__(self) -> "ClickUpAPIClient":
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        self.close()
