"""LLM provider configuration (OpenAI-compatible endpoints) and per-task model config.

Stored in the DB so the Settings UI can change providers/models without redeploying.
API keys are encrypted at rest with Fernet (key derived from settings.secret_key).
"""

import base64
import enum
import hashlib

from cryptography.fernet import Fernet
from sqlalchemy import Boolean, Enum, ForeignKey, Float, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.config import settings
from app.database import Base


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

    task_configs = relationship("LLMTaskConfig", back_populates="provider")


class LLMTaskConfig(Base):
    __tablename__ = "llm_task_configs"

    id: Mapped[int] = mapped_column(primary_key=True)
    task: Mapped[LLMTask] = mapped_column(Enum(LLMTask, native_enum=False), unique=True)
    provider_id: Mapped[int | None] = mapped_column(ForeignKey("llm_providers.id"), nullable=True)
    model: Mapped[str] = mapped_column(String(255), default="")
    temperature: Mapped[float] = mapped_column(Float, default=0.2)

    provider = relationship("LLMProvider", back_populates="task_configs")
