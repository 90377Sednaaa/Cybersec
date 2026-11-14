"""Findings API (M4): filtered list, detail, and the verification state machine.

The verification workflow is server-enforced (platform hard rule: humans confirm):
- only assessors/admins may mutate — a viewer PATCH is a 403;
- status changes must follow ALLOWED_TRANSITIONS — anything else is a 409;
- every transition to `verified` stamps verified_by/verified_at from the JWT
  user, so a verified finding always has an attributing human.

The list/detail response shape (FindingOut) is the frozen Wave-1 contract
(docs/TASK_PLAN.md appendix) and comes from schemas/common.py unchanged.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, require_role
from app.database import get_db
from app.models import Finding, FindingStatus, Role, Severity, User
from app.models.user import utcnow
from app.schemas.common import FindingOut
from app.schemas.findings import FindingDetailOut, FindingUpdate

router = APIRouter(prefix="/findings", tags=["findings"])

# Pagination bounds (proposal 06, accepted 2026-11-14). The default stays 200 so
# every existing caller is byte-identical; the cap stops a client from asking a
# SQLite demo instance for an unbounded result set.
DEFAULT_LIMIT = 200
MAX_LIMIT = 500

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
    response: Response,
    assessment_id: int | None = None,
    status: FindingStatus | None = None,
    severity: Severity | None = None,
    category: str | None = None,
    limit: int = Query(DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    offset: int = Query(0, ge=0),
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[Finding]:
    """Filtered list with bounded pagination (proposal 06).

    The body is unchanged: a bare `list[FindingOut]`. The authoritative count of
    the *filtered* set travels in `X-Total-Count`, so a caller can tell a
    truncated page from a complete one and the dashboard can stop computing a
    percentage against the 200-row cap. Callers that send nothing still get the
    same first 200 rows they always did.
    """
    conditions = []
    if assessment_id is not None:
        conditions.append(Finding.assessment_id == assessment_id)
    if status is not None:
        conditions.append(Finding.status == status)
    if severity is not None:
        conditions.append(Finding.severity == severity)
    if category is not None:
        conditions.append(Finding.category == category)

    total = db.scalar(select(func.count(Finding.id)).where(*conditions)) or 0
    query = (
        select(Finding)
        .where(*conditions)
        .order_by(Finding.id.desc())
        .offset(offset)
        .limit(limit)
    )
    response.headers["X-Total-Count"] = str(total)
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
    # Explicit JSON nulls mean "not provided" - the columns are NOT NULL and a
    # null would crash the commit with a 500. Clearing notes is done with "".
    changes = {field: value for field, value in changes.items() if value is not None}
    if not changes:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "PATCH body is empty")

    new_status = changes.get("status")
    status_changing = new_status is not None and new_status != finding.status
    if status_changing and new_status not in ALLOWED_TRANSITIONS[finding.status]:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Illegal transition: {finding.status.value} -> {new_status.value}",
        )

    values = {field: changes[field] for field in ("severity", "score", "assessor_notes") if field in changes}
    if status_changing:
        values["status"] = new_status
        if new_status == FindingStatus.verified:
            # attribution is taken from the JWT identity, never from the body
            values["verified_by_id"] = user.id
            values["verified_at"] = utcnow()
        else:
            # reopening drops the stale attribution; re-verifying re-stamps it
            values["verified_by_id"] = None
            values["verified_at"] = None

    if not status_changing:
        # Notes/severity/score only: last write wins, and there is no state
        # machine to protect. The ORM updates just the dirty columns.
        for field, value in values.items():
            setattr(finding, field, value)
        db.commit()
        db.refresh(finding)
        return finding

    # F-35: two assessors who both loaded `ai_candidate` can each pass the
    # transition check above, and the second commit used to overwrite the first
    # decision silently. Compare-and-swap on the status we validated: if another
    # writer moved the row in the meantime, no row matches and the caller gets a
    # 409 instead of a lost verification. No version column, no contract change.
    old_status = finding.status
    result = db.execute(
        update(Finding)
        .where(Finding.id == finding.id, Finding.status == old_status)
        .values(**values)
        .execution_options(synchronize_session=False)
    )
    if result.rowcount == 0:
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "This finding changed while you were reviewing it. Reload and apply your decision again.",
        )
    db.commit()
    db.refresh(finding)
    return finding
