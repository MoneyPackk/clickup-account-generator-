# Multi-stage production Dockerfile for clickup-account-generator
ARG PYTHON_VERSION=3.12

# Build stage
FROM python:${PYTHON_VERSION}-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /build

# Install system dependencies required for building packages and Chrome support
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    curl \
    gnupg \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt requirements-dev.txt ./
RUN pip install --user -r requirements.txt

# Production stage
FROM python:${PYTHON_VERSION}-slim AS production

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/root/.local/bin:${PATH}" \
    APP_HOME=/app \
    ENVIRONMENT=production

WORKDIR ${APP_HOME}

# Install runtime dependencies: Chromium and ChromeDriver
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    chromium-driver \
    libglib2.0-0 \
    libnss3 \
    libgconf-2-4 \
    libfontconfig1 \
    libxss1 \
    libappindicator3-1 \
    libasound2 \
    libxtst6 \
    xdg-utils \
    libgbm1 \
    libgtk-3-0 \
    ca-certificates \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

# Add non-root user for security
RUN groupadd -r appgroup && useradd -r -g appgroup appuser

# Copy Python dependencies
COPY --from=builder /root/.local /home/appuser/.local
ENV PATH="/home/appuser/.local/bin:${PATH}"

# Copy application code
COPY --chown=appuser:appgroup src/ src/
COPY --chown=appuser:appgroup config/ config/
COPY --chown=appuser:appgroup migrations/ migrations/
COPY --chown=appuser:appgroup migrations/alembic.ini alembic.ini

# Create logs directory
RUN mkdir -p logs && chown -R appuser:appgroup logs

USER appuser

EXPOSE 5000 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:5000/health')" || exit 1

CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "4", "--timeout", "120", "--access-logfile", "-", "src.server:app"]
