"""Assessment summarizer (M2 T2.5): reports feed on VERIFIED findings only.

Generates the executive summary + per-finding explanation/remediation text
M4's report template renders. Grounded strictly in verified findings:
unverified candidates are deliberately out of scope (a summary that reads an
unconfirmed claim as fact would misstate the assessment).

Outputs are stored in ai_outputs (task=summary) so the report generator (M4)
and the evidence pack can retrieve them, with the model recorded for audit.
"""

from __future__ import annotations

import json
from typing import Callable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai import client as ai_client
from app.ai.interpret import _strip_fences
from app.models import AIOutput, Assessment, Finding, FindingStatus, LLMTask

CAP_FINDINGS = 30


def summarize_assessment(
    db: Session,
    assessment: Assessment,
    findings: list[Finding],
    *,
    deny_list: list[str] | None = None,
    transport=None,
    emit_log: Callable[[str], None] | None = None,
) -> dict | None:
    """Summarize from VERIFIED findings only. Returns the stored summary dict,
    or None when no summarizer model is configured / nothing to summarize.
    Provider errors raise LLMRequestError (callers decide degradation); the
    hard filter on verified status can never be bypassed."""
    verified = [f for f in findings if f.status == FindingStatus.verified][:CAP_FINDINGS]
    if not verified:
        return None
    result = ai_client.chat(
        db,
        LLMTask.summary,
        _build_messages(assessment, verified),
        deny_list=deny_list or [],
        transport=transport,
        max_tokens=3000,
        timeout=120.0,
    )
    summary = _parse_summary(result.content)
    if summary is None:
        raise ai_client.LLMRequestError("Summary output was not valid JSON")
    _store(db, assessment, verified, result.model, summary)
    if emit_log is not None:
        emit_log(f"AI summary generated over {len(verified)} verified finding(s)")
    return summary


def _build_messages(assessment: Assessment, verified: list[Finding]) -> list[dict]:
    digest = [
        {
            "title": f.title,
            "category": f.category,
            "severity": f.severity.value,
            "score": f.score,
            "description": f.description,
            "assessor_notes": f.assessor_notes,
            "remediation": f.remediation,
            "verified_by": "an authenticated assessor",
            "verified_at": f.verified_at.isoformat() if f.verified_at else None,
        }
        for f in verified
    ]
    system = (
        "You are a senior security consultant writing the AI-assisted narrative FOR THE FINAL "
        "REPORT of an authorized security assessment. The findings you receive were CONFIRMED by "
        "a human assessor; do not invent, re-classify, or add findings. Everything is already "
        "redacted; never attempt to reconstruct redacted values.\n"
        "Answer ONLY with JSON of the shape:\n"
        '{"executive_summary": string (<=200 words, plain, defensible), '
        '"target_overview": string (<=80 words), '
        '"finding_explanations": [{"title": exact finding title, "explanation": string, '
        '"remediation": string}]} — one entry per provided finding, explanations '
        "grounded ONLY in the given finding data."
    )
    user = json.dumps(
        {
            "assessment_id": assessment.id,
            "intensity": assessment.intensity.value,
            "verified_findings": digest,
        },
        indent=1,
    )
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": f"Assessment data:\n{user}"},
    ]


def _parse_summary(content: str) -> dict | None:
    # Models commonly wrap JSON in a ```json ... ``` fence despite being told
    # "JSON only". The old code stripped only the opening fence, leaving the
    # closing ``` behind so json.loads failed with "Extra data". Reuse the
    # interpreter's stripper so both AI tasks tolerate the same shapes.
    text = _strip_fences(content)
    if not text.startswith("{"):
        return None
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict) or "executive_summary" not in payload:
        return None
    return payload


def _store(db: Session, assessment: Assessment, verified: list[Finding], model: str, summary: dict) -> AIOutput:
    row = AIOutput(task=LLMTask.summary, assessment_id=assessment.id, model=model, content=json.dumps(summary, indent=1))
    db.add(row)
    for finding in verified:
        db.add(
            AIOutput(
                task=LLMTask.summary,
                assessment_id=assessment.id,
                finding_id=finding.id,
                model=model,
                content=json.dumps(
                    next(
                        (e for e in summary.get("finding_explanations", []) if e.get("title") == finding.title),
                        {"title": finding.title},
                    ),
                    indent=1,
                ),
            )
        )
    db.commit()
    return row


def verified_findings_for(db: Session, assessment_id: int) -> list[Finding]:
    """Convenience loader for M4's report generator."""
    return list(
        db.scalars(
            select(Finding).where(Finding.assessment_id == assessment_id, Finding.status == FindingStatus.verified)
        )
    )
