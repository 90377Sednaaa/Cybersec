"""Registered assessment targets and authorization/scope data."""

import enum
from datetime import datetime

from sqlalchemy import JSON, DateTime, Enum, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.user import utcnow


class ScanIntensity(str, enum.Enum):
    """How intrusive scanning is allowed to be against this target.

    passive_safe: HTTP prober headers/TLS/cookies, ZAP spider, Nmap top-ports —
                  non-destructive, acceptable for production sites we own.
    full_intrusive: adds ZAP active scan and wordlist brute-forcing — only for
                    intentionally vulnerable / dedicated test targets.
    """

    passive_safe = "passive_safe"
    full_intrusive = "full_intrusive"


class Target(Base):
    __tablename__ = "targets"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    base_url: Mapped[str] = mapped_column(String(2048))
    authorization_ref: Mapped[str] = mapped_column(String(255), default="")
    allowed_intensity: Mapped[ScanIntensity] = mapped_column(
        Enum(ScanIntensity, native_enum=False), default=ScanIntensity.passive_safe
    )
    in_scope_assets: Mapped[list] = mapped_column(JSON, default=list)
    out_of_scope_assets: Mapped[list] = mapped_column(JSON, default=list)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    created_by = relationship("User", foreign_keys=[created_by_id])
