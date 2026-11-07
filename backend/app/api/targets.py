"""Target & scope management (brief feature 01).

The allowed_intensity gate is the enforcement point: the orchestrator (M1)
checks this field before ever launching intrusive tools against a target.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, require_role
from app.database import get_db
from app.models import Role, Target, User
from app.schemas.common import TargetCreate, TargetOut

router = APIRouter(prefix="/targets", tags=["targets"])


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


@router.put("/{target_id}", response_model=TargetOut)
def update_target(
    target_id: int,
    payload: TargetCreate,
    _: User = Depends(require_role(Role.admin, Role.assessor)),
    db: Session = Depends(get_db),
) -> Target:
    target = db.get(Target, target_id)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Target not found")
    for key, value in payload.model_dump().items():
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
