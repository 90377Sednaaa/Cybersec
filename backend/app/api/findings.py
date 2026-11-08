"""Findings API (M4): filtered list, detail, and the verification state machine.

The verification workflow is server-enforced (platform hard rule: humans confirm):
- only assessors/admins may mutate — a viewer PATCH is a 403;
- status changes must follow ALLOWED_TRANSITIONS — anything else is a 409;
- every transition to `verified` stamps verified_by/verified_at from the JWT
  user, so a verified finding always has an attributing human.

The list/detail response shape (FindingOut) is the frozen Wave-1 contract
(docs/TASK_PLAN.md appendix) and comes from schemas/common.py unchanged.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, require_role
from app.database import get_db
from app.models import Finding, FindingStatus, Role, Severity, User
from app.models.user import utcnow
from app.schemas.common import FindingOut
from app.schemas.findings import FindingDetailOut, FindingUpdate

router = APIRouter(prefix="/findings", tags=["findings"])

# Legal status transitions; any other move is rejected with 409.
# verified/false_positive can be reopened (assessors change their minds),
# but nothing ever re-enters `verified` without going through this table.
ALLOWED_TRANSITIONS: dict[FindingStatus, set[FindingStatus]] = {
    FindingStatus.ai_candidate: {
        FindingStatus.verified,
        FindingStatus.false_positive,
        FindingStatus.needs_evidence,
    },
    FindingStatus.needs_evidence: {FindingStatus.verified, FindingStatus.false_positive},
    FindingStatus.verified: {FindingStatus.false_positive, FindingStatus.needs_evidence},
    FindingStatus.false_positive: {FindingStatus.ai_candidate},
}

def _get_finding_or_404(db: Session, finding_id: int) -> Finding:
    finding = db.get(Finding, finding_id)
    if finding is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Finding not found")
    return finding

@router.get("", response_model=list[FindingOut])
def list_findings(
    assessment_id: int | None = None,
    status: FindingStatus | None = None,
    severity: Severity | None = None,
    category: str | None = None,
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[Finding]:
    query = select(Finding).order_by(Finding.id.desc()).limit(200)
    if assessment_id is not None:
        query = query.where(Finding.assessment_id == assessment_id)
    if status is not None:
        query = query.where(Finding.status == status)
    if severity is not None:
        query = query.where(Finding.severity == severity)
    if category is not None:
        query = query.where(Finding.category == category)
    return list(db.scalars(query))

@router.get("/{finding_id}", response_model=FindingDetailOut)
def get_finding(
    finding_id: int,
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FindingDetailOut:
    finding = _get_finding_or_404(db, finding_id)
    out = FindingDetailOut.model_validate(finding)
    if finding.verified_by_id is not None:
        verifier = db.get(User, finding.verified_by_id)
        out.verified_by = verifier.email if verifier else None
    return out

@router.patch("/{finding_id}", response_model=FindingOut)
def update_finding(
    finding_id: int,
    payload: FindingUpdate,
    user: User = Depends(require_role(Role.assessor, Role.admin)),
    db: Session = Depends(get_db),
) -> Finding:
    finding = _get_finding_or_404(db, finding_id)
    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "PATCH body is empty")

    new_status = changes.get("status")
    if new_status is not None and new_status != finding.status:
        if new_status not in ALLOWED_TRANSITIONS[finding.status]:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"Illegal transition: {finding.status.value} -> {new_status.value}",
            )

    for field in ("severity", "score", "assessor_notes"):
        if field in changes:
            setattr(finding, field, changes[field])

    if new_status is not None and new_status != finding.status:
        finding.status = new_status
        if new_status == FindingStatus.verified:
            # attribution is taken from the JWT identity, never from the body
            finding.verified_by_id = user.id
            finding.verified_at = utcnow()
        else:
            # reopening drops the stale attribution; re-verifying re-stamps it
            finding.verified_by_id = None
            finding.verified_at = None

    db.commit()
    db.refresh(finding)
    return finding
