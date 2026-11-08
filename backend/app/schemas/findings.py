"""M4 contract schemas: findings updates, evidence, reports.

Field-level shapes for the frozen Wave-1 endpoints (docs/TASK_PLAN.md
appendix): PATCH /api/findings/{id}, POST /api/findings/{id}/evidence,
POST /api/assessments/{id}/report and GET /api/reports/{id}. The list
response shape (FindingOut) is frozen in schemas/common.py and is
deliberately not touched — new shapes live here instead.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.models import EvidenceKind, FindingStatus, Severity
from app.schemas.common import FindingOut

# --- Findings (PATCH body + detail response) --------------------------------

class FindingUpdate(BaseModel):
    """PATCH /api/findings/{id} body — all fields optional, but the
    endpoint requires at least one so a bare PATCH is a 422, not a no-op."""
    status: FindingStatus | None = None
    severity: Severity | None = None
    score: float | None = Field(default=None, ge=0, le=10)
    assessor_notes: str | None = Field(default=None, max_length=4000)

class EvidenceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    finding_id: int
    kind: EvidenceKind
    label: str
    content: str
    tool: str
    captured_at: datetime
    # NOTE: file_path is intentionally NOT exposed. Uploaded files download
    # through GET /api/evidence/{id}/download so stored paths never leak
    # and nothing is served straight from disk as executable content.

class FindingDetailOut(FindingOut):
    """GET /api/findings/{id} — the frozen FindingOut fields plus the
    verification audit trail and the finding's evidence items."""
    model_config = ConfigDict(from_attributes=True)

    verified_by_id: int | None = None
    verified_at: datetime | None = None
    verified_by: str | None = None  # email of the verifying user; filled by the endpoint
    evidence: list[EvidenceOut] = []

# --- Reports ------------------------------------------------------------------

class ReportOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    assessment_id: int
    status: Literal["pending", "ready", "failed"]
    error: str = ""
    created_at: datetime
    finished_at: datetime | None = None
