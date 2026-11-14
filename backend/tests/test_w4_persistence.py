"""Wave 4 regressions: SQLite persistence rules (F-39, F-40).

F-39 - the engine runs in WAL with a busy timeout, so workers and readers do
not serialise on one rollback journal.

F-40 - the partial unique index makes duplicate pending reports impossible and
the startup bootstrap dedups rows that predate it.
"""

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError

from app.database import SessionLocal, engine, ensure_sqlite_indexes
from app.models import (
    Assessment,
    Report,
    ReportStatus,
    ScanIntensity,
    Target,
)


def _seed_assessment() -> tuple[int, int]:
    with SessionLocal() as db:
        target = Target(
            name="w4-target",
            base_url="http://127.0.0.1:9",
            allowed_intensity=ScanIntensity.passive_safe,
        )
        db.add(target)
        db.flush()
        assessment = Assessment(
            target_id=target.id, intensity=ScanIntensity.passive_safe, categories=[]
        )
        db.add(assessment)
        db.commit()
        return assessment.id, target.id


def _cleanup(assessment_id: int, target_id: int) -> None:
    with SessionLocal() as db:
        for report in db.scalars(select(Report).where(Report.assessment_id == assessment_id)):
            db.delete(report)
        assessment = db.get(Assessment, assessment_id)
        if assessment is not None:
            for job in assessment.jobs:
                db.delete(job)
            db.delete(assessment)
        target = db.get(Target, target_id)
        if target is not None:
            db.delete(target)
        db.commit()


# --- F-39: SQLite pragmas --------------------------------------------------------


def test_sqlite_runs_in_wal_with_a_busy_timeout():
    with SessionLocal() as db:
        assert db.execute(text("PRAGMA journal_mode")).scalar() == "wal"
        assert db.execute(text("PRAGMA busy_timeout")).scalar() == 5000


# --- F-40: partial unique index --------------------------------------------------


def test_partial_index_rejects_a_second_pending_report():
    assessment_id, target_id = _seed_assessment()
    try:
        with SessionLocal() as db:
            db.add(Report(assessment_id=assessment_id, status=ReportStatus.pending))
            db.commit()
            db.add(Report(assessment_id=assessment_id, status=ReportStatus.pending))
            with pytest.raises(IntegrityError):
                db.commit()
            db.rollback()

        # The index is partial: finished rows are not constrained.
        with SessionLocal() as db:
            db.add(Report(assessment_id=assessment_id, status=ReportStatus.failed))
            db.commit()
    finally:
        _cleanup(assessment_id, target_id)


def test_index_bootstrap_settles_duplicate_pending_reports():
    """A database that already contains duplicates must still be upgradable:
    the bootstrap keeps the newest pending row and settles the rest."""
    assessment_id, target_id = _seed_assessment()
    try:
        with engine.begin() as conn:
            conn.execute(text("DROP INDEX IF EXISTS uq_reports_one_pending_per_assessment"))

        ids = []
        with SessionLocal() as db:
            for _ in range(2):
                row = Report(assessment_id=assessment_id, status=ReportStatus.pending)
                db.add(row)
                db.commit()
                ids.append(row.id)

        ensure_sqlite_indexes()

        with SessionLocal() as db:
            statuses = {
                row.id: row.status
                for row in db.scalars(
                    select(Report).where(Report.assessment_id == assessment_id)
                )
            }
            assert statuses[ids[0]] == ReportStatus.failed
            assert statuses[ids[1]] == ReportStatus.pending
            index_names = {
                row[0]
                for row in db.execute(
                    text(
                        "SELECT name FROM sqlite_master "
                        "WHERE type = 'index' AND tbl_name = 'reports'"
                    )
                )
            }
            assert "uq_reports_one_pending_per_assessment" in index_names
    finally:
        _cleanup(assessment_id, target_id)
