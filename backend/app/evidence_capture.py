"""Evidence auto-capture helpers (M4 T4.2).

M1's normalizer already attaches `tool_output` evidence to candidate findings
(app/scanner/normalize.py). This module adds the `http_transcript` flavour:
a readable request/response-style rendering of what the prober actually
exchanged with the target, attached to an existing finding.

The orchestrator/normalizer wiring is M1's (one call site in the pipeline);
M4 owns this helper and keeps it dependency-free so the hand-off stays a
one-liner.
"""

from __future__ import annotations

import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Evidence, EvidenceKind, Finding, Job

MAX_TRANSCRIPT_CHARS = 4000

def _transcript_from_prober(raw: dict) -> str:
    """Readable request/response transcript from the prober's raw output.

    The prober stores what it fetched (url, status_code, headers, cookies) -
    rendered here the way an assessor would read a proxy capture.
    """
    lines = [f"GET {raw.get('url', '<unknown url>')}", ""]
    lines.append(f"HTTP status: {raw.get('status_code', '<unknown>')}")
    headers = raw.get("headers")
    if isinstance(headers, dict) and headers:
        lines.append("")
        lines.append("Response headers:")
        for name, value in headers.items():
            lines.append(f"  {name}: {value}")
    cookies = raw.get("cookies")
    if isinstance(cookies, list) and cookies:
        lines.append("")
        lines.append("Set-Cookie:")
        for cookie in cookies:
            lines.append(f"  {cookie}")
    return "\n".join(lines)

def transcript_for_job(job: Job) -> str | None:
    """Build transcript text for a completed job, or None if unusable."""
    if not job.raw_output:
        return None
    try:
        raw = json.loads(job.raw_output)
    except json.JSONDecodeError:
        return None
    if not isinstance(raw, dict):
        return None
    if job.tool == "prober":
        return _transcript_from_prober(raw) or None
    return None  # other tools' output stays tool_output evidence (normalizer's job)

def capture_http_transcript(db: Session, finding: Finding, job: Job) -> Evidence | None:
    """Attach one http_transcript evidence item from `job` to `finding`.

    Idempotent per (finding, job): a second call for the same pair is a no-op,
    so pipeline retries cannot pile up duplicate transcripts. Returns the new
    Evidence, or None when the job has nothing transcript-shaped or the
    transcript already exists.
    """
    text = transcript_for_job(job)
    if text is None:
        return None
    label = f"HTTP transcript of {job.tool} job #{job.id}"
    existing = db.scalar(
        select(Evidence).where(
            Evidence.finding_id == finding.id,
            Evidence.kind == EvidenceKind.http_transcript,
            Evidence.label == label,
        )
    )
    if existing is not None:
        return None
    evidence = Evidence(
        finding_id=finding.id,
        kind=EvidenceKind.http_transcript,
        label=label,
        content=text[:MAX_TRANSCRIPT_CHARS],
        tool=job.tool,
    )
    db.add(evidence)
    return evidence
