"""Evidence attached to findings (auto-captured or manually uploaded)."""

import enum
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.user import utcnow


class EvidenceKind(str, enum.Enum):
    http_transcript = "http_transcript"  # request/response pair captured by the prober
    tool_output = "tool_output"  # snippet of raw tool output
    upload = "upload"  # manual file/screenshot upload by the assessor


class Evidence(Base):
    __tablename__ = "evidence"

    id: Mapped[int] = mapped_column(primary_key=True)
    finding_id: Mapped[int] = mapped_column(ForeignKey("findings.id"))
    kind: Mapped[EvidenceKind] = mapped_column(
        Enum(EvidenceKind, native_enum=False), default=EvidenceKind.tool_output
    )
    label: Mapped[str] = mapped_column(String(255), default="")
    content: Mapped[str] = mapped_column(Text, default="")
    file_path: Mapped[str] = mapped_column(String(2048), default="")
    tool: Mapped[str] = mapped_column(String(64), default="")
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    finding = relationship("Finding", back_populates="evidence")
