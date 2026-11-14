"""Target & scope management (brief feature 01).

The allowed_intensity gate is the enforcement point: the orchestrator (M1)
checks this field before ever launching intrusive tools against a target.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, require_role
from app.database import get_db
from app.models import Role, ScanIntensity, Target, User
from app.schemas.common import TargetCreate, TargetOut, TargetPatch

router = APIRouter(prefix="/targets", tags=["targets"])


def _guard_intensity(value: ScanIntensity | None, user: User) -> None:
    """Escalating a target to full_intrusive is an admin decision (proposal 05).

    Without this, an assessor could grant themselves active scanning: the
    intensity gate in assessments.py only compares a request against the
    target's own stored value, so it cannot reject a value the same role just
    wrote.
    """
    if value == ScanIntensity.full_intrusive and user.role != Role.admin:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Only an admin can allow full_intrusive scanning on a target. "
            "Ask an admin to raise the target's allowed intensity.",
        )


@router.get("", response_model=list[TargetOut])
def list_targets(
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[Target]:
    return list(db.scalars(select(Target).order_by(Target.id)))


@router.post("", response_model=TargetOut, status_code=status.HTTP_201_CREATED)
def create_target(
    payload: TargetCreate,
    user: User = Depends(require_role(Role.admin, Role.assessor)),
    db: Session = Depends(get_db),
) -> Target:
    _guard_intensity(payload.allowed_intensity, user)
    target = Target(**payload.model_dump(), created_by_id=user.id)
    db.add(target)
    db.commit()
    db.refresh(target)
    return target


@router.get("/{target_id}", response_model=TargetOut)
def get_target(
    target_id: int,
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Target:
    target = db.get(Target, target_id)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Target not found")
    return target


@router.patch("/{target_id}", response_model=TargetOut)
def update_target(
    target_id: int,
    payload: TargetPatch,
    user: User = Depends(require_role(Role.admin, Role.assessor)),
    db: Session = Depends(get_db),
) -> Target:
    """Partial update (proposal 05).

    Was `PUT` with a full `TargetCreate`: any caller sending a partial body
    silently reset `authorization_ref`, `allowed_intensity` and both scope lists
    to their defaults. Now only the fields actually present are applied, and an
    intensity escalation is admin-only.
    """
    target = db.get(Target, target_id)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Target not found")

    changes = payload.model_dump(exclude_unset=True, exclude_none=True)
    _guard_intensity(changes.get("allowed_intensity"), user)
    for key, value in changes.items():
        setattr(target, key, value)
    db.commit()
    db.refresh(target)
    return target


@router.delete("/{target_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_target(
    target_id: int,
    _: User = Depends(require_role(Role.admin)),
    db: Session = Depends(get_db),
) -> None:
    target = db.get(Target, target_id)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Target not found")
    db.delete(target)
    db.commit()
