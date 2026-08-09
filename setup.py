"""Setup configuration for clickup-account-generator."""

from pathlib import Path

from setuptools import find_packages, setup

README = (Path(__file__).parent / "README.md").read_text(encoding="utf-8")

setup(
    name="clickup-account-generator",
    version="1.0.0",
    description="Enterprise-grade ClickUp account generator",
    long_description=README,
    long_description_content_type="text/markdown",
    author="MoneyPackk",
    author_email="contact@example.com",
    url="https://github.com/MoneyPackk/clickup-account-generator-",
    package_dir={"": "src"},
    packages=find_packages(where="src"),
    include_package_data=True,
    python_requires=">=3.10",
    install_requires=[
        "selenium>=4.15.0",
        "webdriver-manager>=4.0.1",
        "pydantic>=2.5.0",
        "pydantic-settings>=2.1.0",
        "python-dotenv>=1.0.0",
        "email-validator>=2.1.0",
        "sqlalchemy>=2.0.23",
        "alembic>=1.13.0",
        "psycopg2-binary>=2.9.9",
        "cryptography>=41.0.7",
        "structlog>=23.2.0",
        "python-json-logger>=2.0.7",
        "prometheus-client>=0.19.0",
        "tenacity>=8.2.3",
        "circuitbreaker>=1.4.0",
        "flask>=3.0.0",
        "gunicorn>=21.2.0",
        "click>=8.1.0",
        "httpx>=0.25.2",
    ],
    extras_require={
        "dev": [
            "black>=23.11.0",
            "isort>=5.13.0",
            "flake8>=6.1.0",
            "mypy>=1.7.0",
            "pytest>=7.4.3",
            "pytest-asyncio>=0.21.1",
            "pytest-cov>=4.1.0",
            "pytest-mock>=3.12.0",
            "factory-boy>=3.3.0",
            "faker>=20.1.0",
        ],
        "vault": ["hvac>=1.2.1"],
        "aws": ["boto3>=1.34.0"],
    },
    classifiers=[
        "Development Status :: 4 - Beta",
        "Intended Audience :: Developers",
        "License :: OSI Approved :: MIT License",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
        "Programming Language :: Python :: 3.12",
        "Topic :: Software Development :: Libraries :: Python Modules",
    ],
    entry_points={
        "console_scripts": [
            "clickup-generator=src.cli.commands:cli",
        ],
    },
)
