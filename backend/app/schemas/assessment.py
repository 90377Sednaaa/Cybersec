"""Assessment & job API contract (M1, frozen in docs/TASK_PLAN.md Wave 1).

Mirrors these endpoints:
    POST   /api/assessments                  {target_id, intensity?, categories?} -> 201 AssessmentDetail
    GET    /api/assessments                  -> AssessmentOut[]
    GET    /api/assessments/{id}             -> AssessmentDetail (includes jobs)
    GET    /api/assessments/{id}/events      -> text/event-stream (SSE, JSON payloads)
    POST   /api/assessments/{id}/cancel      -> 202

Error convention: FastAPI `detail` strings; 403 role violations; 409 intensity-gate violations and
illegal state transitions. SSE event payloads are ScanEvent dicts (see ScanEvent below).
"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models import AssessmentStatus, JobStatus, ScanIntensity

# The categories M1's pipeline knows how to fill. M2's interpreter may attach
# more specific sub-labels later; the top-level set stays frozen.
KNOWN_CATEGORIES = [
    "Input validation & injection",
    "Security configuration & HTTPS",
    "Exposed files & directories",
    "Information disclosure",
    "Session management",
]


class AssessmentCreate(BaseModel):
    target_id: int
    # Defaults to the target's allowed_intensity when omitted; requesting a higher
    # intensity than the target allows is a 409 (gate enforced server-side).
    intensity: ScanIntensity | None = None
    categories: list[str] = Field(default_factory=lambda: list(KNOWN_CATEGORIES))


class JobOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    assessment_id: int | None
    tool: str
    command: str
    status: JobStatus
    progress: float
    started_at: datetime | None
    finished_at: datetime | None


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


class AssessmentDetail(AssessmentOut):
    jobs: list[JobOut] = []


class ScanEvent(BaseModel):
    """One SSE payload. `type` discriminates:

    - log:        a single log line from a job        {type, job_id, line}
    - job:        job state change                   {type, job_id, status, progress}
    - assessment: assessment state change            {type, status}
    - snapshot:   full state on connect/reconnect    {type, assessment}
    """

    type: str
    job_id: int | None = None
    line: str | None = None
    status: str | None = None
    progress: float | None = None
    assessment: AssessmentDetail | None = None
