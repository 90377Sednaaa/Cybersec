"""Assessment orchestrator (M1 T1.6).

Runs the tool pipeline for one assessment as a background asyncio task:
    dns -> nmap -> prober (-> zap at full intensity) -> normalize

Owns the in-process event bus: SSE subscribers attach a queue to the pipeline
handle; runners emit through ScanContext callbacks, never touching the bus.

Single-process by design (documented in PLAN.md): jobs are persisted to the DB
so the UI survives refreshes, but a server restart kills running tasks - the
assessment stays `running` in the DB and can be re-launched. Trade-off noted
in the member log.
"""

from __future__ import annotations

import asyncio
import json

from app.database import SessionLocal
from app.models import Assessment, AssessmentStatus, Job, JobStatus, ScanIntensity
from app.models.user import utcnow
from app.scanner.base import RunnerError, ScanContext, format_exception
from app.scanner.normalize import normalize_assessment
from app.scanner.registry import get_runner

# tool execution order; zap appended only at full intensity
BASE_TOOLS = ["dns", "nmap", "prober"]
INTRUSIVE_TOOLS = ["zap"]


def plan_tools(intensity: ScanIntensity) -> list[str]:
    """The tool sequence for an intensity. Shared by the API (which creates the
    Job rows synchronously so the 201 response is deterministic) and the
    orchestrator (which creates them for pipelines started without API jobs)."""
    return list(BASE_TOOLS) + (INTRUSIVE_TOOLS if intensity == ScanIntensity.full_intrusive else [])


class PipelineHandle:
    def __init__(self, assessment_id: int) -> None:
        self.assessment_id = assessment_id
        self.task: asyncio.Task | None = None
        self.cancel_event = asyncio.Event()
        self.subscribers: set[asyncio.Queue] = set()


pipelines: dict[int, PipelineHandle] = {}


def broadcast(handle: PipelineHandle, event: dict) -> None:
    for queue in list(handle.subscribers):
        queue.put_nowait(event)


def start_pipeline(assessment_id: int) -> PipelineHandle:
    if assessment_id in pipelines:
        raise RuntimeError(f"Assessment {assessment_id} already has a running pipeline")
    handle = PipelineHandle(assessment_id)
    handle.task = asyncio.create_task(run_pipeline(assessment_id, handle))
    pipelines[assessment_id] = handle
    return handle


async def run_pipeline(assessment_id: int, handle: PipelineHandle) -> None:
    db = SessionLocal()
    try:
        assessment = db.get(Assessment, assessment_id)
        if assessment is None or assessment.target is None:
            return
        target = assessment.target

        assessment.status = AssessmentStatus.running
        assessment.started_at = utcnow()
        db.commit()

        # The API creates job rows synchronously (deterministic 201 payload);
        # only plan them here for pipelines started without API-created jobs.
        jobs: list[Job] = list(assessment.jobs)
        if not jobs:
            for tool in plan_tools(assessment.intensity):
                jobs.append(Job(assessment_id=assessment.id, tool=tool, status=JobStatus.pending))
                db.add(jobs[-1])
            db.commit()

        for job in jobs:
            if handle.cancel_event.is_set():
                break
            await _run_job(db, handle, assessment, target, job)

        if handle.cancel_event.is_set():
            for job in jobs:
                if job.status in (JobStatus.pending, JobStatus.running):
                    job.status = JobStatus.cancelled
                    job.finished_at = utcnow()
            assessment.status = AssessmentStatus.cancelled
        else:
            created = normalize_assessment(db, assessment, jobs)
            assessment.notes = f"Pipeline complete; {created} candidate finding(s) emitted by rule-based normalizer."
            assessment.status = AssessmentStatus.completed
        assessment.finished_at = utcnow()
        db.commit()
        broadcast(handle, {"type": "assessment", "status": assessment.status.value})
    except Exception as exc:  # noqa: BLE001 - pipeline must never die silently
        assessment = db.get(Assessment, assessment_id)
        if assessment is not None:
            assessment.status = AssessmentStatus.failed
            assessment.notes = f"Orchestrator error: {exc}"
            assessment.finished_at = utcnow()
            db.commit()
        broadcast(handle, {"type": "assessment", "status": AssessmentStatus.failed.value})
    finally:
        pipelines.pop(assessment_id, None)
        db.close()


async def _run_job(db, handle: PipelineHandle, assessment, target, job: Job) -> None:
    job.status = JobStatus.running
    job.started_at = utcnow()
    db.commit()
    broadcast(handle, {"type": "job", "job_id": job.id, "status": job.status.value, "progress": 0.0})

    def emit_log(line: str) -> None:
        job.log += line + "\n"
        db.commit()
        broadcast(handle, {"type": "log", "job_id": job.id, "line": line})

    def emit_progress(value: float) -> None:
        job.progress = value
        db.commit()
        broadcast(handle, {"type": "job", "job_id": job.id, "status": job.status.value, "progress": value})

    ctx = ScanContext(
        db=db,
        target=target,
        assessment=assessment,
        job=job,
        emit_log=emit_log,
        emit_progress=emit_progress,
        cancelled=lambda: handle.cancel_event.is_set(),
    )

    try:
        runner = get_runner(job.tool)()
        ctx.log(f"Starting {job.tool} ({'full' if ctx.is_full else 'passive'} intensity)")
        await runner.run(ctx)
        job.status = JobStatus.completed
        ctx.progress(1.0)
    except RunnerError as exc:
        job.status = JobStatus.failed
        ctx.log(f"[error] {job.tool} failed: {exc}")
    except Exception as exc:  # noqa: BLE001 - one failed tool must not stop the pipeline
        job.status = JobStatus.failed
        ctx.log(f"[error] {job.tool} failed unexpectedly: {format_exception(exc)}")
    finally:
        job.finished_at = utcnow()
        db.commit()
        broadcast(handle, {"type": "job", "job_id": job.id, "status": job.status.value, "progress": job.progress})


def request_cancel(assessment_id: int, db) -> bool:
    """Cancel a running pipeline, or mark a stopped assessment cancelled in the DB.
    Returns True when a live pipeline was signalled."""
    handle = pipelines.get(assessment_id)
    if handle is not None:
        handle.cancel_event.set()
        return True
    assessment = db.get(Assessment, assessment_id)
    if assessment is None:
        return False
    if assessment.status == AssessmentStatus.running:
        for job in assessment.jobs:
            if job.status in (JobStatus.pending, JobStatus.running):
                job.status = JobStatus.cancelled
                job.finished_at = utcnow()
        assessment.status = AssessmentStatus.cancelled
        assessment.finished_at = utcnow()
        db.commit()
    return False
