"""Runner interface and tool registry (M1 T1.1).

Every security-tool wrapper implements `BaseRunner`. Runners receive a
`ScanContext` and use it to log lines, report progress, check for cancellation,
and store their structured output on the job row (`job.raw_output`).

Design rules (why it looks like this):
- Runners are async: tool IO is subprocess/HTTP, which asyncio multiplexes cheaply.
- The DB session is the sync SQLAlchemy session. SQLite writes are fast enough
  that write-through logging is fine at demo scale; if we outgrow it, flush
  batching is a local change inside this module.
- A runner that cannot do its job (tool missing, daemon down) raises
  `RunnerError` with a *helpful* message - the orchestrator marks the job
  failed and continues the pipeline, so one missing binary never kills an
  assessment.
"""

from __future__ import annotations

import traceback
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Callable

from sqlalchemy.orm import Session

from app.models import Assessment, Job, ScanIntensity, Target
from app.models.user import utcnow


class RunnerError(RuntimeError):
    """Raised when a runner cannot do its job. Message should be actionable."""


@dataclass
class ScanContext:
    """Everything a runner needs, plus the callbacks it must use instead of
    touching the event bus itself."""

    db: Session
    target: Target
    assessment: Assessment
    job: Job
    emit_log: Callable[[str], None] = field(repr=False)
    emit_progress: Callable[[float], None] = field(repr=False)
    cancelled: Callable[[], bool] = field(repr=False)
    # The level the run may actually use. Defaults to the assessment's frozen
    # intensity for callers that do not compute it.
    effective_intensity: ScanIntensity | None = None

    def log(self, line: str) -> None:
        self.emit_log(line)

    def progress(self, value: float) -> None:
        self.emit_progress(max(0.0, min(1.0, value)))

    @property
    def intensity(self):
        return self.effective_intensity or self.assessment.intensity

    @property
    def is_full(self) -> bool:
        """True when this run may use intrusive tooling.

        Reads the *effective* intensity, not `assessment.intensity`: a target's
        allowed level can be lowered after the run was created, and the frozen
        assessment value would then authorise tools the target no longer allows.
        """
        return self.intensity == ScanIntensity.full_intrusive


class BaseRunner(ABC):
    """One security tool. `name` is the registry key stored on Job.tool."""

    name: str = "base"

    @abstractmethod
    async def run(self, ctx: ScanContext) -> None:
        """Execute the tool. Must store structured JSON output in ctx.job.raw_output
        (commit happens via ctx helpers or at the end) and raise RunnerError on
        unusable environments."""

    async def fail(self, ctx: ScanContext, message: str) -> None:
        ctx.job.status = "failed"  # type: ignore[assignment]
        ctx.job.log += f"[error] {message}\n"
        ctx.job.finished_at = utcnow()
        ctx.db.commit()


def format_exception(exc: Exception) -> str:
    """Last 3 lines of a traceback - enough to debug, small enough for a log."""
    lines = traceback.format_exception(type(exc), exc, exc.__traceback__)
    return "".join(lines[-3:])
