"""SQLAlchemy database setup and session management."""

from contextlib import contextmanager
from typing import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, declarative_base, sessionmaker

from src.core.config import Settings

Base = declarative_base()


def create_engine_from_settings(settings: Settings):
    """Create a SQLAlchemy engine from application settings."""
    url = settings.database.url
    # SQLite does not support connection-pool arguments used by server engines.
    if url.startswith("sqlite"):
        return create_engine(url, echo=settings.database.echo)
    return create_engine(
        url,
        pool_size=settings.database.pool_size,
        max_overflow=settings.database.pool_overflow,
        pool_recycle=settings.database.pool_recycle,
        echo=settings.database.echo,
    )


settings = Settings()
engine = create_engine_from_settings(settings)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db() -> Generator[Session, None, None]:
    """Yield a database session for dependency injection."""
    db = SessionLocal()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


@contextmanager
def get_db_context() -> Generator[Session, None, None]:
    """Context manager for database sessions."""
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
