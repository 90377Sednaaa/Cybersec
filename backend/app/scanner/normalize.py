"""Normalizer (M1): deterministic results -> candidate findings.

Two sources are deterministic enough to become findings without AI:
- the prober's rule checks (missing header = missing header)
- ZAP alerts (already severity-classified by the engine)

Both are inserted with status `ai_candidate` (unverified, never counts as
confirmed). The AI interpreter (M2) adds the non-deterministic findings from
the same raw outputs later, so the two never need to coordinate: dedup is by
(assessment, title).
"""

from __future__ import annotations

import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Assessment, Evidence, EvidenceKind, Finding, FindingStatus, Job, Severity

ZAP_RISK_MAP = {"informational": Severity.info, "low": Severity.low, "medium": Severity.medium, "high": Severity.high}


def _title_taken(db: Session, assessment_id: int, title: str) -> bool:
    return (
        db.scalar(select(Finding).where(Finding.assessment_id == assessment_id, Finding.title == title).limit(1))
        is not None
    )


def create_candidate(
    db: Session,
    assessment: Assessment,
    job: Job,
    *,
    category: str,
    title: str,
    description: str,
    severity: Severity,
    remediation: str = "",
    score: float = 0.0,
    evidence_kind: EvidenceKind = EvidenceKind.tool_output,  # type: ignore[name-defined]
    evidence_content: str = "",
) -> Finding | None:
    if _title_taken(db, assessment.id, title):
        return None
    finding = Finding(
        assessment_id=assessment.id,
        source_job_id=job.id,
        category=category,
        title=title,
        description=description,
        severity=severity,
        score=score,
        status=FindingStatus.ai_candidate,
        ai_confidence=1.0,  # deterministic rule, not an AI guess
        remediation=remediation,
    )
    db.add(finding)
    db.flush()
    if evidence_content:
        db.add(
            Evidence(
                finding_id=finding.id,
                kind=evidence_kind,
                label=f"Output of {job.tool} job #{job.id}",
                content=evidence_content[:4000],
                tool=job.tool,
            )
        )
    return finding


def normalize_job(db: Session, assessment: Assessment, job: Job) -> int:
    """Create candidate findings from one completed job. Returns count created."""
    if not job.raw_output:
        return 0
    try:
        raw = json.loads(job.raw_output)
    except json.JSONDecodeError:
        return 0

    created = 0

    if job.tool == "prober":
        for c in raw.get("candidate_findings", []):
            finding = create_candidate(
                db,
                assessment,
                job,
                category=c.get("category", "Security configuration & HTTPS"),
                title=c["title"],
                description=c["title"],
                severity=Severity(c.get("severity", "low")),
                remediation=c.get("remediation", ""),
                evidence_content=json.dumps(raw.get("headers", {}), indent=2),
            )
            created += 1 if finding else 0

    if job.tool == "zap":
        for a in raw.get("alerts", []):
            if not a.get("title"):
                continue
            severity = ZAP_RISK_MAP.get(str(a.get("risk", "low")).lower(), Severity.low)
            finding = create_candidate(
                db,
                assessment,
                job,
                category="Input validation & injection",
                title=a["title"],
                description=(a.get("description") or "")[:1500] or a["title"],
                severity=severity,
                remediation=a.get("solution", ""),
                evidence_content=str(a.get("evidence", "")),
            )
            created += 1 if finding else 0

    db.commit()
    return created


def normalize_assessment(db: Session, assessment: Assessment, jobs: list[Job]) -> int:
    total = 0
    for job in jobs:
        if job.status == "completed":  # type: ignore[comparison-overlap]
            total += normalize_job(db, assessment, job)
    return total
