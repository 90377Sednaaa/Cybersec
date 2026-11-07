"""Assessment runs and their pipeline state."""

import enum
from datetime import datetime

from sqlalchemy import DateTime, Enum, JSON, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.target import ScanIntensity
from app.models.user import utcnow


class AssessmentStatus(str, enum.Enum):
    draft = "draft"
    running = "running"
    completed = "completed"
    failed = "failed"
    cancelled = "cancelled"


class Assessment(Base):
    __tablename__ = "assessments"

    id: Mapped[int] = mapped_column(primary_key=True)
    target_id: Mapped[int] = mapped_column(ForeignKey("targets.id"))
    intensity: Mapped[ScanIntensity] = mapped_column(
        Enum(ScanIntensity, native_enum=False), default=ScanIntensity.passive_safe
    )
    # Selected subset of the committed categories (see docs/PLAN.md §4)
    categories: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[AssessmentStatus] = mapped_column(
        Enum(AssessmentStatus, native_enum=False), default=AssessmentStatus.draft
    )
    started_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    notes: Mapped[str] = mapped_column(String(2000), default="")

    target = relationship("Target", foreign_keys=[target_id])
    jobs = relationship("Job", back_populates="assessment", order_by="Job.id")
    findings = relationship("Finding", back_populates="assessment")
