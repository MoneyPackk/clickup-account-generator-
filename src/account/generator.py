"""Enterprise ClickUp account generator with retries, metrics, and audit logging."""

from time import perf_counter
from typing import Optional
from uuid import UUID

from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

from src.api.client import ClickUpAPIClient
from src.api.schemas import GenerationResult
from src.browser.driver_manager import WebDriverManager
from src.core.config import Settings
from src.core.context import get_correlation_id
from src.core.exceptions import AccountGenerationError, RateLimitError, ValidationError
from src.core.logger import get_logger
from src.core.metrics import get_metrics
from src.database.base import get_db_context
from src.database.models import AccountStatus
from src.database.repository import AccountRepository, AuditRepository
from src.security.rate_limiter import RateLimiter
from src.security.validation import AccountValidator, PasswordValidator
from src.utils.helpers import generate_username, mask_email

logger = get_logger(__name__)


class ClickUpAccountGenerator:
    """Enterprise-grade ClickUp account generator."""

    def __init__(
        self,
        settings: Optional[Settings] = None,
        driver_manager: Optional[WebDriverManager] = None,
        api_client: Optional[ClickUpAPIClient] = None,
        rate_limiter: Optional[RateLimiter] = None,
        email_domain: str = "example.com",
    ) -> None:
        self.settings = settings or Settings()
        self.driver_manager = driver_manager or WebDriverManager(settings=self.settings)
        self.api_client = api_client or ClickUpAPIClient(settings=self.settings)
        self.rate_limiter = rate_limiter or RateLimiter(self.settings.rate_limit)
        self.email_domain = email_domain
        self.validator = AccountValidator()
        self.password_validator = PasswordValidator(self.settings.password)
        self.metrics = get_metrics()

    def generate_email(self, username: Optional[str] = None) -> str:
        """Generate a unique email address."""
        if username is None:
            username = generate_username(prefix="clickup")
        return f"{username}@{self.email_domain}"

    def generate_account(
        self,
        username: Optional[str] = None,
        enable_two_factor: bool = False,
    ) -> GenerationResult:
        """Generate a single ClickUp account."""
        correlation_id = get_correlation_id()
        start_time = perf_counter()

        try:
            self.rate_limiter.check_rate_limit(f"account_generation:{correlation_id}")
            self.metrics.record_attempt(self.settings.environment)
        except RateLimitError:
            self.metrics.record_rate_limit(self.settings.environment, allowed=False)
            raise

        email = self.generate_email(username)
        password = self.password_validator.generate()

        self.validator.validate_email(email)

        logger.info(
            "Starting account generation",
            email=mask_email(email),
            environment=self.settings.environment,
        )

        with get_db_context() as db:
            account_repo = AccountRepository(db)
            audit_repo = AuditRepository(db)

            try:
                account = account_repo.create(email, email.split("@")[0], AccountStatus.CREATING)
                audit_repo.log(
                    action="ACCOUNT_GENERATION_STARTED",
                    actor="generator",
                    account_id=account.id,
                    correlation_id=correlation_id,
                )

                self._execute_signup_flow(email, password, enable_two_factor, account.id)

                account_repo.set_clickup_metadata(account, user_id=f"cu_{account.id.hex[:16]}")
                audit_repo.log(
                    action="ACCOUNT_GENERATION_SUCCEEDED",
                    actor="generator",
                    account_id=account.id,
                    correlation_id=correlation_id,
                )

                duration = perf_counter() - start_time
                self.metrics.record_success(self.settings.environment)
                self.metrics.account_generation_duration_seconds.labels(
                    environment=self.settings.environment,
                ).observe(duration)

                return GenerationResult(
                    success=True,
                    account_id=account.id,
                    email=email,
                    username=account.username,
                    password=password,
                    duration_seconds=duration,
                )

            except AccountGenerationError:
                duration = perf_counter() - start_time
                account_repo.update_status(account, AccountStatus.FAILED, failure_reason="Generation failed")
                audit_repo.log(
                    action="ACCOUNT_GENERATION_FAILED",
                    actor="generator",
                    account_id=account.id,
                    success=False,
                    details="See metrics and logs",
                    correlation_id=correlation_id,
                )
                self.metrics.record_failure(self.settings.environment, "ACCOUNT_GENERATION_ERROR")
                raise

            except Exception as exc:
                duration = perf_counter() - start_time
                account_repo.update_status(account, AccountStatus.FAILED, failure_reason=str(exc))
                audit_repo.log(
                    action="ACCOUNT_GENERATION_EXCEPTION",
                    actor="generator",
                    account_id=account.id,
                    success=False,
                    details=str(exc),
                    correlation_id=correlation_id,
                )
                self.metrics.record_failure(self.settings.environment, "INTERNAL_ERROR")
                raise AccountGenerationError(
                    message="Unexpected error during account generation",
                    step="generate_account",
                    details={"original_error": str(exc)},
                ) from exc

    def _execute_signup_flow(
        self,
        email: str,
        password: str,
        enable_two_factor: bool,
        account_id: UUID,
    ) -> None:
        """Run the browser-based signup flow."""
        try:
            with self.driver_manager.managed() as driver:
                driver.get(self.settings.clickup_signup_url)

                wait = WebDriverWait(driver, self.settings.clickup.timeout)

                # Placeholder selectors - must be updated for real ClickUp DOM
                email_input = wait.until(
                    EC.presence_of_element_located((By.NAME, "email")),
                )
                email_input.send_keys(email)

                password_input = driver.find_element(By.NAME, "password")
                password_input.send_keys(password)

                submit_button = driver.find_element(By.XPATH, "//button[@type='submit']")
                submit_button.click()

                wait.until(
                    EC.url_contains("dashboard"),
                )

                logger.info(
                    "Signup flow completed",
                    account_id=str(account_id),
                    email=mask_email(email),
                )

                if enable_two_factor:
                    self._setup_two_factor(driver, account_id)

        except Exception as exc:
            raise AccountGenerationError(
                message="Browser signup flow failed",
                step="signup_flow",
                details={"error": str(exc)},
            ) from exc

    def _setup_two_factor(self, driver, account_id: UUID) -> None:
        """Set up two-factor authentication for a new account."""
        logger.info("Setting up 2FA", account_id=str(account_id))
        # Placeholder implementation - actual selectors vary
        raise AccountGenerationError(
            message="Two-factor setup not implemented in this version",
            step="two_factor_setup",
            details={"account_id": str(account_id)},
        )

    def generate_batch(
        self,
        count: int,
        enable_two_factor: bool = False,
    ) -> list[GenerationResult]:
        """Generate multiple accounts sequentially."""
        if count < 1 or count > 100:
            raise ValidationError("Batch count must be between 1 and 100", field="count")

        results = []
        for _ in range(count):
            try:
                result = self.generate_account(enable_two_factor=enable_two_factor)
                results.append(result)
            except AccountGenerationError as exc:
                results.append(
                    GenerationResult(
                        success=False,
                        error_code=exc.error_code,
                        error_message=exc.message,
                    )
                )
        return results
