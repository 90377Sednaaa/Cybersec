"""Import all models so Base.metadata sees every table."""

from app.models.user import Role, User
from app.models.target import ScanIntensity, Target
from app.models.assessment import Assessment, AssessmentStatus
from app.models.job import Job, JobStatus
from app.models.finding import Finding, FindingStatus, Severity
from app.models.evidence import Evidence, EvidenceKind
from app.models.llm import AIOutput, LLMProvider, LLMTask, LLMTaskConfig

__all__ = [
    "Role",
    "User",
    "ScanIntensity",
    "Target",
    "Assessment",
    "AssessmentStatus",
    "Job",
    "JobStatus",
    "Finding",
    "FindingStatus",
    "Severity",
    "Evidence",
    "EvidenceKind",
    "LLMProvider",
    "LLMTask",
    "LLMTaskConfig",
    "AIOutput",
]
