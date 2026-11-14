"""Pydantic request/response schemas."""

from datetime import datetime
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

from app.models import (
    AssessmentStatus,
    FindingStatus,
    Role,
    ScanIntensity,
    Severity,
)


# --- Auth / users -----------------------------------------------------------


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: Role
    full_name: str


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: EmailStr
    full_name: str
    role: Role


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    full_name: str = ""
    role: Role = Role.assessor


# --- Targets ----------------------------------------------------------------


class TargetBase(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    base_url: str = Field(min_length=1)
    authorization_ref: str = ""
    allowed_intensity: ScanIntensity = ScanIntensity.passive_safe
    in_scope_assets: list[str] = []
    out_of_scope_assets: list[str] = []


def _validate_base_url(value: str) -> str:
    """Require an absolute http(s) URL with a hostname (proposal 05).

    Deliberately does not normalize: Pydantic's HttpUrl would append a trailing
    slash and silently rewrite stored values. Only the scheme and host are
    enforced here; the private/loopback policy lives in the scan engine, which
    can see the authorization record.
    """
    raw = value.strip()
    parts = urlsplit(raw)
    if parts.scheme not in ("http", "https"):
        raise ValueError("base_url must start with http:// or https://")
    if not parts.hostname:
        raise ValueError("base_url must include a hostname")
    return raw


def _validate_authorization_ref(value: str) -> str:
    cleaned = value.strip()
    if len(cleaned) < 3:
        raise ValueError(
            "authorization_ref is required: record who authorized this assessment (ticket, contract or sign-off)"
        )
    return cleaned


class TargetCreate(TargetBase):
    """New target. `authorization_ref` is mandatory (proposal 05) - a target
    with no authorization record may not be registered at all.

    Declared without a default so it is required: Pydantic does not run field
    validators on defaults, so inheriting `""` would have accepted an empty
    reference.
    """

    authorization_ref: str

    @field_validator("base_url")
    @classmethod
    def _check_base_url(cls, value: str) -> str:
        return _validate_base_url(value)

    @field_validator("authorization_ref")
    @classmethod
    def _check_authorization_ref(cls, value: str) -> str:
        return _validate_authorization_ref(value)


class TargetPatch(BaseModel):
    """Partial update. Replaces the old PUT mass-assign, which reset
    `authorization_ref` and both scope lists whenever a caller sent a partial
    body. Only fields present in the request are applied."""

    name: str | None = Field(default=None, min_length=1, max_length=255)
    base_url: str | None = Field(default=None, min_length=1)
    authorization_ref: str | None = None
    allowed_intensity: ScanIntensity | None = None
    in_scope_assets: list[str] | None = None
    out_of_scope_assets: list[str] | None = None

    @field_validator("base_url")
    @classmethod
    def _check_base_url(cls, value: str | None) -> str | None:
        return None if value is None else _validate_base_url(value)

    @field_validator("authorization_ref")
    @classmethod
    def _check_authorization_ref(cls, value: str | None) -> str | None:
        return None if value is None else _validate_authorization_ref(value)


class TargetOut(TargetBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime


# --- Assessments / findings (read-only for the scaffold; pipeline comes in M1) ---


class AssessmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    target_id: int
    intensity: ScanIntensity
    categories: list[str]
    status: AssessmentStatus
    started_at: datetime | None
    finished_at: datetime | None
    notes: str


class FindingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    assessment_id: int | None
    category: str
    title: str
    description: str
    severity: Severity
    score: float
    status: FindingStatus
    ai_confidence: float
    remediation: str
    assessor_notes: str


# --- LLM settings (key never leaves the API) --------------------------------


class LLMProviderIn(BaseModel):
    name: str
    base_url: str
    api_key: str = ""
    enabled: bool = True
    # discretion: enabling a provider means redacted scan data may be sent to
    # the external service; the admin must acknowledge that explicitly.
    acknowledged_external_processing: bool | None = None


class LLMProviderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    base_url: str
    enabled: bool
    has_api_key: bool
    acknowledged_external_at: datetime | None = None

    @model_validator(mode="before")
    @classmethod
    def derive_has_api_key(cls, data):
        if not isinstance(data, dict):
            return {"has_api_key": bool(getattr(data, "api_key_encrypted", "")), **vars(data)}
        return data


class LLMTaskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    task: str
    provider_id: int | None
    model: str
    temperature: float
    effort: str = ""  # model-specific reasoning effort, additive


class LLMTaskUpdate(BaseModel):
    provider_id: int | None
    model: str = ""
    temperature: float = 0.2
    # None keeps the stored value, so older clients that never send `effort`
    # cannot accidentally clear a level chosen in the new UI.
    effort: str | None = None


class LLMSettingsOut(BaseModel):
    providers: list[LLMProviderOut]
    task_configs: list[LLMTaskOut]


class LLMTestConnectionIn(BaseModel):
    provider_id: int


class LLMTestConnectionOut(BaseModel):
    ok: bool
    model: str = ""
    latency_ms: int | None = None
    error: str = ""


# --- Live model catalog (additive, read-only) -------------------------------


class LLMModelOut(BaseModel):
    """One chat-capable model, normalized across OpenAI-compatible providers.

    Prices are USD per 1M tokens. `free` is only true when the provider actually
    reported zero for both input and output pricing; absent pricing stays None.
    """

    id: str
    name: str
    free: bool = False
    prompt_price: float | None = None
    completion_price: float | None = None
    context_length: int | None = None
    reasoning: bool = False
    structured_outputs: bool = False
    zero_data_retention: bool = False
    # Model-specific reasoning effort levels, e.g. Gemini ["low", "medium", "high"]
    # vs Claude ["low", "medium", "high", "xhigh", "max"]. Empty for models that
    # use temperature instead.
    supported_efforts: list[str] = Field(default_factory=list)
    default_effort: str | None = None
    source: str = "live"


class LLMModelsOut(BaseModel):
    provider_id: int
    source: str = "live"  # "live" | "unavailable"
    zdr_supported: bool = False
    zdr_filter: bool = False
    models: list[LLMModelOut] = Field(default_factory=list)
    notice: str = ""
