"""Assessment endpoints (M1 T1.0/T1.6/T1.7).

The intensity gate (T1.7) lives here and in the orchestrator: a request whose
intensity exceeds the target's allowed level is rejected with 409 before any
job exists, and the orchestrator re-checks when scheduling intrusive tools.
"""

from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.core.deps import get_current_user, require_role
from app.database import get_db
from app.models import Assessment, AssessmentStatus, Job, JobStatus, Role, ScanIntensity, Target, User
from app.models.user import utcnow
from app.schemas.assessment import AssessmentCreate, AssessmentDetail, AssessmentOut, JobOut, ScanEvent
from app.scanner.orchestrator import pipelines, request_cancel, start_pipeline

router = APIRouter(prefix="/assessments", tags=["assessments"])

_INTENSITY_ORDER = {ScanIntensity.passive_safe: 0, ScanIntensity.full_intrusive: 1}


def _detail(db: Session, assessment: Assessment) -> AssessmentDetail:
    return AssessmentDetail(
        **AssessmentOut.model_validate(assessment).model_dump(),
        jobs=[JobOut.model_validate(j) for j in assessment.jobs],
    )


@router.post("", response_model=AssessmentDetail, status_code=status.HTTP_201_CREATED)
async def create_assessment(
    payload: AssessmentCreate,
    user: User = Depends(require_role(Role.admin, Role.assessor)),
    db: Session = Depends(get_db),
) -> AssessmentDetail:
    target = db.get(Target, payload.target_id)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Target not found")

    requested = payload.intensity or target.allowed_intensity
    if _INTENSITY_ORDER[requested] > _INTENSITY_ORDER[target.allowed_intensity]:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Intensity gate: target '{target.name}' allows '{target.allowed_intensity.value}' but "
            f"'{requested.value}' was requested. Raise the target's allowed intensity first.",
        )
    categories = payload.categories or []
    if not categories:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Select at least one assessment category.")

    assessment = Assessment(
        target_id=target.id,
        intensity=requested,
        categories=categories,
        started_by_id=user.id,
        status=AssessmentStatus.running,
        started_at=utcnow(),
    )
    db.add(assessment)
    db.flush()
    # Create the Job rows synchronously so the 201 payload already shows the
    # full run plan (the pipeline picks up existing pending jobs).
    from app.scanner.orchestrator import plan_tools

    for tool in plan_tools(requested):
        db.add(Job(assessment_id=assessment.id, tool=tool, status=JobStatus.pending))
    db.commit()
    db.refresh(assessment)

    # Pipeline launches on the event loop after the commit; the task opens its
    # own DB session (orchestrator.run_pipeline).
    start_pipeline(assessment.id)
    db.refresh(assessment)
    return _detail(db, assessment)


@router.get("", response_model=list[AssessmentOut])
def list_assessments(
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[Assessment]:
    return list(db.scalars(select(Assessment).order_by(Assessment.id.desc())))


@router.get("/{assessment_id}", response_model=AssessmentDetail)
def get_assessment(
    assessment_id: int,
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AssessmentDetail:
    assessment = db.get(Assessment, assessment_id, options=(joinedload(Assessment.jobs),))
    if assessment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Assessment not found")
    return _detail(db, assessment)


@router.get("/{assessment_id}/events")
async def assessment_events(
    assessment_id: int,
    request: Request,
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    assessment = db.get(Assessment, assessment_id, options=(joinedload(Assessment.jobs),))
    if assessment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Assessment not found")

    handle = pipelines.get(assessment_id)
    queue: asyncio.Queue = asyncio.Queue()
    if handle is not None:
        handle.subscribers.add(queue)

    async def generator():
        # Snapshot first so a fresh subscriber immediately sees state...
        snapshot = ScanEvent(type="snapshot", assessment=_detail(db, assessment))
        yield f"data: {json.dumps(snapshot.model_dump(mode='json'))}\n\n"
        # ...then live events while the pipeline runs.
        if handle is None:
            yield f"data: {json.dumps(ScanEvent(type='assessment', status=assessment.status.value).model_dump(mode='json'))}\n\n"
            return
        try:
            while True:
                if await request.is_disconnected():
                    return
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=15.0)
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"  # comment line = SSE heartbeat
                    continue
                yield f"data: {json.dumps(event)}\n\n"
                if event.get("type") == "assessment":
                    return
        finally:
            handle.subscribers.discard(queue)

    return StreamingResponse(generator(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


@router.post("/{assessment_id}/cancel", status_code=status.HTTP_202_ACCEPTED)
def cancel_assessment(
    assessment_id: int,
    _: User = Depends(require_role(Role.admin, Role.assessor)),
    db: Session = Depends(get_db),
) -> dict:
    assessment = db.get(Assessment, assessment_id)
    if assessment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Assessment not found")
    if assessment.status not in (AssessmentStatus.running, AssessmentStatus.draft):
        raise HTTPException(status.HTTP_409_CONFLICT, f"Assessment is {assessment.status.value}; cannot cancel.")
    signalled = request_cancel(assessment_id, db)
    return {"status": "cancelling" if signalled else "cancelled"}
