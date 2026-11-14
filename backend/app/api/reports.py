"""Reports API (M4 T4.4): trigger generation (202 + background job), poll, download, delete.

Generation never blocks the API: POST creates a `pending` Report row and
returns 202; the PDF is printed by a background task (app/reporting.py) that
flips the row to `ready`/`failed`. Downloads stream application/pdf only
after the row is `ready`; a pending/failed row is a 409 with the reason.
Deleting a report removes the row and its PDF, and is refused while the
background job still owns the row.
"""

from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, require_role
from app.database import get_db
from app.models import Assessment, Report, ReportStatus, Role, User
from app.models.user import utcnow
from app.reporting import REPORTS_DIR, run_report_job
from app.schemas.findings import ReportOut

router = APIRouter(tags=["reports"])

# A report job that died before its final commit (or before it was ever
# scheduled) leaves a `pending` row that can neither be downloaded nor deleted.
# Age it out so the UI stops polling and the row becomes removable.
STALE_PENDING_SECONDS = 15 * 60


def _get_report_or_404(db: Session, report_id: int) -> Report:
    report = db.get(Report, report_id)
    if report is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Report not found")
    return report


def unlink_report_file(file_path: str | None) -> None:
    """Unlink one generated PDF, proving it stays inside REPORTS_DIR.

    Shared by the report DELETE route and target deletion. A tampered
    `file_path` must never delete anything outside the reports folder.
    """
    if not file_path:
        return
    base = REPORTS_DIR.resolve()
    resolved = (base / file_path).resolve()
    if resolved.is_relative_to(base):
        resolved.unlink(missing_ok=True)


def _settle_stale_pending(db: Session, report: Report) -> bool:
    """Flip an over-age `pending` row to `failed`. Fresh pending rows are left
    alone, so a genuinely running job still gets its 409 and is never deleted
    out from under the worker."""
    if report.status != ReportStatus.pending:
        return False
    created = report.created_at
    if created.tzinfo is None:  # SQLite drops tzinfo on round-trip
        created = created.replace(tzinfo=timezone.utc)
    if (datetime.now(timezone.utc) - created).total_seconds() <= STALE_PENDING_SECONDS:
        return False
    report.status = ReportStatus.failed
    report.error = "Report generation timed out (worker stopped before completing)"
    report.finished_at = utcnow()
    return True

def _live_pending(db: Session, assessment_id: int) -> list[Report]:
    """Pending rows for an assessment after settling any that are over-age."""
    pending = list(
        db.scalars(
            select(Report)
            .where(Report.assessment_id == assessment_id, Report.status == ReportStatus.pending)
            .order_by(Report.id.desc())
        )
    )
    settled = False
    for row in pending:
        settled = _settle_stale_pending(db, row) or settled
    if settled:
        db.commit()
    return [row for row in pending if row.status == ReportStatus.pending]


@router.post("/assessments/{assessment_id}/report", response_model=ReportOut, status_code=status.HTTP_202_ACCEPTED)
def create_report(
    assessment_id: int,
    background_tasks: BackgroundTasks,
    user: User = Depends(require_role(Role.admin, Role.assessor)),
    db: Session = Depends(get_db),
) -> Report:
    if db.get(Assessment, assessment_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Assessment not found")

    # Idempotency (F-30): two fast clicks, two tabs or an automatic retry must
    # not enqueue a second headless-Chromium render. Return the existing
    # pending row with the SAME 202 rather than adding a new error status to
    # the frozen contract - the caller cannot tell and nothing breaks.
    live = _live_pending(db, assessment_id)
    if live:
        return live[0]

    report = Report(assessment_id=assessment_id, created_by_id=user.id)
    db.add(report)
    try:
        db.commit()
    except IntegrityError:
        # F-40: the pre-check above is not atomic - two requests inside the same
        # window both see "no pending row". uq_reports_one_pending_per_assessment
        # (database.py) lets exactly one insert win; the loser re-reads the
        # winner's row and answers with the same 202 instead of a 500.
        db.rollback()
        existing = db.scalar(
            select(Report)
            .where(Report.assessment_id == assessment_id, Report.status == ReportStatus.pending)
            .order_by(Report.id.desc())
        )
        if existing is not None:
            return existing
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "A report for this assessment is already being generated",
        ) from None
    db.refresh(report)
    background_tasks.add_task(run_report_job, report.id)
    return report

@router.get("/assessments/{assessment_id}/reports", response_model=list[ReportOut])
def list_reports(
    assessment_id: int,
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[Report]:
    if db.get(Assessment, assessment_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Assessment not found")
    reports = list(
        db.scalars(select(Report).where(Report.assessment_id == assessment_id).order_by(Report.id.desc()))
    )
    settled = False
    for report in reports:
        settled = _settle_stale_pending(db, report) or settled
    if settled:
        db.commit()
    return reports

@router.get("/reports/{report_id}")
def download_report(
    report_id: int,
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FileResponse:
    report = _get_report_or_404(db, report_id)
    if _settle_stale_pending(db, report):
        db.commit()
    if report.status == ReportStatus.pending:
        raise HTTPException(status.HTTP_409_CONFLICT, "Report generation is still in progress")
    if report.status == ReportStatus.failed:
        # The detailed, path-sanitized error stays on the row and is rendered by
        # the report list's <details> toggle; do not reflect it in an HTTP error.
        raise HTTPException(status.HTTP_409_CONFLICT, "Report generation failed; see the report list for details")
    if not report.file_path:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Report file missing")

    resolved = (REPORTS_DIR / report.file_path).resolve()
    if not resolved.is_relative_to(REPORTS_DIR.resolve()) or not resolved.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Report file missing")
    return FileResponse(
        resolved,
        media_type="application/pdf",
        filename=f"security-report-assessment-{report.assessment_id}.pdf",
    )


@router.delete("/reports/{report_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_report(
    report_id: int,
    _: User = Depends(require_role(Role.admin, Role.assessor)),
    db: Session = Depends(get_db),
) -> None:
    """Delete a report row and its generated PDF.

    A *live* pending report is refused: the background job still owns the row
    and would fail against a deleted record. An over-age pending row is settled
    to failed first, so a worker that died before committing cannot wedge the
    report forever. The file is only unlinked after its path is proven to live
    inside REPORTS_DIR, the same guard the download uses, so a tampered
    `file_path` can never delete something outside the reports folder.
    """
    report = _get_report_or_404(db, report_id)
    if _settle_stale_pending(db, report):
        db.commit()
    if report.status == ReportStatus.pending:
        raise HTTPException(status.HTTP_409_CONFLICT, "Report generation is still in progress")

    if report.file_path:
        unlink_report_file(report.file_path)

    db.delete(report)
    db.commit()
