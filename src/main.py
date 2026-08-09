"""Main CLI entrypoint for the ClickUp account generator."""

import argparse
import sys

from src.account.generator import ClickUpAccountGenerator
from src.api.responses import APIResponse
from src.core.config import Settings
from src.core.context import ContextManager
from src.core.logger import get_logger, setup_logging
from src.core.metrics import get_metrics
from src.database.base import Base, engine

logger = get_logger(__name__)


def setup_database() -> None:
    """Create database tables."""
    Base.metadata.create_all(bind=engine)
    logger.info("Database tables created")


def parse_args() -> argparse.Namespace:
    """Parse command-line arguments."""
    parser = argparse.ArgumentParser(
        description="Enterprise ClickUp Account Generator",
    )
    parser.add_argument(
        "--email-domain",
        type=str,
        default="example.com",
        help="Domain for generated email addresses",
    )
    parser.add_argument(
        "--count",
        type=int,
        default=1,
        help="Number of accounts to generate",
    )
    parser.add_argument(
        "--headless",
        action="store_true",
        default=True,
        help="Run browser in headless mode",
    )
    parser.add_argument(
        "--setup-db",
        action="store_true",
        help="Create database tables before running",
    )
    parser.add_argument(
        "--metrics-port",
        type=int,
        default=None,
        help="Port for Prometheus metrics server",
    )
    return parser.parse_args()


def main() -> int:
    """Run the account generator CLI."""
    args = parse_args()
    settings = Settings()
    setup_logging(settings)

    if args.setup_db:
        setup_database()

    metrics = get_metrics()
    if settings.metrics_enabled and args.metrics_port:
        metrics.start_server(args.metrics_port)
        logger.info("Metrics server started", port=args.metrics_port)

    with ContextManager():
        generator = ClickUpAccountGenerator(
            settings=settings,
            email_domain=args.email_domain,
        )

        logger.info(
            "Starting account generation",
            count=args.count,
            environment=settings.environment,
        )

        results = generator.generate_batch(count=args.count)

        for result in results:
            response = APIResponse(ok=result) if result.success else APIResponse.from_exception(
                Exception(result.error_message or "Generation failed")
            )
            print(response.model_dump_json(indent=2))

        success_count = sum(1 for r in results if r.success)
        logger.info(
            "Batch generation complete",
            total=len(results),
            successful=success_count,
            failed=len(results) - success_count,
        )

    return 0 if success_count == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
