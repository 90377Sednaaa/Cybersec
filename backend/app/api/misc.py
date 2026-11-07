"""Health check and scaffold stubs for later-milestone routers."""

from fastapi import APIRouter, Depends

from app.core.deps import get_current_user
from app.models import User

router = APIRouter(tags=["misc"])


@router.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "security-platform-api"}


@router.get("/assessments", tags=["assessments"])
def list_assessments(user: User = Depends(get_current_user)) -> list[dict]:
    """Stub — replaced by the orchestrated pipeline in milestone 4 (M1)."""
    return []


@router.get("/findings", tags=["findings"])
def list_findings(user: User = Depends(get_current_user)) -> list[dict]:
    """Stub — replaced by the findings workflow in milestone 6 (M4)."""
    return []
