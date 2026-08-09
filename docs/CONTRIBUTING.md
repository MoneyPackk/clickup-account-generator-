# Contributing Guide

## Development setup

```bash
git clone https://github.com/MoneyPackk/clickup-account-generator-.git
cd clickup-account-generator-
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements-dev.txt
cp .env.example .env            # edit as needed
```

## Running tests

```bash
# Unit tests only (fast, no external services)
pytest -m unit

# All tests with coverage
pytest --cov=src --cov-report=term-missing

# Specific file
pytest tests/test_helpers.py -v
```

## Code style

```bash
black src tests
isort src tests
flake8 src tests
mypy src
```

## Making a change

1. Create a feature branch: `git checkout -b feat/my-change`
2. Write tests first where practical
3. Implement the change
4. Run `pytest -m unit` and fix any failures
5. Open a pull request against `main`

## Adding a new configuration option

1. Add the field to the appropriate `*Settings` class in `src/core/config.py`
2. Add the variable to `.env.example` with a comment
3. Document it in `docs/CONFIGURATION.md`

## Database changes

1. Edit or add models in `src/database/models.py`
2. Generate a migration: `alembic revision --autogenerate -m "describe change"`
3. Review the generated file in `alembic/versions/`
4. Apply locally: `alembic upgrade head`

## Pull request checklist

- [ ] Tests added or updated
- [ ] `pytest -m unit` passes
- [ ] No secrets committed (run `git diff` and inspect)
- [ ] `.env.example` updated if new env vars added
- [ ] `docs/` updated if behaviour changed

---

<div align="center">

**💰 MONEYPACK 💰**

</div>
