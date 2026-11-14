"""Wave 4 scan-wiring regressions (F-11).

`capture_http_transcript` shipped in M4 but had no caller on the scan path, so
a real run never attached an HTTP transcript to a rule-based finding. These
tests pin the call site inside the normalizer, not the helper itself (the
helper's own contract is covered in test_evidence_api.py).
"""

import json

from app.database import SessionLocal
from app.models import (
    Assessment,
    EvidenceKind,
    Job,
    ScanIntensity,
    Severity,
    Target,
)
from app.evidence_capture import capture_http_transcript
from app.scanner.normalize import create_candidate


def _add_prober_job(raw_output: str) -> int:
    with SessionLocal() as db:
        job = Job(tool="prober", status="completed", raw_output=raw_output)
        db.add(job)
        db.commit()
        return job.id


def test_create_candidate_attaches_a_http_transcript():
    raw = json.dumps(
        {
            "url": "http://localhost:3000/login",
            "status_code": 200,
            "headers": {"server": "express", "x-powered-by": "Express"},
            "cookies": ["session=abc; Path=/; HttpOnly"],
        }
    )
    job_id = _add_prober_job(raw)
    with SessionLocal() as db:
        target = Target(
            name="wiring-target",
            base_url="http://localhost:3000",
            allowed_intensity=ScanIntensity.passive_safe,
        )
        db.add(target)
        db.flush()
        assessment = Assessment(
            target_id=target.id, intensity=ScanIntensity.passive_safe, categories=[]
        )
        db.add(assessment)
        db.flush()
        job = db.get(Job, job_id)
        finding = create_candidate(
            db,
            assessment,
            job,
            category="Security configuration & HTTPS",
            title="Missing Content-Security-Policy",
            description="No CSP header was returned.",
            severity=Severity.medium,
        )
        db.commit()

        transcript = [e for e in finding.evidence if e.kind == EvidenceKind.http_transcript]
        assert len(transcript) == 1
        assert transcript[0].tool == "prober"
        assert "GET http://localhost:3000/login" in transcript[0].content
        # idempotent: a retry cannot duplicate the transcript
        assert capture_http_transcript(db, finding, job) is None

        db.delete(finding)
        db.delete(assessment)
        db.delete(target)
        db.commit()
