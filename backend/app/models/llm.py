"""LLM provider configuration (OpenAI-compatible endpoints) and per-task model config.

Stored in the DB so the Settings UI can change providers/models without redeploying.
API keys are encrypted at rest with Fernet (key derived from settings.secret_key).
"""

import base64
import enum
import hashlib
from datetime import datetime

from cryptography.fernet import Fernet
from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Float, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.config import settings
from app.database import Base
from app.models.user import utcnow


class LLMTask(str, enum.Enum):
    interpretation = "interpretation"  # scan output -> structured findings (fast model)
    summary = "summary"  # executive/per-finding summaries for reports (reasoning model)
    prioritization = "prioritization"  # risk ordering (reasoning model, stretch)
    qa = "qa"  # per-finding analyst Q&A (stretch)


def _fernet() -> Fernet:
    digest = hashlib.sha256(settings.secret_key.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_secret(plain: str) -> str:
    return _fernet().encrypt(plain.encode()).decode()


def decrypt_secret(token: str) -> str:
    return _fernet().decrypt(token.encode()).decode()


class LLMProvider(Base):
    __tablename__ = "llm_providers"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(64), unique=True)  # e.g. "OpenRouter", "DeepSeek", "Ollama"
    base_url: Mapped[str] = mapped_column(String(2048))  # OpenAI-compatible base, e.g. https://openrouter.ai/api/v1
    api_key_encrypted: Mapped[str] = mapped_column(Text, default="")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    # discretion audit: when the admin acknowledged external processing
    # (additive column, M2 T2.2)
    acknowledged_external_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    task_configs = relationship("LLMTaskConfig", back_populates="provider")


class LLMTaskConfig(Base):
    __tablename__ = "llm_task_configs"

    id: Mapped[int] = mapped_column(primary_key=True)
    task: Mapped[LLMTask] = mapped_column(Enum(LLMTask, native_enum=False), unique=True)
    provider_id: Mapped[int | None] = mapped_column(ForeignKey("llm_providers.id"), nullable=True)
    model: Mapped[str] = mapped_column(String(255), default="")
    temperature: Mapped[float] = mapped_column(Float, default=0.2)
    # Model-specific reasoning effort (e.g. "high", "xhigh", "max"). Empty means
    # the model uses temperature instead. Additive column, backfilled as "".
    effort: Mapped[str] = mapped_column(String(32), default="")

    provider = relationship("LLMProvider", back_populates="task_configs")


class AIOutput(Base):
    """Stored AI output (PLAN.md section 9: ai_outputs): which model produced
    what, when, and for which assessment/finding. Doubles as the "AI outputs"
    evidence deliverable for the final report - a full audit trail of what the
    AI said, kept separate from human-verified findings."""

    __tablename__ = "ai_outputs"

    id: Mapped[int] = mapped_column(primary_key=True)
    task: Mapped[LLMTask] = mapped_column(Enum(LLMTask, native_enum=False))
    assessment_id: Mapped[int | None] = mapped_column(ForeignKey("assessments.id"), nullable=True)
    finding_id: Mapped[int | None] = mapped_column(ForeignKey("findings.id"), nullable=True)
    model: Mapped[str] = mapped_column(String(255), default="")
    content: Mapped[str] = mapped_column(Text, default="")  # JSON stored verbatim
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
