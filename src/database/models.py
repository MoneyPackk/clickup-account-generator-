"""SQLAlchemy models for account tracking."""

import uuid
from datetime import datetime
from enum import Enum as PyEnum

from sqlalchemy import Boolean, Column, DateTime, Enum, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID

from .base import Base


class AccountStatus(PyEnum):
    """Account lifecycle status."""

    PENDING = "pending"
    CREATING = "creating"
    ACTIVE = "active"
    FAILED = "failed"
    SUSPENDED = "suspended"
    DISABLED = "disabled"


class TwoFactorMethod(PyEnum):
    """Two-factor authentication method."""

    NONE = "none"
    EMAIL = "email"
    TOTP = "totp"


class Account(Base):
    """Account record model."""

    __tablename__ = "accounts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(254), nullable=False, unique=True, index=True)
    username = Column(String(64), nullable=False, unique=True, index=True)
    password_hash = Column(String(255), nullable=True)
    status = Column(
        Enum(AccountStatus, name="account_status"),
        nullable=False,
        default=AccountStatus.PENDING,
    )
    two_factor_method = Column(
        Enum(TwoFactorMethod, name="two_factor_method"),
        nullable=False,
        default=TwoFactorMethod.NONE,
    )
    two_factor_secret = Column(String(255), nullable=True)
    clickup_user_id = Column(String(128), nullable=True, index=True)
    workspace_id = Column(String(128), nullable=True)
    metadata_json = Column(Text, nullable=True)
    failure_reason = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    verified_at = Column(DateTime, nullable=True)

    def __repr__(self) -> str:
        return f"<Account(id={self.id}, email={self.email}, status={self.status.value})>"


class AuditLog(Base):
    """Audit log for compliance and security tracking."""

    __tablename__ = "audit_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    account_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    action = Column(String(64), nullable=False, index=True)
    actor = Column(String(128), nullable=False)
    ip_address = Column(String(45), nullable=True)
    user_agent = Column(Text, nullable=True)
    before_state = Column(Text, nullable=True)
    after_state = Column(Text, nullable=True)
    correlation_id = Column(String(64), nullable=True, index=True)
    success = Column(Boolean, nullable=False, default=True)
    details = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    def __repr__(self) -> str:
        return f"<AuditLog(id={self.id}, action={self.action}, actor={self.actor})>"
