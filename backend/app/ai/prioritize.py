"""AI risk prioritization (M2 T2.5 stretch): rank findings by exploitability & impact.

Produces an advisory remediation priority order over an assessment's active
(non-false-positive) findings, grounded in severity, score, evidence, and
cross-finding chaining potential. Strictly advisory: never mutates finding
status, human verification attribution, or assessor scores.

Results are stored in `ai_outputs` (`task=prioritization`) for auditability
and fast cached retrieval on the Assessment Triage tab.
"""

from __future__ import annotations

import json

from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai import client as ai_client
from app.ai.interpret import extract_json_text
from app.models import AIOutput, Assessment, Finding, FindingStatus, LLMTask

CAP_FINDINGS = 40
RETRY_LIMIT = 1

PRIORITY_SCHEMA = {
    "type": "object",
    "properties": {
        "rankings": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "finding_id": {"type": "integer"},
                    "rank": {"type": "integer"},
                    "urgency": {"type": "string"},
                    "rationale": {"type": "string"},
                },
                "required": ["finding_id", "rank", "urgency", "rationale"],
            },
        }
    },
    "required": ["rankings"],
}

SYSTEM_PROMPT = (
    "You are a senior penetration tester prioritizing security findings for remediation.\n"
    "Rank the provided findings from highest operational urgency (rank 1) to lowest, considering:\n"
    "1. Exploitability (unauthenticated vs authenticated, direct vs defense-in-depth)\n"
    "2. Real-world impact and chaining potential (e.g. missing CSP + XSS, or missing HttpOnly + reflection)\n"
    "3. Whether an assessor already verified the finding.\n"
    "Rules:\n"
    "- Answer ONLY with JSON matching this schema:\n"
    + json.dumps(PRIORITY_SCHEMA, indent=1)
    + "\n"
    "- Only include finding_ids that exist in the input list; never invent IDs.\n"
    "- urgency must be one of: immediate | high | medium | low.\n"
    "- rationale must be concise (<= 160 chars), concrete, and grounded strictly in the input data.\n"
    "- Never attempt to reconstruct redacted values."
)

VALID_URGENCIES = {"immediate", "high", "medium", "low"}


class PriorityEntry(BaseModel):
    finding_id: int
    rank: int = Field(ge=1)
    urgency: str = "medium"
    rationale: str = Field(min_length=1, max_length=300)


def latest_prioritization(db: Session, assessment_id: int) -> dict | None:
    """Read the most recent stored prioritization for an assessment (read-only)."""
    row = db.scalar(
        select(AIOutput)
        .where(
            AIOutput.task == LLMTask.prioritization,
            AIOutput.assessment_id == assessment_id,
            AIOutput.finding_id.is_(None),
        )
        .order_by(AIOutput.id.desc())
    )
    if row is None:
        return None
    try:
        payload = json.loads(row.content)
    except (TypeError, ValueError):
        return None
    if not isinstance(payload, dict) or not isinstance(payload.get("rankings"), list):
        return None
    return {
        "assessment_id": assessment_id,
        "model": row.model or "",
        "created_at": row.created_at,
        "rankings": payload["rankings"],
    }


def prioritize_assessment(
    db: Session,
    assessment: Assessment,
    findings: list[Finding],
    *,
    deny_list: list[str] | None = None,
    transport=None,
) -> dict:
    """Rank active findings using the configured `prioritization` model."""
    active = [f for f in findings if f.status != FindingStatus.false_positive][:CAP_FINDINGS]
    if not active:
        return {"assessment_id": assessment.id, "model": "", "created_at": None, "rankings": []}

    valid_ids = {f.id for f in active}
    digest = [
        {
            "finding_id": f.id,
            "title": f.title,
            "category": f.category,
            "severity": f.severity.value if hasattr(f.severity, "value") else str(f.severity),
            "score": f.score,
            "status": f.status.value if hasattr(f.status, "value") else str(f.status),
            "description": (f.description or "")[:300],
        }
        for f in active
    ]
    base_messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {
            "role": "user",
            "content": f"Assessment #{assessment.id} active findings:\n{json.dumps(digest, indent=1)}",
        },
    ]

    feedback: str | None = None
    parsed_entries: list[dict] = []
    model_used = ""

    for attempt in range(RETRY_LIMIT + 1):
        turn = list(base_messages)
        if feedback is not None:
            turn.append({"role": "user", "content": feedback})
        result = ai_client.chat(
            db,
            LLMTask.prioritization,
            turn,
            deny_list=deny_list or [],
            transport=transport,
            max_tokens=2500,
            timeout=90.0,
        )
        model_used = result.model
        text = extract_json_text(result.content)
        try:
            payload = json.loads(text)
        except json.JSONDecodeError as exc:
            if attempt == RETRY_LIMIT:
                raise ai_client.LLMRequestError(f"Prioritization output was not valid JSON: {exc}") from exc
            feedback = (
                f"Your previous answer was not valid JSON ({exc}). "
                "Return ONLY the JSON object matching the schema."
            )
            continue

        raw_rankings = payload.get("rankings") if isinstance(payload, dict) else None
        if not isinstance(raw_rankings, list):
            if attempt == RETRY_LIMIT:
                raise ai_client.LLMRequestError("Prioritization output had no rankings array")
            feedback = "Return ONLY a JSON object with a 'rankings' array matching the schema."
            continue

        seen: set[int] = set()
        entries: list[PriorityEntry] = []
        for item in raw_rankings:
            try:
                entry = PriorityEntry.model_validate(item)
            except ValidationError:
                continue
            if entry.finding_id not in valid_ids or entry.finding_id in seen:
                continue
            seen.add(entry.finding_id)
            urgency = entry.urgency.strip().lower()
            if urgency not in VALID_URGENCIES:
                urgency = "medium"
            entries.append(
                PriorityEntry(
                    finding_id=entry.finding_id,
                    rank=entry.rank,
                    urgency=urgency,
                    rationale=entry.rationale.strip(),
                )
            )
        entries.sort(key=lambda e: e.rank)
        parsed_entries = [
            {
                "finding_id": e.finding_id,
                "rank": idx + 1,
                "urgency": e.urgency,
                "rationale": e.rationale,
            }
            for idx, e in enumerate(entries)
        ]
        break

    audit_row = AIOutput(
        task=LLMTask.prioritization,
        assessment_id=assessment.id,
        model=model_used,
        content=json.dumps({"rankings": parsed_entries}, indent=1),
    )
    db.add(audit_row)
    db.commit()
    db.refresh(audit_row)

    return {
        "assessment_id": assessment.id,
        "model": model_used,
        "created_at": audit_row.created_at,
        "rankings": parsed_entries,
    }
