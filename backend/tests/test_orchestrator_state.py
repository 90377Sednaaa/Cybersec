"""Orchestrator terminal-state regressions (Wave 3: F-03, F-04, F-05) and the
Wave 4 event/durability fixes (F-09, F-39).

These assert what the run *ends up as* after cancellation and after an orphaned
target, not how the tools behave. Runners and the normalizer are stubbed so the
tests stay fast and offline; the state machine is the real one.
"""

import asyncio
import json

import app.scanner.orchestrator as orch
from app.api import assessments as assessments_api
from app.database import SessionLocal
from app.models import Assessment, AssessmentStatus, Job, JobStatus, ScanIntensity, Target
from app.scanner.base import RunnerError


def _seed_assessment(target_id: int | None = None) -> tuple[int, int]:
    """Create (target, assessment). Passing target_id lets a test point at a
    row that does not exist - SQLite does not enforce the FK, so that is exactly
    the orphan state a target deletion produces."""
    with SessionLocal() as db:
        if target_id is None:
            target = Target(
                name="state-target",
                base_url="http://127.0.0.1:9",
                allowed_intensity=ScanIntensity.passive_safe,
            )
            db.add(target)
            db.flush()
            target_id = target.id
        assessment = Assessment(target_id=target_id, intensity=ScanIntensity.passive_safe, categories=[])
        db.add(assessment)
        db.commit()
        return assessment.id, target_id


def _drain(queue: asyncio.Queue) -> list[dict]:
    events = []
    while not queue.empty():
        events.append(queue.get_nowait())
    return events


def _cleanup(assessment_id: int, target_id: int | None) -> None:
    with SessionLocal() as db:
        assessment = db.get(Assessment, assessment_id)
        if assessment is not None:
            for job in assessment.jobs:
                db.delete(job)
            db.delete(assessment)
        if target_id is not None:
            target = db.get(Target, target_id)
            if target is not None:
                db.delete(target)
        db.commit()


def test_cancelled_runner_is_recorded_cancelled_not_failed(monkeypatch):
    """F-05: runners signal cancellation by raising RunnerError("Cancelled").
    That used to be recorded as a tool failure."""
    assessment_id, target_id = _seed_assessment()

    class CancellingRunner:
        async def run(self, _ctx):
            raise RunnerError("Cancelled")

    monkeypatch.setattr(orch, "get_runner", lambda _tool: CancellingRunner)

    with SessionLocal() as db:
        assessment = db.get(Assessment, assessment_id)
        target = db.get(Target, target_id)
        job = Job(assessment_id=assessment_id, tool="prober", status=JobStatus.pending)
        db.add(job)
        db.commit()

        handle = orch.PipelineHandle(assessment_id)
        handle.cancel_event.set()
        asyncio.run(orch._run_job(db, handle, assessment, target, job))  # noqa: SLF001

        assert job.status == JobStatus.cancelled
        assert "[cancelled]" in job.log
        assert "failed" not in job.log.lower()

    _cleanup(assessment_id, target_id)


def test_orphaned_target_fails_the_run_and_emits_a_terminal_event():
    """F-04: assessment.target is None (deleted target) used to return silently,
    leaving the run `running` with pending jobs forever and no terminal SSE
    event, so a subscriber looped on keep-alives."""
    assessment_id, _ = _seed_assessment(target_id=999_999)

    handle = orch.PipelineHandle(assessment_id)
    queue: asyncio.Queue = asyncio.Queue()
    handle.subscribers.add(queue)

    asyncio.run(orch.run_pipeline(assessment_id, handle))

    with SessionLocal() as db:
        assessment = db.get(Assessment, assessment_id)
        assert assessment.status == AssessmentStatus.failed
        assert assessment.finished_at is not None
        assert "Target no longer exists" in assessment.notes
        for job in assessment.jobs:
            db.delete(job)
        db.delete(assessment)
        db.commit()

    terminal = [e for e in _drain(queue) if e.get("type") == "assessment"]
    assert terminal, "no terminal event was broadcast"
    assert terminal[-1]["status"] == "failed"


def test_missing_assessment_still_broadcasts_terminal_event():
    """The row itself is gone: nothing to write, but a subscriber must not hang."""
    handle = orch.PipelineHandle(999_998)
    queue: asyncio.Queue = asyncio.Queue()
    handle.subscribers.add(queue)

    asyncio.run(orch.run_pipeline(999_998, handle))

    terminal = [e for e in _drain(queue) if e.get("type") == "assessment"]
    assert terminal and terminal[-1]["status"] == "failed"


def test_cancel_during_interpretation_marks_run_cancelled(monkeypatch):
    """F-03: a cancel arriving while the interpreter waits on the provider used
    to be overwritten with `completed`."""
    assessment_id, target_id = _seed_assessment()

    async def fake_run_job(db, _handle, _assessment, _target, job, _effective=None):
        job.status = JobStatus.completed
        db.commit()

    async def fake_interpret(_db, handle, _assessment, _jobs, _target):
        # The operator hits Cancel while the LLM call is in flight.
        handle.cancel_event.set()

    monkeypatch.setattr(orch, "_run_job", fake_run_job)
    monkeypatch.setattr(orch, "_run_interpret", fake_interpret)
    monkeypatch.setattr(orch, "normalize_assessment", lambda _db, _a, _jobs: 0)

    handle = orch.PipelineHandle(assessment_id)
    asyncio.run(orch.run_pipeline(assessment_id, handle))

    with SessionLocal() as db:
        assessment = db.get(Assessment, assessment_id)
        assert assessment.status == AssessmentStatus.cancelled
        assert assessment.status != AssessmentStatus.completed
        assert assessment.finished_at is not None

    _cleanup(assessment_id, target_id)


def test_no_cancel_still_completes(monkeypatch):
    """Guard against the F-03 fix over-firing: a run nobody cancelled completes."""
    assessment_id, target_id = _seed_assessment()

    async def fake_run_job(db, _handle, _assessment, _target, job, _effective=None):
        job.status = JobStatus.completed
        db.commit()

    async def fake_interpret(_db, _handle, _assessment, _jobs, _target):
        return None

    monkeypatch.setattr(orch, "_run_job", fake_run_job)
    monkeypatch.setattr(orch, "_run_interpret", fake_interpret)
    monkeypatch.setattr(orch, "normalize_assessment", lambda _db, _a, _jobs: 0)

    handle = orch.PipelineHandle(assessment_id)
    asyncio.run(orch.run_pipeline(assessment_id, handle))

    with SessionLocal() as db:
        assert db.get(Assessment, assessment_id).status == AssessmentStatus.completed

    _cleanup(assessment_id, target_id)


# --- F-09: bounded subscriber queues ---------------------------------------------


def test_broadcast_sheds_the_oldest_event_when_a_subscriber_stalls():
    """A client that stops reading must not grow the process's memory without
    bound: the oldest queued event is dropped to make room."""
    handle = orch.PipelineHandle(1)
    queue: asyncio.Queue = asyncio.Queue(maxsize=orch.EVENT_QUEUE_SIZE)
    handle.subscribers.add(queue)

    for i in range(orch.EVENT_QUEUE_SIZE + 10):
        orch.broadcast(handle, {"type": "log", "job_id": None, "line": f"line {i}"})

    assert queue.qsize() == orch.EVENT_QUEUE_SIZE
    assert queue.get_nowait()["line"] == "line 10"  # the first ten were shed


def test_broadcast_keeps_the_terminal_event_on_a_full_queue():
    """The terminal `assessment` event closes every subscriber loop, so a full
    queue must never be the reason a client hangs."""
    handle = orch.PipelineHandle(1)
    queue: asyncio.Queue = asyncio.Queue(maxsize=2)
    handle.subscribers.add(queue)

    orch.broadcast(handle, {"type": "log", "job_id": None, "line": "a"})
    orch.broadcast(handle, {"type": "log", "job_id": None, "line": "b"})
    orch.broadcast(handle, {"type": "assessment", "status": "completed"})

    events = _drain(queue)
    assert len(events) == 2
    assert events[-1] == {"type": "assessment", "status": "completed"}


# --- F-39: the SSE endpoint must not hold its session while streaming ------------


class _RecordingSession:
    """Delegates to the real session but records the close call."""

    def __init__(self, session) -> None:
        self._session = session
        self.closed = False

    def get(self, *args, **kwargs):
        return self._session.get(*args, **kwargs)

    def close(self) -> None:
        self.closed = True
        self._session.close()


def test_sse_snapshot_releases_the_db_session_before_streaming():
    """The old generator read from `db` inside the response body, holding a
    read transaction for the whole stream and blocking the writers (F-39)."""
    assessment_id, target_id = _seed_assessment()
    try:
        with SessionLocal() as session:
            db = _RecordingSession(session)
            response = asyncio.run(
                assessments_api.assessment_events(
                    assessment_id, request=None, _=None, db=db  # noqa: SLF001
                )
            )
            assert db.closed, "the SSE endpoint released its session only after streaming"

            async def collect() -> list[str]:
                return [chunk async for chunk in response.body_iterator]

            chunks = asyncio.run(collect())
    finally:
        _cleanup(assessment_id, target_id)

    # No live pipeline: snapshot first, then the terminal event, then close.
    assert len(chunks) == 2
    snapshot = json.loads(chunks[0].removeprefix("data: ").strip())
    assert snapshot["type"] == "snapshot"
    assert snapshot["assessment"]["id"] == assessment_id
    terminal = json.loads(chunks[1].removeprefix("data: ").strip())
    assert terminal["type"] == "assessment"
    assert terminal["status"] == "draft"


# --- F-09: batched log/progress commits ------------------------------------------


class _CountingDb:
    def __init__(self) -> None:
        self.commits = 0

    def commit(self) -> None:
        self.commits += 1


def test_commit_batcher_groups_log_writes(monkeypatch):
    """One commit per log line made a chatty tool cost hundreds of write
    transactions per scan. Lines are applied immediately; durability is batched."""
    monkeypatch.setattr(orch, "LOG_FLUSH_SECONDS", 10_000.0)  # time never triggers
    db = _CountingDb()
    batcher = orch._CommitBatcher(db)  # noqa: SLF001

    for _ in range(orch.LOG_FLUSH_LINES - 1):
        batcher.record()
    assert db.commits == 0

    batcher.record()  # the Nth line flushes
    assert db.commits == 1

    batcher.flush()  # nothing pending: no empty transaction
    assert db.commits == 1


def test_commit_batcher_flushes_on_the_time_budget(monkeypatch):
    """The line cap alone would leave a quiet tool's progress uncommitted for
    minutes; the time budget bounds that."""
    clock = [1_000.0]
    monkeypatch.setattr(orch.time, "monotonic", lambda: clock[0])
    db = _CountingDb()
    batcher = orch._CommitBatcher(db)  # noqa: SLF001

    batcher.record()
    assert db.commits == 0

    clock[0] += orch.LOG_FLUSH_SECONDS + 0.5
    batcher.record()
    assert db.commits == 1
