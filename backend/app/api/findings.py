"""Findings API (M4 owns this file from Wave 2).

M1 seeded this minimal read-only list so the orchestrator's smoke tests can
see normalizer output. M4 replaces/extends it with filters, detail, the
verification state machine, and evidence endpoints per the frozen contract
(docs/TASK_PLAN.md appendix). The response shape (FindingOut) is already the
contract shape.
"""

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.database import get_db
from app.models import Finding, User
from app.schemas.common import FindingOut

router = APIRouter(prefix="/findings", tags=["findings"])


@router.get("", response_model=list[FindingOut])
def list_findings(
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[Finding]:
    return list(db.scalars(select(Finding).order_by(Finding.id.desc()).limit(200)))
