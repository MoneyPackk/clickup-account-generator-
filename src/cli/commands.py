"""Rich CLI commands for the ClickUp account generator."""

import sys

import click

from src.account.generator import ClickUpAccountGenerator
from src.api.responses import APIResponse
from src.core.config import Settings
from src.core.context import ContextManager
from src.core.logger import get_logger, setup_logging
from src.core.metrics import get_metrics
from src.database.base import Base, engine
from src.security.secrets import get_secrets_manager

logger = get_logger(__name__)


@click.group()
@click.option("--env", "env_file", type=click.Path(exists=True), help="Path to .env file")
@click.option("--verbose", "-v", is_flag=True, help="Enable verbose output")
@click.pass_context
def cli(ctx, env_file, verbose):
    """Enterprise ClickUp Account Generator CLI."""
    ctx.ensure_object(dict)

    settings = Settings(_env_file=env_file) if env_file else Settings()
    if verbose:
        settings.log_level = "DEBUG"

    setup_logging(settings)
    ctx.obj["settings"] = settings
    logger.debug("CLI initialized", environment=settings.environment)


@cli.command()
@click.pass_context
def setup_db(ctx):
    """Create database tables."""
    settings = ctx.obj["settings"]
    setup_logging(settings)
    Base.metadata.create_all(bind=engine)
    click.echo("Database tables created successfully.")
    logger.info("Database tables created via CLI")


@cli.command()
@click.option("--email-domain", "-d", default="example.com", help="Domain for generated emails")
@click.option("--count", "-c", default=1, type=int, help="Number of accounts to create")
@click.option("--username", "-u", default=None, help="Optional base username")
@click.option("--two-factor/--no-two-factor", default=False, help="Enable 2FA setup")
@click.option("--headless/--no-headless", default=True, help="Run browser headless")
@click.option("--metrics-port", type=int, default=None, help="Port for metrics server")
@click.option("--output", "-o", type=click.Choice(["json", "table"]), default="json", help="Output format")
@click.pass_context
def create(ctx, email_domain, count, username, two_factor, headless, metrics_port, output):
    """Create one or more ClickUp accounts."""
    settings = ctx.obj["settings"]
    settings.clickup.headless = headless

    if settings.metrics_enabled and metrics_port:
        metrics = get_metrics()
        metrics.start_server(metrics_port)
        logger.info("Metrics server started", port=metrics_port)

    with ContextManager():
        generator = ClickUpAccountGenerator(
            settings=settings,
            email_domain=email_domain,
        )

        logger.info("Starting account creation", count=count)
        results = generator.generate_batch(count=count, enable_two_factor=two_factor)

        if output == "table":
            click.echo(f"{'Success':<10} {'Email':<30} {'Duration (s)':<15}")
            click.echo("-" * 55)
            for result in results:
                click.echo(f"{str(result.success):<10} {result.email or 'N/A':<30} {result.duration_seconds:.2f}")
        else:
            for result in results:
                if result.success:
                    response = APIResponse.ok(result)
                else:
                    response = APIResponse.from_exception(
                        Exception(result.error_message or "Generation failed")
                    )
                click.echo(response.model_dump_json(indent=2))

        success_count = sum(1 for r in results if r.success)
        failed_count = len(results) - success_count
        click.echo(f"\nTotal: {len(results)} | Success: {success_count} | Failed: {failed_count}")

    sys.exit(0 if failed_count == 0 else 1)


@cli.command()
@click.pass_context
def status(ctx):
    """Show current configuration status."""
    settings = ctx.obj["settings"]
    click.echo(f"Environment: {settings.environment}")
    click.echo(f"Debug: {settings.debug}")
    click.echo(f"Log Level: {settings.log_level}")
    click.echo(f"ClickUp URL: {settings.clickup_signup_url}")
    click.echo(f"Database: {settings.database.url.split('@')[-1]}")
    click.echo(f"Rate Limiting: {settings.rate_limit.enabled}")
    click.echo(f"Metrics Enabled: {settings.metrics_enabled}")


@cli.command()
@click.argument("key")
@click.pass_context
def secret(ctx, key):
    """Retrieve a secret from the configured backend."""
    settings = ctx.obj["settings"]
    manager = get_secrets_manager(settings.secrets)
    value = manager.get_secret(key)
    if value is None:
        click.echo(f"Secret not found: {key}", err=True)
        sys.exit(1)
    click.echo(f"{key}={value}")


if __name__ == "__main__":
    cli()
