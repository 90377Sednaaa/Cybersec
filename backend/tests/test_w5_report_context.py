"""Wave 5: the report context loads evidence in one query (F-34).

The PDF row builder reads `finding.evidence` for every finding, so the lazy
relationship issued one SELECT per finding. The assertion is on statement
count, not on timing: timing would be environment-dependent, the N+1 is not.
"""

from sqlalchemy import event

from app.database import SessionLocal, engine
from app.models import (
    Assessment,
    AssessmentStatus,
    Evidence,
    EvidenceKind,
    Finding,
    FindingStatus,
    ScanIntensity,
    Severity,
    Target,
)
from app.reporting import build_report_context


def _seed() -> tuple[int, int]:
    """Target + assessment + three findings, each with two evidence rows."""
    with SessionLocal() as db:
        target = Target(
            name="w5-report-context",
            base_url="http://127.0.0.1:8000",
            authorization_ref="TEST-AUTH-W5",
            in_scope_assets=["http://127.0.0.1:8000"],
            allowed_intensity=ScanIntensity.passive_safe,
        )
        db.add(target)
        db.flush()
        assessment = Assessment(
            target_id=target.id,
            intensity=ScanIntensity.passive_safe,
            categories=["Security configuration & HTTPS"],
            status=AssessmentStatus.completed,
        )
        db.add(assessment)
        db.flush()
        for index in range(3):
            finding = Finding(
                assessment_id=assessment.id,
                category="Security configuration & HTTPS",
                title=f"Finding {index}",
                description="Seeded for the query-count test.",
                severity=Severity.medium,
                status=FindingStatus.ai_candidate,
            )
            db.add(finding)
            db.flush()
            for item in range(2):
                db.add(
                    Evidence(
                        finding_id=finding.id,
                        kind=EvidenceKind.tool_output,
                        label=f"evidence {index}-{item}",
                        content="seeded",
                        tool="prober",
                    )
                )
        db.commit()
        return assessment.id, target.id


def _cleanup(assessment_id: int, target_id: int) -> None:
    with SessionLocal() as db:
        for finding in db.query(Finding).filter(Finding.assessment_id == assessment_id):
            for row in list(finding.evidence):
                db.delete(row)
            db.delete(finding)
        db.delete(db.get(Assessment, assessment_id))
        db.delete(db.get(Target, target_id))
        db.commit()


def test_report_context_fetches_evidence_in_one_select():
    assessment_id, target_id = _seed()
    statements: list[str] = []

    def capture(_conn, _cursor, statement, _params, _context, _many):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", capture)
    try:
        with SessionLocal() as db:
            context = build_report_context(db, db.get(Assessment, assessment_id))
    finally:
        event.remove(engine, "before_cursor_execute", capture)
        _cleanup(assessment_id, target_id)

    evidence_selects = [s for s in statements if "FROM evidence" in s]
    assert len(evidence_selects) == 1, (
        "expected one batched evidence query, got "
        f"{len(evidence_selects)}: {evidence_selects}"
    )
    # And the context still contains every evidence row.
    total = sum(
        len(row["evidence"])
        for _tier, rows in context["findings_by_severity"]
        for row in rows
    )
    assert total == 6
