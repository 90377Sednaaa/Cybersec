"""Pydantic request/response schemas."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator

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


class TargetCreate(TargetBase):
    pass


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


class LLMTaskUpdate(BaseModel):
    provider_id: int | None
    model: str = ""
    temperature: float = 0.2


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
