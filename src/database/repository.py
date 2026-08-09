"""Repository pattern for database operations."""

from typing import List, Optional, TypeVar
from uuid import UUID

from sqlalchemy.orm import Session

from src.database.models import Account, AccountStatus, AuditLog

T = TypeVar("T")


class AccountRepository:
    """Repository for Account entity operations."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def create(self, email: str, username: str, status: AccountStatus = AccountStatus.PENDING) -> Account:
        """Create a new account record."""
        account = Account(email=email, username=username, status=status)
        self.db.add(account)
        self.db.commit()
        self.db.refresh(account)
        return account

    def get_by_email(self, email: str) -> Optional[Account]:
        """Fetch account by email."""
        return self.db.query(Account).filter(Account.email == email).first()

    def get_by_id(self, account_id: UUID) -> Optional[Account]:
        """Fetch account by ID."""
        return self.db.query(Account).filter(Account.id == account_id).first()

    def get_by_status(self, status: AccountStatus, limit: int = 100) -> List[Account]:
        """Fetch accounts by status with pagination."""
        return (
            self.db.query(Account)
            .filter(Account.status == status)
            .order_by(Account.created_at.desc())
            .limit(limit)
            .all()
        )

    def update_status(
        self,
        account: Account,
        status: AccountStatus,
        failure_reason: Optional[str] = None,
    ) -> Account:
        """Update account status."""
        account.status = status
        if failure_reason is not None:
            account.failure_reason = failure_reason
        self.db.commit()
        self.db.refresh(account)
        return account

    def set_clickup_metadata(
        self,
        account: Account,
        user_id: str,
        workspace_id: Optional[str] = None,
    ) -> Account:
        """Set ClickUp returned metadata."""
        account.clickup_user_id = user_id
        if workspace_id:
            account.workspace_id = workspace_id
        account.status = AccountStatus.ACTIVE
        self.db.commit()
        self.db.refresh(account)
        return account

    def delete(self, account: Account) -> None:
        """Delete an account record."""
        self.db.delete(account)
        self.db.commit()


class AuditRepository:
    """Repository for audit log operations."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def log(
        self,
        action: str,
        actor: str,
        account_id: Optional[UUID] = None,
        success: bool = True,
        details: Optional[str] = None,
        ip_address: Optional[str] = None,
        correlation_id: Optional[str] = None,
    ) -> AuditLog:
        """Create an audit log entry."""
        log_entry = AuditLog(
            account_id=account_id,
            action=action,
            actor=actor,
            success=success,
            details=details,
            ip_address=ip_address,
            correlation_id=correlation_id,
        )
        self.db.add(log_entry)
        self.db.commit()
        self.db.refresh(log_entry)
        return log_entry

    def get_by_account(self, account_id: UUID, limit: int = 100) -> List[AuditLog]:
        """Fetch audit logs for an account."""
        return (
            self.db.query(AuditLog)
            .filter(AuditLog.account_id == account_id)
            .order_by(AuditLog.created_at.desc())
            .limit(limit)
            .all()
        )
