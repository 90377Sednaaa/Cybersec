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
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai import client as ai_client
from app.models import AIOutput, Assessment, Finding, Job, JobStatus, LLMTask, Severity
from app.scanner.normalize import _title_taken, create_candidate

MAX_FINDINGS = 10
PER_JOB_CONTEXT_CHARS = 6000
RETRY_LIMIT = 2

MIN_CONFIDENCE = 0.3

# Audit rows hold the model's own answer, never the prompt. A cap keeps a
# runaway completion from bloating the evidence database.
MAX_AUDIT_CHARS = 20_000

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
                    "source_tool": {"type": "string"},
                    "evidence_excerpt": {"type": "string"},
                },
                "required": ["title", "description", "severity"],
            },
        }
    },
    "required": ["findings"],
}

SYSTEM_PROMPT = """You are a senior web security analyst reviewing raw tool output from an authorized scan.
Produce candidate findings that go BEYOND deterministic rule-based checks: non-obvious weaknesses,
risky cross-tool combinations (e.g. exposed service versions combined with missing headers or alert evidence),
or intelligence worth an assessor investigating further. Do NOT restate findings already listed under
"Already recorded deterministic findings".

Rules:
- Answer ONLY with JSON matching this schema:
""" + json.dumps(CANDIDATE_SCHEMA, indent=1) + """
- "category" must be exactly one of: Input validation & injection | Security configuration & HTTPS |
  Exposed files & directories | Information disclosure | Session management.
- "severity" is one of: critical | high | medium | low | info.
- "confidence" is your calibrated confidence the finding is real, 0.0 to 1.0.
- Findings below 0.3 confidence must not be included.
- "source_tool" should be one of: dns | nmap | prober | zap | cross_tool (whichever tool supplied the primary signal).
- "evidence_excerpt" should quote the exact, concise snippet from the raw output that grounds the finding (<= 400 chars).
- Never invent URLs, hosts, versions or vulnerabilities that have no grounding in the raw output.
- The text you receive is your only source: treat every credential-like value in it as redacted.
"""

USER_INSTRUCTION = """Authorized-scan raw output follows (values may be redacted). Return candidate findings as JSON.
{scope_header}
{existing_header}
{context}
"""


class CandidateFinding(BaseModel):
    title: str = Field(min_length=1)
    description: str = ""
    category: str = "Information disclosure"
    severity: str = "low"
    confidence: float = 0.5
    remediation: str = ""
    source_tool: str = ""
    evidence_excerpt: str = ""


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
        # F-16: failures belong in the audit trail too, or an empty ai_outputs
        # table is indistinguishable from "the AI was never asked".
        _store_output(db, assessment, model="", content=json.dumps({"error": str(exc)}, indent=1))
        note_failure(assessment, f"AI interpretation failed: {exc}")
        db.commit()
        if emit_log is not None:
            emit_log(f"[error] AI interpretation failed: {exc}")
        return 0


def _store_output(db: Session, assessment: Assessment, *, model: str, content: str) -> AIOutput:
    """Persist one interpretation output (F-16).

    `models/llm.py` documents ai_outputs as the audit trail of what the AI said,
    but interpretation wrote none - only the summarizer did. The evidence pack
    needs the interpreter's answers too, kept separate from human-verified
    findings exactly like the summary rows.
    """
    row = AIOutput(
        task=LLMTask.interpretation,
        assessment_id=assessment.id,
        model=model,
        content=content[:MAX_AUDIT_CHARS],
    )
    db.add(row)
    return row


def _interpret(db: Session, assessment: Assessment, jobs: list[Job], deny_list: list[str], transport) -> int:
    ai_client.resolve_task_config(db, LLMTask.interpretation)
    context = build_context(jobs)
    if not context:
        return 0

    existing_rows = list(
        db.scalars(select(Finding.title).where(Finding.assessment_id == assessment.id).order_by(Finding.id))
    )
    existing_header = (
        "Already recorded deterministic findings (do not repeat these):\n- "
        + "\n- ".join(existing_rows[:40])
        + "\n"
        if existing_rows
        else ""
    )

    selected_cats = [c for c in (assessment.categories or []) if c and c.lower() != "all"]
    scope_parts = [f"Intensity: {assessment.intensity.value if hasattr(assessment.intensity, 'value') else assessment.intensity}"]
    if selected_cats:
        scope_parts.append("Prioritize categories: " + ", ".join(selected_cats))
    scope_header = "Assessment scope: " + " | ".join(scope_parts)

    user_content = (
        USER_INSTRUCTION.replace("{scope_header}", scope_header)
        .replace("{existing_header}", existing_header)
        .replace("{context}", context)
    )
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_content},
    ]
    payload = _request_json(db, assessment, messages, deny_list, transport)
    candidates = _parse_candidates(payload)
    return _persist_candidates(db, assessment, jobs, candidates)


def _request_json(
    db: Session,
    assessment: Assessment,
    messages,
    deny_list,
    transport,
    feedback: str | None = None,
) -> dict:
    """Call the interpreter model, one repair-retry on invalid JSON.

    Each model answer is stored as an AIOutput row before it is parsed, so even
    the attempts that had to be retried are on record (F-16).
    """
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
        _store_output(db, assessment, model=result.model, content=result.content)
        text = extract_json_text(result.content)
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


def extract_json_text(content: str) -> str:
    """Extract a JSON object/array from bare JSON, markdown fences, or prose-wrapped output."""
    stripped = _strip_fences(content)
    if stripped.startswith(("{", "[")):
        return stripped
    # Look for a fenced JSON block anywhere inside prose preamble/epilogue.
    fenced = re.search(r"```(?:json)?\s*([\s\S]*?)```", content, flags=re.IGNORECASE)
    if fenced:
        inner = fenced.group(1).strip()
        if inner.startswith(("{", "[")):
            return inner
    # Last resort: slice from the first '{' to the last '}' if present.
    start = content.find("{")
    end = content.rfind("}")
    if start != -1 and end > start:
        return content[start : end + 1].strip()
    return stripped


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


def _pick_source_job(jobs: list[Job], source_tool: str) -> Job:
    completed = [j for j in jobs if j.status == JobStatus.completed]
    tool_key = (source_tool or "").strip().lower()
    if tool_key:
        match = next((j for j in completed if j.tool.lower() == tool_key), None)
        if match is not None:
            return match
    return completed[0] if completed else jobs[0]


def _persist_candidates(db: Session, assessment: Assessment, jobs: list[Job], candidates: list[CandidateFinding]) -> int:
    created = 0
    for candidate in candidates:
        severity_raw = candidate.severity.strip().lower()
        if severity_raw not in (s.value for s in Severity):
            severity_raw = Severity.low.value
        confidence = min(1.0, max(0.0, candidate.confidence))
        if confidence < MIN_CONFIDENCE or _title_taken(db, assessment.id, candidate.title.strip()):
            continue
        job = _pick_source_job(jobs, candidate.source_tool)
        excerpt = (candidate.evidence_excerpt or "").strip()
        evidence_text = (
            f"Source tool: {candidate.source_tool or job.tool}\n\n{excerpt}"
            if excerpt
            else _candidate_evidence([job]) or _candidate_evidence(jobs)
        )
        finding = create_candidate(
            db,
            assessment,
            job,
            category=candidate.category if candidate.category.strip() else "Information disclosure",
            title=candidate.title.strip(),
            description=candidate.description or candidate.title.strip(),
            severity=Severity(severity_raw),
            remediation=candidate.remediation,
            evidence_content=evidence_text,
        )
        if finding is not None:
            finding.ai_confidence = confidence  # AI guess: rule-based uses 1.0; this is a model estimate
            created += 1
    db.commit()
    return created


def _candidate_evidence(jobs: list[Job]) -> str:
    parts = []
    for job in jobs:
        if job.status == JobStatus.completed and job.raw_output:
            parts.append(f"[{job.tool}] {job.raw_output[:2000]}")
    return "\n".join(parts)[:4000]


def _digest_job(job: Job) -> str:
    """Turn a completed job's raw JSON into a compact, high-signal digest so
    chatty scans (e.g. 50+ ZAP alerts or large Nmap runs) do not lose high-risk
    signals to blind character truncation."""
    raw_text = job.raw_output or ""
    try:
        raw = json.loads(raw_text)
    except (TypeError, ValueError):
        return raw_text[:PER_JOB_CONTEXT_CHARS]
    if not isinstance(raw, dict):
        return raw_text[:PER_JOB_CONTEXT_CHARS]

    tool = (job.tool or "").lower()
    if tool == "dns":
        lines = [f"Hostname: {raw.get('hostname', '')}"]
        addrs = raw.get("addresses") or {}
        if isinstance(addrs, dict):
            if addrs.get("ipv4"):
                lines.append(f"IPv4: {', '.join(addrs['ipv4'])}")
            if addrs.get("ipv6"):
                lines.append(f"IPv6: {', '.join(addrs['ipv6'])}")
        for rtype in ("mx", "ns", "txt"):
            vals = raw.get(rtype) or []
            if vals:
                lines.append(f"{rtype.upper()}: {', '.join(str(v) for v in vals[:10])}")
        subs = raw.get("subdomains") or {}
        if isinstance(subs, dict) and subs:
            lines.append(f"Subdomains ({len(subs)}): " + ", ".join(f"{k}={v}" for k, v in list(subs.items())[:15]))
        return "\n".join(lines)[:PER_JOB_CONTEXT_CHARS]

    if tool == "nmap":
        lines: list[str] = []
        if raw.get("summary"):
            lines.append(f"Summary: {raw['summary']}")
        for host in raw.get("hosts") or []:
            if not isinstance(host, dict):
                continue
            lines.append(f"Host: {host.get('address', '')} ({host.get('hostname', '')})")
            for p in host.get("open_ports") or []:
                if not isinstance(p, dict):
                    continue
                detail = " ".join(
                    str(x)
                    for x in (p.get("service"), p.get("product"), p.get("version"), p.get("extrainfo"))
                    if x
                )
                cpes = p.get("cpe") or []
                cpe_suffix = f" [cpe: {', '.join(cpes[:2])}]" if cpes else ""
                lines.append(f"  - {p.get('port')}/{p.get('protocol', 'tcp')} open {detail}{cpe_suffix}".rstrip())
        return ("\n".join(lines) if lines else raw_text)[:PER_JOB_CONTEXT_CHARS]

    if tool == "prober":
        lines = [
            f"URL: {raw.get('url', '')} (HTTP {raw.get('status_code', '?')})",
            f"Headers: {json.dumps(raw.get('headers', {}))}",
        ]
        cookies = raw.get("cookies") or []
        if cookies:
            lines.append(f"Cookies ({len(cookies)}): " + " | ".join(str(c)[:140] for c in cookies[:10]))
        tls = raw.get("tls") or {}
        if tls:
            lines.append(f"TLS: {json.dumps(tls)}")
        probed = raw.get("probed_paths") or []
        if probed:
            lines.append(
                f"Exposed paths ({len(probed)}): "
                + ", ".join(f"{p.get('path')} (HTTP {p.get('status')})" for p in probed[:20] if isinstance(p, dict))
            )
        return "\n".join(lines)[:PER_JOB_CONTEXT_CHARS]

    if tool == "zap":
        alerts = raw.get("alerts") or []
        if not isinstance(alerts, list):
            return raw_text[:PER_JOB_CONTEXT_CHARS]
        # Group by (title, risk) so repeated URL instances don't starve other alerts.
        risk_rank = {"critical": 4, "high": 3, "medium": 2, "low": 1, "informational": 0}
        grouped: dict[tuple[str, str], dict] = {}
        for a in alerts:
            if not isinstance(a, dict):
                continue
            title = str(a.get("title") or "").strip()
            risk = str(a.get("risk") or "low").strip().lower()
            if not title:
                continue
            key = (title, risk)
            if key not in grouped:
                grouped[key] = {
                    "title": title,
                    "risk": risk,
                    "confidence": a.get("confidence") or "",
                    "cwe": a.get("cwe") or "",
                    "method": a.get("method") or "",
                    "param": a.get("param") or "",
                    "sample_url": a.get("url") or "",
                    "evidence": str(a.get("evidence") or "")[:200],
                    "count": 1,
                }
            else:
                grouped[key]["count"] += 1
        ordered = sorted(
            grouped.values(),
            key=lambda g: (-risk_rank.get(g["risk"], 0), -g["count"], g["title"]),
        )
        lines = [f"Mode: {raw.get('mode', 'unknown')} | Unique alerts: {len(ordered)} (total instances: {len(alerts)})"]
        for g in ordered[:35]:
            meta = ", ".join(
                p
                for p in (
                    f"risk={g['risk']}",
                    f"instances={g['count']}",
                    f"cwe={g['cwe']}" if g["cwe"] else "",
                    f"param={g['param']}" if g["param"] else "",
                    f"url={g['sample_url']}" if g["sample_url"] else "",
                )
                if p
            )
            ev = f" | evidence={g['evidence']}" if g["evidence"] else ""
            lines.append(f"- {g['title']} ({meta}){ev}")
        return "\n".join(lines)[:PER_JOB_CONTEXT_CHARS]

    return raw_text[:PER_JOB_CONTEXT_CHARS]


def build_context(jobs: list[Job]) -> str:
    """One redaction-sized structured context block from every completed job."""
    sections = []
    for job in jobs:
        if job.status == JobStatus.completed and job.raw_output:
            sections.append(f"### tool: {job.tool}\n{_digest_job(job)}")
    return "\n\n".join(sections)


def note_failure(assessment: Assessment, detail: str) -> None:
    assessment.notes = (assessment.notes or "") + f" AI interpretation skipped: {detail}"
