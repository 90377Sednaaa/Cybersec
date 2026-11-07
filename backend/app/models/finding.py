"""Security findings and the human-verification state machine."""

import enum
from datetime import datetime

from sqlalchemy import DateTime, Enum, Float, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.user import utcnow


class FindingStatus(str, enum.Enum):
    ai_candidate = "ai_candidate"  # produced by AI/raw tool output; NOT confirmed
    needs_evidence = "needs_evidence"  # looks real but lacks proof
    verified = "verified"  # confirmed by a human assessor
    false_positive = "false_positive"  # dismissed by a human assessor


class Severity(str, enum.Enum):
    info = "info"
    low = "low"
    medium = "medium"
    high = "high"
    critical = "critical"


class Finding(Base):
    __tablename__ = "findings"

    id: Mapped[int] = mapped_column(primary_key=True)
    assessment_id: Mapped[int | None] = mapped_column(ForeignKey("assessments.id"), nullable=True)
    source_job_id: Mapped[int | None] = mapped_column(ForeignKey("jobs.id"), nullable=True)
    category: Mapped[str] = mapped_column(String(64), default="")  # see docs/PLAN.md §4
    title: Mapped[str] = mapped_column(String(500))
    description: Mapped[str] = mapped_column(Text, default="")
    severity: Mapped[Severity] = mapped_column(Enum(Severity, native_enum=False), default=Severity.low)
    score: Mapped[float] = mapped_column(Float, default=0.0)  # 0-10, OWASP Risk Rating mapped
    status: Mapped[FindingStatus] = mapped_column(
        Enum(FindingStatus, native_enum=False), default=FindingStatus.ai_candidate
    )
    ai_confidence: Mapped[float] = mapped_column(Float, default=0.0)  # 0-1, from AI interpreter
    remediation: Mapped[str] = mapped_column(Text, default="")
    assessor_notes: Mapped[str] = mapped_column(Text, default="")
    verified_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    assessment = relationship("Assessment", back_populates="findings")
    evidence = relationship("Evidence", back_populates="finding", order_by="Evidence.id")
