"""Wave 5: an overlapping finding decision cannot be lost silently (F-35).

The probe that opened this wave showed SQLite does not raise "database is
locked" here - the second commit succeeds and simply wins. That is a lost
update, not a crash, so the regression has to be deterministic rather than a
thread race: the endpoint's read is interleaved with a competing commit.
"""

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.api import findings as findings_api
from app.database import SessionLocal
from app.models import Finding, FindingStatus, Role, Severity, User
from app.schemas.findings import FindingUpdate


def _seed_finding() -> int:
    with SessionLocal() as db:
        finding = Finding(
            category="Security configuration & HTTPS",
            title="Race probe",
            description="Two assessors review the same candidate.",
            severity=Severity.medium,
            status=FindingStatus.ai_candidate,
        )
        db.add(finding)
        db.commit()
        return finding.id


def _admin(db) -> User:
    return db.scalar(select(User).where(User.role == Role.admin))


def test_overlapping_decision_returns_409_and_keeps_the_first(monkeypatch):
    finding_id = _seed_finding()
    real_get = findings_api._get_finding_or_404

    def racing_get(db, requested_id):
        # The endpoint reads `ai_candidate`...
        finding = real_get(db, requested_id)
        # ...then a second assessor verifies the same finding and commits before
        # the first request's write lands.
        with SessionLocal() as rival_db:
            rival = rival_db.get(Finding, requested_id)
            rival.status = FindingStatus.verified
            rival_db.commit()
        return finding

    monkeypatch.setattr(findings_api, "_get_finding_or_404", racing_get)

    try:
        with SessionLocal() as db:
            with pytest.raises(HTTPException) as exc:
                findings_api.update_finding(
                    finding_id,
                    FindingUpdate(status=FindingStatus.false_positive),
                    _admin(db),
                    db,
                )
            assert exc.value.status_code == 409

        # The verification that won is still there - not overwritten.
        with SessionLocal() as db:
            assert db.get(Finding, finding_id).status == FindingStatus.verified
    finally:
        with SessionLocal() as db:
            finding = db.get(Finding, finding_id)
            if finding is not None:
                db.delete(finding)
                db.commit()


def test_a_fresh_read_can_still_revise_the_decision():
    """Guard against over-firing: re-reading after the 409 is a legal move
    (verified -> false_positive is an allowed transition)."""
    finding_id = _seed_finding()
    try:
        with SessionLocal() as db:
            finding = db.get(Finding, finding_id)
            finding.status = FindingStatus.verified
            db.commit()

        with SessionLocal() as db:
            updated = findings_api.update_finding(
                finding_id,
                FindingUpdate(status=FindingStatus.false_positive),
                _admin(db),
                db,
            )
            assert updated.status == FindingStatus.false_positive
    finally:
        with SessionLocal() as db:
            finding = db.get(Finding, finding_id)
            if finding is not None:
                db.delete(finding)
                db.commit()


def test_field_only_patch_still_updates_without_a_status_change():
    """The CAS path is only for status; notes/severity writes stay last-write-wins."""
    finding_id = _seed_finding()
    try:
        with SessionLocal() as db:
            updated = findings_api.update_finding(
                finding_id,
                FindingUpdate(assessor_notes="Checked by hand", severity=Severity.high),
                _admin(db),
                db,
            )
            assert updated.assessor_notes == "Checked by hand"
            assert updated.severity == Severity.high
            assert updated.status == FindingStatus.ai_candidate
    finally:
        with SessionLocal() as db:
            finding = db.get(Finding, finding_id)
            if finding is not None:
                db.delete(finding)
                db.commit()
