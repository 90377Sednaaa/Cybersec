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
import time

from app.ai.interpret import interpret_assessment
from app.database import SessionLocal
from app.models import Assessment, AssessmentStatus, Job, JobStatus, ScanIntensity
from app.models.user import utcnow
from app.scanner.base import RunnerError, ScanContext, format_exception
from app.scanner.normalize import normalize_assessment
from app.scanner.registry import get_runner

# tool execution order; zap appended only at full intensity
BASE_TOOLS = ["dns", "nmap", "prober"]
INTRUSIVE_TOOLS = ["zap"]

# Per-subscriber SSE backlog cap. A stalled or forgotten client must not grow
# the process's memory; the oldest event is dropped instead (F-09).
EVENT_QUEUE_SIZE = 500

# Log/progress durability batching: one commit per line turned a chatty tool
# into hundreds of write transactions per scan (F-09).
LOG_FLUSH_LINES = 20
LOG_FLUSH_SECONDS = 2.0


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
        try:
            queue.put_nowait(event)
            continue
        except asyncio.QueueFull:
            pass
        # Bounded queue: make room by discarding the subscriber's oldest event.
        # The terminal `assessment` event is always the last one broadcast, so
        # it can never be the event dropped here - a subscriber still closes.
        try:
            queue.get_nowait()
        except asyncio.QueueEmpty:
            pass
        try:
            queue.put_nowait(event)
        except asyncio.QueueFull:
            pass  # a single consumer is this far behind; the snapshot recovers state


def effective_intensity(assessment: Assessment, target: Target) -> ScanIntensity:
    """The level a run may actually use.

    `assessment.intensity` is frozen when the run is created, but the target's
    allowed level can be lowered afterwards (or the target repointed). Never
    exceed what the target currently allows - this is the re-check the
    assessments.py docstring has always claimed the orchestrator performs.
    """
    if target.allowed_intensity == ScanIntensity.passive_safe:
        return ScanIntensity.passive_safe
    return assessment.intensity


def _mark_cancelled(jobs: list[Job], assessment: Assessment) -> None:
    """Terminal state for a cancelled run: jobs still pending or running become
    `cancelled` (never `failed`) and the assessment is marked cancelled."""
    for job in jobs:
        if job.status in (JobStatus.pending, JobStatus.running):
            job.status = JobStatus.cancelled
            job.finished_at = utcnow()
    assessment.status = AssessmentStatus.cancelled


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
        if assessment is None:
            # The row is gone (deleting a target orphans its assessments because
            # SQLite FKs are unenforced). Nothing to write, but subscribers still
            # need a terminal event or their stream keeps receiving keep-alives.
            broadcast(handle, {"type": "assessment", "status": AssessmentStatus.failed.value})
            return
        if assessment.target is None:
            # Same orphan case one level up. Previously this returned silently,
            # leaving the assessment `running` with pending jobs forever and no
            # terminal SSE event.
            assessment.status = AssessmentStatus.failed
            assessment.notes = "Target no longer exists; the run cannot continue."
            assessment.finished_at = utcnow()
            db.commit()
            broadcast(handle, {"type": "assessment", "status": AssessmentStatus.failed.value})
            return
        target = assessment.target
        effective = effective_intensity(assessment, target)
        downgrade_note = ""
        if effective != assessment.intensity:
            downgrade_note = (
                f" Intensity downgraded to {effective.value}: the target's allowed intensity was "
                f"lowered after this run was created."
            )

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
            if job.tool in INTRUSIVE_TOOLS and effective != ScanIntensity.full_intrusive:
                # The API already created the job row; do not run it.
                job.status = JobStatus.cancelled
                job.finished_at = utcnow()
                job.log += (
                    f"[cancelled] skipped: target allowed intensity is {effective.value}, "
                    "so intrusive tools may not run\n"
                )
                db.commit()
                broadcast(
                    handle,
                    {"type": "job", "job_id": job.id, "status": job.status.value, "progress": job.progress},
                )
                continue
            await _run_job(db, handle, assessment, target, job, effective)

        if handle.cancel_event.is_set():
            _mark_cancelled(jobs, assessment)
        else:
            created = normalize_assessment(db, assessment, jobs)
            # M2 hook (T2.4): run AI interpretation AFTER the note is composed -
            # the interpreter appends its outcome to assessment.notes and must
            # not be able to clobber the pipeline summary.
            assessment.notes = (
                f"Pipeline complete; {created} candidate finding(s) emitted by rule-based normalizer."
                + downgrade_note
            )
            await _run_interpret(db, handle, assessment, jobs, target)
            # The interpreter runs in a thread that can spend minutes waiting on
            # the provider. A cancel arriving during that window used to be
            # overwritten with `completed`; re-check before deciding.
            if handle.cancel_event.is_set():
                _mark_cancelled(jobs, assessment)
            else:
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


async def _run_interpret(db, handle: PipelineHandle, assessment, jobs, target) -> None:
    """M2 hook (T2.4): AI interpretation after normalization. Degrades to a note
    when nothing is configured; provider errors never fail a completed scan."""
    def emit_log(line: str) -> None:
        broadcast(handle, {"type": "log", "job_id": None, "line": line})

    try:
        def run() -> None:
            with SessionLocal() as ai_db:
                created = interpret_assessment(
                    ai_db,
                    assessment,
                    jobs,
                    deny_list=target_deny_list(target),
                    emit_log=emit_log,
                )
                if created:
                    assessment.notes = (assessment.notes or "") + f" AI interpretation added {created} candidate finding(s)."

        await asyncio.to_thread(run)
    except Exception as exc:  # noqa: BLE001 - AI must never break a completed scan
        emit_log(f"[error] AI interpretation unavailable: {format_exception(exc)}")
        assessment.notes = (assessment.notes or "") + f" AI interpretation skipped: {format_exception(exc)}"


def target_deny_list(target) -> list[str]:
    """Target-specific terms redacted from every AI prompt: identifiers the
    target owner gave us (name, host, scope assets, authorization reference)."""
    if target is None:
        return []
    terms = [target.name, target.base_url, target.authorization_ref or ""]
    terms.extend(target.in_scope_assets or [])
    terms.extend(target.out_of_scope_assets or [])
    return [t for t in terms if t and len(t) >= 3]


class _CommitBatcher:
    """Coalesce write-through log/progress commits for one job (F-09).

    Log lines and progress values are applied to the ORM row immediately (so the
    final commit persists everything) and broadcast immediately (so the SSE log
    stays live); only the durability commit is batched. A tool that logs 200
    lines now costs a handful of transactions instead of 200, which matters
    because SQLite write transactions block readers in the old journal mode.
    """

    def __init__(self, db) -> None:
        self._db = db
        self._pending = 0
        self._last_flush = time.monotonic()

    def record(self) -> None:
        self._pending += 1
        if (
            self._pending >= LOG_FLUSH_LINES
            or (time.monotonic() - self._last_flush) >= LOG_FLUSH_SECONDS
        ):
            self.flush()

    def flush(self) -> None:
        if self._pending == 0:
            return
        self._db.commit()
        self._pending = 0
        self._last_flush = time.monotonic()


async def _run_job(
    db,
    handle: PipelineHandle,
    assessment,
    target,
    job: Job,
    effective: ScanIntensity | None = None,
) -> None:
    job.status = JobStatus.running
    job.started_at = utcnow()
    db.commit()
    broadcast(handle, {"type": "job", "job_id": job.id, "status": job.status.value, "progress": 0.0})

    batcher = _CommitBatcher(db)

    def emit_log(line: str) -> None:
        job.log += line + "\n"
        broadcast(handle, {"type": "log", "job_id": job.id, "line": line})
        batcher.record()

    def emit_progress(value: float) -> None:
        job.progress = value
        broadcast(handle, {"type": "job", "job_id": job.id, "status": job.status.value, "progress": value})
        batcher.record()

    ctx = ScanContext(
        db=db,
        target=target,
        assessment=assessment,
        job=job,
        emit_log=emit_log,
        emit_progress=emit_progress,
        cancelled=lambda: handle.cancel_event.is_set(),
        effective_intensity=effective,
    )

    try:
        runner = get_runner(job.tool)()
        ctx.log(f"Starting {job.tool} ({'full' if ctx.is_full else 'passive'} intensity)")
        await runner.run(ctx)
        job.status = JobStatus.completed
        ctx.progress(1.0)
    except RunnerError as exc:
        # Runners raise RunnerError("Cancelled") when the operator cancels. That
        # is not a tool failure, so it must not be recorded as one.
        if handle.cancel_event.is_set():
            job.status = JobStatus.cancelled
            ctx.log(f"[cancelled] {job.tool} stopped on operator request")
        else:
            job.status = JobStatus.failed
            ctx.log(f"[error] {job.tool} failed: {exc}")
    except Exception as exc:  # noqa: BLE001 - one failed tool must not stop the pipeline
        if handle.cancel_event.is_set():
            job.status = JobStatus.cancelled
            ctx.log(f"[cancelled] {job.tool} stopped on operator request")
        else:
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
