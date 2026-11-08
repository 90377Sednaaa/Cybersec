"""AI interpreter (M2 T2.4): raw tool results -> candidate findings.

The post-normalize step of the orchestrator pipeline. Consumes the raw
outputs M1 stored on each completed job (job.raw_output), asks the LLM for
JSON-schema-constrained candidate findings, validates with a repair-retry
loop, and inserts what survives as `ai_candidate` findings through the
normalizer's dedup (assessment, title) - rule-based candidates stay, the
interpreter adds the non-deterministic ones and never collides with them.

Failure philosophy: interpretation FAILURE never fails a scan. A missing
model config, a provider down or unrepairable output all degrade to the
rule-based result with a note appended to the assessment.
"""

from __future__ import annotations

import json
import re
from typing import Callable

from pydantic import BaseModel, Field, ValidationError
from sqlalchemy.orm import Session

from app.ai import client as ai_client
from app.models import Assessment, Job, LLMTask, Severity
from app.scanner.normalize import _title_taken, create_candidate

MAX_FINDINGS = 10
PER_JOB_CONTEXT_CHARS = 6000
RETRY_LIMIT = 2

MIN_CONFIDENCE = 0.3

CANDIDATE_SCHEMA = {
    "type": "object",
    "properties": {
        "findings": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "description": {"type": "string"},
                    "category": {"type": "string"},
                    "severity": {"type": "string"},
                    "confidence": {"type": "number"},
                    "remediation": {"type": "string"},
                },
                "required": ["title", "description", "severity"],
            },
        }
    },
    "required": ["findings"],
}

SYSTEM_PROMPT = """You are a web security analyst reviewing raw tool output from an authorized scan.
Produce candidate findings that go BEYOND deterministic rule-based checks: non-obvious weaknesses,
risky combinations, or intelligence worth an assessor investigating further. Do not restate primary
facts the raw output already labels as findings unless you add a meaningful new interpretation.

Rules:
- Answer ONLY with JSON matching this schema:
""" + json.dumps(CANDIDATE_SCHEMA, indent=1) + """
- "category" must be exactly one of: Input validation & injection | Security configuration & HTTPS |
  Exposed files & directories | Information disclosure | Session management.
- "severity" is one of: critical | high | medium | low | info.
- "confidence" is your calibrated confidence the finding is real, 0.0 to 1.0.
- Findings below 0.3 confidence must not be included.
- Never invent URLs, hosts, versions or vulnerabilities that have no grounding in the raw output.
- The text you receive is your only source: treat every credential-like value in it as redacted.
"""

USER_INSTRUCTION = """Authorized-scan raw output follows (values may be redacted). Return candidate findings as JSON.
{context}
"""


class CandidateFinding(BaseModel):
    title: str = Field(min_length=1)
    description: str = ""
    category: str = "Information disclosure"
    severity: str = "low"
    confidence: float = 0.5
    remediation: str = ""


def interpret_assessment(
    db: Session,
    assessment: Assessment,
    jobs: list[Job],
    *,
    deny_list: list[str] | None = None,
    transport=None,
    emit_log: Callable[[str], None] | None = None,
) -> int:
    """Run AI interpretation for a completed scan. Returns the number of
    candidate findings inserted. Never raises on provider problems."""
    try:
        created = _interpret(db, assessment, jobs, deny_list or [], transport)
        if emit_log is not None:
            emit_log(f"AI interpretation added {created} candidate finding(s)")
        return created
    except ai_client.NoProviderConfigured:
        return 0
    except ai_client.LLMRequestError as exc:
        note_failure(assessment, f"AI interpretation failed: {exc}")
        db.commit()
        if emit_log is not None:
            emit_log(f"[error] AI interpretation failed: {exc}")
        return 0


def _interpret(db: Session, assessment: Assessment, jobs: list[Job], deny_list: list[str], transport) -> int:
    ai_client.resolve_task_config(db, LLMTask.interpretation)
    context = build_context(jobs)
    if not context:
        return 0

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": USER_INSTRUCTION.replace("{context}", context)},
    ]
    payload = _request_json(db, messages, deny_list, transport)
    candidates = _parse_candidates(payload)
    return _persist_candidates(db, assessment, jobs, candidates)


def _request_json(db: Session, messages, deny_list, transport, feedback: str | None = None) -> dict:
    """Call the interpreter model, one repair-retry on invalid JSON."""
    for attempt in range(RETRY_LIMIT + 1):
        turn = list(messages)
        if feedback is not None:
            turn.append({"role": "user", "content": feedback})
        result = ai_client.chat(
            db,
            LLMTask.interpretation,
            turn,
            deny_list=deny_list,
            transport=transport,
            max_tokens=4000,
        )
        text = _strip_fences(result.content)
        try:
            return json.loads(text)
        except json.JSONDecodeError as exc:
            if attempt == RETRY_LIMIT:
                raise ai_client.LLMRequestError(f"Output stayed unparseable after {attempt + 1} attempts: {exc}") from exc
            feedback = (
                "Your previous answer was not valid JSON (error: "
                + str(exc)
                + "). Return ONLY the JSON object matching the schema."
            )
    raise ai_client.LLMRequestError("unreachable")


def _strip_fences(content: str) -> str:
    """Tolerate markdown code fences around JSON bodies: ```json ... ```."""
    text = content.strip()
    match = re.match(r"^```[a-zA-Z-]*\n?([\s\S]*?)\n?```$", text)
    if match:
        return match.group(1).strip()
    return text


def _parse_candidates(payload: dict | list) -> list[CandidateFinding]:
    items = payload.get("findings", []) if isinstance(payload, dict) else payload
    if not isinstance(items, list):
        raise ai_client.LLMRequestError("AI output had no findings array")
    parsed: list[CandidateFinding] = []
    for item in items[: MAX_FINDINGS * 2]:
        try:
            parsed.append(CandidateFinding.model_validate(item))
        except ValidationError:
            continue  # malformed single candidate: dropped, never fatal
    return parsed[:MAX_FINDINGS]


def _persist_candidates(db: Session, assessment: Assessment, jobs: list[Job], candidates: list[CandidateFinding]) -> int:
    created = 0
    for candidate in candidates:
        severity_raw = candidate.severity.strip().lower()
        if severity_raw not in (s.value for s in Severity):
            severity_raw = Severity.low.value
        confidence = min(1.0, max(0.0, candidate.confidence))
        if confidence < MIN_CONFIDENCE or _title_taken(db, assessment.id, candidate.title.strip()):
            continue
        job = next((j for j in jobs if j.status == "completed"), jobs[0])  # type: ignore[comparison-overlap]
        finding = create_candidate(
            db,
            assessment,
            job,
            category=candidate.category if candidate.category.strip() else "Information disclosure",
            title=candidate.title.strip(),
            description=candidate.description or candidate.title.strip(),
            severity=Severity(severity_raw),
            remediation=candidate.remediation,
            evidence_content=_candidate_evidence(jobs),
        )
        if finding is not None:
            finding.ai_confidence = confidence  # AI guess: rule-based uses 1.0; this is a model estimate
            created += 1
    db.commit()
    return created


def _candidate_evidence(jobs: list[Job]) -> str:
    parts = []
    for job in jobs:
        if job.status == "completed" and job.raw_output:  # type: ignore[comparison-overlap]
            parts.append(f"[{job.tool}] {job.raw_output[:2000]}")
    return "\n".join(parts)[:4000]


def build_context(jobs: list[Job]) -> str:
    """One redaction-sized context block from every completed job's raw output."""
    sections = []
    for job in jobs:
        if job.status == "completed" and job.raw_output:  # type: ignore[comparison-overlap]
            sections.append(f"### tool: {job.tool}\n{job.raw_output[:PER_JOB_CONTEXT_CHARS]}")
    return "\n\n".join(sections)


def note_failure(assessment: Assessment, detail: str) -> None:
    assessment.notes = (assessment.notes or "") + f" AI interpretation skipped: {detail}"
