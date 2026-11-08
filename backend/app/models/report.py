"""Generated assessment reports (M4 T4.4) - the PDF deliverable jobs.

One row per report generation attempt: POST creates a `pending` row and
returns 202, the background job flips it to `ready` (with file_path) or
`failed` (with an actionable error). New table, additive per the Wave-1
rule - no existing table is touched.
"""

import enum
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.user import utcnow

class ReportStatus(str, enum.Enum):
    pending = "pending"  # job queued, generation in progress
    ready = "ready"  # PDF written, downloadable
    failed = "failed"  # actionable error in `error` (e.g. Playwright missing)

class Report(Base):
    __tablename__ = "reports"

    id: Mapped[int] = mapped_column(primary_key=True)
    assessment_id: Mapped[int] = mapped_column(ForeignKey("assessments.id"))
    status: Mapped[ReportStatus] = mapped_column(
        Enum(ReportStatus, native_enum=False), default=ReportStatus.pending
    )
    error: Mapped[str] = mapped_column(Text, default="")
    file_path: Mapped[str] = mapped_column(String(2048), default="")  # UUID name under backend/reports/
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
