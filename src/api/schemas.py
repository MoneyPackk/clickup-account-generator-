"""Pydantic schemas for API request/response models."""

from datetime import datetime
from typing import Any, Dict, Optional
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field


class AccountPayload(BaseModel):
    """Payload for creating a ClickUp account."""

    email: EmailStr
    username: str = Field(..., min_length=3, max_length=64)
    password: str = Field(..., min_length=12)
    workspace_name: Optional[str] = None
    locale: str = "en-US"
    timezone: str = "UTC"


class TwoFactorPayload(BaseModel):
    """Payload for two-factor authentication setup."""

    method: str = Field(..., pattern="^(email|totp|sms)$")
    token: Optional[str] = None
    secret: Optional[str] = None


class AccountResponse(BaseModel):
    """Response model after account creation."""

    id: Optional[str] = None
    email: EmailStr
    username: str
    workspace_id: Optional[str] = None
    user_id: Optional[str] = None
    two_factor_enabled: bool = False
    metadata: Dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class GenerationResult(BaseModel):
    """Internal result of account generation workflow."""

    success: bool
    account_id: Optional[UUID] = None
    email: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    error_code: Optional[str] = None
    error_message: Optional[str] = None
    duration_seconds: float = 0.0

    class Config:
        from_attributes = True
