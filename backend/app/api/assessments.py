"""Assessment endpoints (M1 T1.0/T1.6/T1.7).

The intensity gate (T1.7) lives here and in the orchestrator: a request whose
intensity exceeds the target's allowed level is rejected with 409 before any
job exists, and the orchestrator re-checks when scheduling intrusive tools.
"""

from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.core.deps import get_current_user, require_role
from app.database import get_db
from app.models import Assessment, AssessmentStatus, Job, JobStatus, Role, ScanIntensity, Target, User
from app.models.user import utcnow
from app.schemas.assessment import (
    AssessmentCreate,
    AssessmentDetail,
    AssessmentOut,
    InterpretResult,
    JobOut,
    PrioritizationOut,
    ScanEvent,
)
from app.scanner.orchestrator import EVENT_QUEUE_SIZE, INTRUSIVE_TOOLS, pipelines, plan_tools, request_cancel, start_pipeline
from app.scanner.registry import registered_tools

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
    # One live run per target: two concurrent pipelines would scan the same host
    # twice, contend for ports, and double-normalize the same results.
    active = db.scalar(
        select(Assessment)
        .where(Assessment.target_id == target.id, Assessment.status == AssessmentStatus.running)
        .limit(1)
    )
    if active is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Target '{target.name}' already has a running assessment (#{active.id}). "
            "Cancel it or wait for it to finish.",
        )

    categories = payload.categories or []
    if not categories:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Select at least one assessment category.")

    # Resolve tool plan: optional explicit subset or default plan for intensity.
    if payload.tools is not None:
        known_tools = set(registered_tools())
        selected_tools: list[str] = []
        for raw_tool in payload.tools:
            name = (raw_tool or "").strip().lower()
            if name not in known_tools:
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_ENTITY,
                    f"Unknown scan tool '{raw_tool}'. Supported tools: {', '.join(sorted(known_tools))}.",
                )
            if name not in selected_tools:
                selected_tools.append(name)
        if not selected_tools:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Select at least one scan tool.")
        if requested != ScanIntensity.full_intrusive and any(t in INTRUSIVE_TOOLS for t in selected_tools):
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "Intensity gate: intrusive tools (zap) require full_intrusive intensity.",
            )
    else:
        selected_tools = plan_tools(requested)

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
    for tool in selected_tools:
        db.add(Job(assessment_id=assessment.id, tool=tool, status=JobStatus.pending))
    db.commit()
    db.refresh(assessment)

    # Pipeline launches on the event loop after the commit; the task opens its
    # own DB session (orchestrator.run_pipeline).
    start_pipeline(assessment.id)
    db.refresh(assessment)
    return _detail(db, assessment)


DEFAULT_CATEGORIES = [
    "Input validation & injection",
    "Security configuration & HTTPS",
    "Exposed files & directories",
    "Information disclosure",
    "Session management",
]


@router.post("/import", response_model=AssessmentDetail, status_code=status.HTTP_201_CREATED)
async def import_scan(
    target_id: int = Form(...),
    tool: str = Form(...),
    file: UploadFile = File(...),
    assessment_id: int | None = Form(None),
    user: User = Depends(require_role(Role.admin, Role.assessor)),
    db: Session = Depends(get_db),
) -> AssessmentDetail:
    from app.ai.interpret import interpret_assessment
    from app.scanner.importer import parse_imported_scan
    from app.scanner.normalize import normalize_job
    from app.scanner.orchestrator import target_deny_list

    tool_lower = (tool or "").strip().lower()
    if tool_lower not in ("nmap", "zap"):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"Unsupported tool '{tool}'. Aletheia supports 'nmap' and 'zap' scan imports.",
        )

    target = db.get(Target, target_id)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Target not found")

    content_bytes = await file.read()
    if not content_bytes:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Uploaded scan file is empty.")

    try:
        content_str = content_bytes.decode("utf-8")
    except UnicodeDecodeError:
        try:
            content_str = content_bytes.decode("latin-1")
        except Exception as exc:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY, "Could not decode scan file as UTF-8 or Latin-1 text."
            ) from exc

    try:
        parsed_data = parse_imported_scan(tool_lower, content_str)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc

    if assessment_id is not None:
        assessment = db.get(Assessment, assessment_id, options=(joinedload(Assessment.jobs),))
        if assessment is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Assessment not found")
        if assessment.target_id != target.id:
            raise HTTPException(status.HTTP_409_CONFLICT, "Target ID does not match the assessment's target.")
    else:
        assessment = Assessment(
            target_id=target.id,
            intensity=target.allowed_intensity,
            categories=DEFAULT_CATEGORIES,
            started_by_id=user.id,
            status=AssessmentStatus.completed,
            started_at=utcnow(),
            finished_at=utcnow(),
            notes=f"Imported manual {tool_lower.upper()} scan from '{file.filename}'.",
        )
        db.add(assessment)
        db.flush()

    job = Job(
        assessment_id=assessment.id,
        tool=tool_lower,
        status=JobStatus.completed,
        raw_output=json.dumps(parsed_data),
        log=f"Imported manual {tool_lower.upper()} scan from '{file.filename}'.\n",
        progress=1.0,
        started_at=utcnow(),
        finished_at=utcnow(),
    )
    db.add(job)
    db.flush()

    # Deterministic normalization (M1)
    created_norm = normalize_job(db, assessment, job)
    job_id = job.id
    assessment_id_val = assessment.id
    deny_list = target_deny_list(target)
    existing_notes = (assessment.notes or "").strip() if assessment_id is not None else ""

    # AI interpretation (M2) - run off the asyncio event loop so a slow LLM
    # response never stalls concurrent requests or SSE streams.
    created_ai = 0
    try:
        from app.database import SessionLocal

        def _run_import_ai() -> int:
            with SessionLocal() as ai_db:
                ai_assessment = ai_db.get(Assessment, assessment_id_val)
                ai_job = ai_db.get(Job, job_id)
                if ai_assessment is None or ai_job is None:
                    return 0
                return interpret_assessment(ai_db, ai_assessment, [ai_job], deny_list=deny_list)

        created_ai = await asyncio.to_thread(_run_import_ai)
    except Exception:
        pass  # Provider errors never break scan imports

    db.expire_all()
    assessment = db.get(Assessment, assessment_id_val, options=(joinedload(Assessment.jobs),))
    assert assessment is not None
    notes_parts = [f"Imported manual {tool_lower.upper()} scan from '{file.filename}'."]
    if created_norm:
        notes_parts.append(f"{created_norm} candidate finding(s) emitted by rule-based normalizer.")
    if created_ai:
        notes_parts.append(f"{created_ai} candidate finding(s) added by AI interpretation.")
    import_note = " ".join(notes_parts)
    assessment.notes = f"{existing_notes} {import_note}".strip() if existing_notes else import_note

    db.commit()
    db.refresh(assessment)
    return _detail(db, assessment)


@router.post("/{assessment_id}/interpret", response_model=InterpretResult)
async def rerun_interpretation(
    assessment_id: int,
    _: User = Depends(require_role(Role.admin, Role.assessor)),
    db: Session = Depends(get_db),
) -> InterpretResult:
    """Re-run AI interpretation over completed jobs of a finished assessment.

    Useful when an assessor configures or switches an AI model in Settings after
    scans already completed or were imported, without re-running the scan tools.
    """
    from app.ai import client as ai_client
    from app.ai.interpret import interpret_assessment
    from app.database import SessionLocal
    from app.models import LLMTask
    from app.scanner.orchestrator import target_deny_list

    assessment = db.get(Assessment, assessment_id, options=(joinedload(Assessment.jobs),))
    if assessment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Assessment not found")
    if assessment.status == AssessmentStatus.running:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Assessment is still running. Wait for it to finish before re-running AI interpretation.",
        )
    completed_jobs = [j for j in assessment.jobs if j.status == JobStatus.completed and j.raw_output]
    if not completed_jobs:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "No completed job outputs are available to interpret for this assessment.",
        )

    try:
        ai_client.resolve_task_config(db, LLMTask.interpretation)
    except ai_client.NoProviderConfigured as exc:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "No AI provider or model is configured for scan interpretation. Configure one in AI Settings.",
        ) from exc

    deny_list = target_deny_list(assessment.target)

    def _run_ai() -> tuple[int, str]:
        with SessionLocal() as ai_db:
            ai_assessment = ai_db.get(Assessment, assessment_id, options=(joinedload(Assessment.jobs),))
            if ai_assessment is None:
                return 0, ""
            created = interpret_assessment(
                ai_db,
                ai_assessment,
                list(ai_assessment.jobs),
                deny_list=deny_list,
            )
            note = f"AI re-interpretation added {created} candidate finding(s)."
            ai_assessment.notes = f"{(ai_assessment.notes or '').strip()} {note}".strip()
            ai_db.commit()
            return created, ai_assessment.notes

    created, notes = await asyncio.to_thread(_run_ai)
    return InterpretResult(assessment_id=assessment_id, created=created, notes=notes)


@router.get("/{assessment_id}/prioritization", response_model=PrioritizationOut)
def get_prioritization(
    assessment_id: int,
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PrioritizationOut:
    """Return the latest stored AI risk prioritization for an assessment (read-only)."""
    from app.ai.prioritize import latest_prioritization

    if db.get(Assessment, assessment_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Assessment not found")
    cached = latest_prioritization(db, assessment_id)
    if cached is None:
        return PrioritizationOut(assessment_id=assessment_id, rankings=[])
    return PrioritizationOut(**cached)


@router.post("/{assessment_id}/prioritize", response_model=PrioritizationOut)
async def run_prioritization(
    assessment_id: int,
    _: User = Depends(require_role(Role.admin, Role.assessor)),
    db: Session = Depends(get_db),
) -> PrioritizationOut:
    """Rank active findings by exploitability & chaining risk using the `prioritization` model."""
    from app.ai import client as ai_client
    from app.ai.prioritize import prioritize_assessment
    from app.database import SessionLocal
    from app.models import Finding, FindingStatus, LLMTask
    from app.scanner.orchestrator import target_deny_list

    assessment = db.get(Assessment, assessment_id)
    if assessment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Assessment not found")

    active_count = len(
        list(
            db.scalars(
                select(Finding.id).where(
                    Finding.assessment_id == assessment_id,
                    Finding.status != FindingStatus.false_positive,
                )
            )
        )
    )
    if active_count == 0:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "No active findings are available to prioritize for this assessment.",
        )

    try:
        ai_client.resolve_task_config(db, LLMTask.prioritization)
    except ai_client.NoProviderConfigured as exc:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "No AI provider or model is configured for Risk prioritization. Configure one in AI Settings.",
        ) from exc

    deny_list = target_deny_list(assessment.target)

    def _run_prio() -> dict:
        with SessionLocal() as prio_db:
            prio_assessment = prio_db.get(Assessment, assessment_id)
            assert prio_assessment is not None
            findings = list(
                prio_db.scalars(
                    select(Finding)
                    .where(Finding.assessment_id == assessment_id)
                    .order_by(Finding.id)
                )
            )
            return prioritize_assessment(prio_db, prio_assessment, findings, deny_list=deny_list)

    try:
        result = await asyncio.to_thread(_run_prio)
    except ai_client.LLMRequestError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"AI provider error: {exc}") from exc
    return PrioritizationOut(**result)


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

    # Everything the stream needs is materialised before streaming starts. The
    # old generator read the session inside the response body and held it (with
    # its read transaction) for the whole stream - minutes, for a long scan -
    # while the workers needed to commit the rows SSE was about to report
    # (F-39). The session is released here; get_db's finalizer closes it again
    # later, which is a no-op.
    snapshot = ScanEvent(type="snapshot", assessment=_detail(db, assessment))
    snapshot_line = f"data: {json.dumps(snapshot.model_dump(mode='json'))}\n\n"
    terminal_line = f"data: {json.dumps(ScanEvent(type='assessment', status=assessment.status.value).model_dump(mode='json'))}\n\n"
    db.close()

    handle = pipelines.get(assessment_id)
    queue: asyncio.Queue | None = None
    if handle is not None:
        queue = asyncio.Queue(maxsize=EVENT_QUEUE_SIZE)
        handle.subscribers.add(queue)

    async def generator():
        # Snapshot first so a fresh subscriber immediately sees state...
        yield snapshot_line
        # ...then live events while the pipeline runs.
        if queue is None:
            yield terminal_line
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
