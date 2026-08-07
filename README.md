# ClickUp Account Generator - Enterprise Edition

A production-ready, enterprise-grade Python solution for automated ClickUp account generation with comprehensive security, monitoring, and reliability features.

## 📋 Table of Contents

- [Features](#features)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Deployment](#deployment)
- [Architecture](#architecture)
- [Contributing](#contributing)

## ✨ Features

### Core Capabilities
- ✅ Automated ClickUp account creation via Selenium automation
- ✅ Secure credential generation and management
- ✅ Two-factor authentication (2FA) support
- ✅ Batch account creation with configurable parameters

### Enterprise Features
- 🔒 **Security**: Input validation, secrets management, rate limiting
- 📊 **Monitoring**: Prometheus metrics, structured JSON logging
- 🔄 **Resilience**: Exponential backoff, circuit breakers, retry logic
- 🗄️ **Persistence**: SQLAlchemy ORM with database migrations
- 📦 **Deployment**: Docker, docker-compose, Kubernetes ready
- 🧪 **Testing**: >80% coverage with unit & integration tests
- 📚 **Documentation**: Complete API docs and deployment guides

## 🚀 Quick Start

### Prerequisites
- Python 3.10+
- Chrome/Chromium browser
- PostgreSQL (for production)
- Docker (optional, for containerized deployment)

### Installation

```bash
# Clone repository
git clone https://github.com/MoneyPackk/clickup-account-generator-.git
cd clickup-account-generator-

# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Setup environment
cp .env.example .env
# Edit .env with your configuration
```

### Basic Usage

```python
from src.account.generator import ClickUpAccountGenerator
from src.core.config import AccountConfig

# Configure
config = AccountConfig(
    email_domain="company.com",
    min_password_length=18,
    enable_two_factor=True
)

# Generate account
generator = ClickUpAccountGenerator(config)
result = generator.generate_account()

print(result)
# Output: {
#   "success": True,
#   "email": "user_abc123@company.com",
#   "password": "SecurePassword123!@#",
#   "username": "user_abc123"
# }
```

## ⚙️ Configuration

### Environment Variables

```bash
# Application
ENVIRONMENT=development  # development, staging, production
LOG_LEVEL=INFO
DEBUG=false

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/clickup_gen
DATABASE_POOL_SIZE=10
DATABASE_POOL_RECYCLE=3600

# ClickUp
CLICKUP_BASE_URL=https://app.clickup.com
CLICKUP_TIMEOUT=30
CLICKUP_RETRIES=3
CLICKUP_RETRY_BACKOFF=2

# Security
RATE_LIMIT_REQUESTS=100
RATE_LIMIT_WINDOW=3600  # 1 hour
PASSWORD_MIN_LENGTH=16
PASSWORD_REQUIRE_SPECIAL=true

# Monitoring
METRICS_ENABLED=true
PROMETHEUS_PORT=8000
SENTRY_DSN=https://...

# Secrets Management
SECRETS_BACKEND=environment  # environment, vault, aws
VAULT_ADDR=http://vault:8200
AWS_REGION=us-east-1
```

See [CONFIGURATION.md](docs/CONFIGURATION.md) for complete configuration guide.

## 🐳 Docker Deployment

### Development

```bash
# Build and run with docker-compose
docker-compose up -d

# Run migrations
docker-compose exec app flask db upgrade

# View logs
docker-compose logs -f app
```

### Production

```bash
# Build production image
docker build -t clickup-generator:latest .

# Push to registry
docker push your-registry/clickup-generator:latest

# Deploy with Kubernetes
kubectl apply -f k8s/deployment.yaml
```

See [DEPLOYMENT.md](docs/DEPLOYMENT.md) for detailed deployment guide.

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────┐
│         API Client (REST/CLI)                    │
└─────────────────┬───────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────┐
│         Account Generator Service               │
├──────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐             │
│  │ Validation   │  │ Rate Limiter │             │
│  └──────────────┘  └──────────────┘             │
├──────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐             │
│  │ Browser Mgmt │  │ Retry Logic  │             │
│  └──────────────┘  └──────────────┘             │
└─────────────────┬───────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────┐
│         Data Layer (SQLAlchemy)                 │
├──────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐             │
│  │ Accounts     │  │ Audit Logs   │             │
│  └──────────────┘  └──────────────┘             │
└─────────────────┬───────────────────────────────┘
                  │
        ┌─────────▼──────────┐
        │  PostgreSQL DB     │
        └────────────────────┘
```

## 📊 Monitoring

### Prometheus Metrics

Available at `http://localhost:8000/metrics`:

- `account_generation_total` - Total accounts generated
- `account_generation_success_total` - Successful generations
- `account_generation_failures_total` - Failed generations
- `account_generation_duration_seconds` - Generation time histogram
- `rate_limiter_requests_total` - Total rate limit checks

### Logging

Logs are structured JSON format for easy aggregation:

```json
{
  "timestamp": "2024-01-15T10:30:45.123Z",
  "level": "INFO",
  "logger": "clickup_generator.account",
  "message": "Account generated successfully",
  "email": "user_abc123@company.com",
  "duration_ms": 2345,
  "trace_id": "abc123xyz789"
}
```

## 🧪 Testing

```bash
# Run all tests
pytest

# Run with coverage
pytest --cov=src --cov-report=html

# Run specific test suite
pytest tests/unit/
pytest tests/integration/

# Run with markers
pytest -m "not integration"
```

## 📚 Documentation

- [API Documentation](docs/API.md) - Complete API reference
- [Configuration Guide](docs/CONFIGURATION.md) - All configuration options
- [Deployment Guide](docs/DEPLOYMENT.md) - Production deployment
- [Architecture](docs/ARCHITECTURE.md) - System design and decisions
- [Contributing](docs/CONTRIBUTING.md) - Development guidelines

## 🔒 Security

- Input validation on all user inputs
- Secrets management (Vault, AWS Secrets Manager)
- Rate limiting (token bucket algorithm)
- Audit logging for compliance
- HTTPS enforcement
- CORS and CSRF protection
- Secure password generation
- Regular security audits

## 📈 Performance

- Connection pooling for database
- Async operations where applicable
- Caching for frequently accessed data
- Optimized Selenium driver usage
- Resource cleanup and memory management

## 🤝 Contributing

We welcome contributions! Please see [CONTRIBUTING.md](docs/CONTRIBUTING.md) for guidelines.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

- 📧 Email: support@example.com
- 🐛 Issues: https://github.com/MoneyPackk/clickup-account-generator-/issues
- 💬 Discussions: https://github.com/MoneyPackk/clickup-account-generator-/discussions

## ⚠️ Legal Notice

**Important**: Automating account creation may violate the Terms of Service of ClickUp or other services. Ensure you have:
- Explicit authorization from ClickUp
- Legal review of your use case
- Compliance with applicable laws and regulations

Use this tool responsibly and ethically.

---

**Built with ❤️ for enterprise reliability and security**
