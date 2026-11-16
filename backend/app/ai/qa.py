"""Finding Q&A (M2 T2.6 stretch): evidence-grounded analyst assistant.

Provides technical answers about a specific finding, grounded strictly in that
finding's metadata and attached evidence (HTTP transcripts, tool output, headers).
Extracts inline evidence citations ([Evidence #<id>]), reasoning traces,
and records an immutable audit row in ai_outputs.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import TYPE_CHECKING

from sqlalchemy.orm import Session

from app.ai import client as ai_client
from app.models import AIOutput, EvidenceKind, Finding, LLMTask

if TYPE_CHECKING:
    from app.schemas.findings import FindingQAMessage

MAX_EVIDENCE_CHARS = 4000
TEXT_EXTENSIONS = {".txt", ".log", ".json", ".xml", ".html", ".csv", ".http", ".env", ".cfg", ".conf"}
SYSTEM_PROMPT = """You are a senior web application security analyst reviewing an authorized security finding.
Your goal is to answer technical questions asked by the security assessor about this finding.

Rules:
1. Ground your answers strictly in the provided Finding Details and Attached Evidence items below.
2. When referencing specific evidence items, cite them explicitly using [Evidence #<id>] (e.g. [Evidence #12]).
3. Do not assume or extrapolate vulnerabilities or exploitability that the evidence does not support. If the evidence is insufficient to answer the question, state clearly what data is missing.
4. Provide actionable, standard-compliant remediation advice (e.g. Nginx, Apache, or application code) when asked.
5. Never suggest destructive testing or actions outside the authorized target scope.
6. Answer clearly and concisely using GitHub-flavored Markdown.
"""


def _load_evidence_text(evidence) -> str:
    """Returns text representation of an evidence item."""
    if evidence.content:
        content = evidence.content.strip()
        if len(content) > MAX_EVIDENCE_CHARS:
            content = content[:MAX_EVIDENCE_CHARS] + "\n...[truncated]"
        return content

    # For manual uploads, content may be empty; check file on disk
    if evidence.kind == EvidenceKind.upload and getattr(evidence, "file_path", None):
        file_path = Path(evidence.file_path)
        if file_path.is_file():
            if file_path.suffix.lower() in TEXT_EXTENSIONS:
                try:
                    text = file_path.read_text(encoding="utf-8", errors="replace").strip()
                    if len(text) > MAX_EVIDENCE_CHARS:
                        text = text[:MAX_EVIDENCE_CHARS] + "\n...[truncated]"
                    return text
                except OSError:
                    return f"[Error reading attached file: {file_path.name}]"
            return f"[Attached binary/image file: {file_path.name} ({file_path.stat().st_size} bytes)]"

    return "[No text content available]"


def _build_context(finding: Finding) -> str:
    """Assembles structured context from finding details and attached evidence."""
    lines = [
        "## Finding Details",
        f"- ID: {finding.id}",
        f"- Title: {finding.title}",
        f"- Category: {finding.category}",
        f"- Severity: {finding.severity.value if hasattr(finding.severity, 'value') else finding.severity}",
        f"- CVSS Score: {finding.score if finding.score is not None else 'N/A'}",
        f"- Status: {finding.status.value if hasattr(finding.status, 'value') else finding.status}",
        f"- Description: {finding.description or 'N/A'}",
        f"- Remediation: {finding.remediation or 'N/A'}",
    ]

    target = None
    if finding.assessment and finding.assessment.target:
        target = finding.assessment.target
        lines.extend([
            f"- Target Name: {target.name}",
            f"- Target Base URL: {target.base_url}",
        ])

    lines.append("\n## Attached Evidence")
    if not finding.evidence:
        lines.append("No technical evidence items are attached to this finding.")
    else:
        for ev in finding.evidence:
            ev_text = _load_evidence_text(ev)
            lines.append(f"\n### Evidence #{ev.id}: {ev.label} (Tool: {ev.tool or 'N/A'}, Kind: {ev.kind.value if hasattr(ev.kind, 'value') else ev.kind})")
            lines.append(f"```\n{ev_text}\n```")

    return "\n".join(lines)


def _build_messages(
    finding: Finding,
    question: str,
    history: list[FindingQAMessage] | None = None,
) -> list[dict[str, str]]:
    """Builds conversation messages for the LLM."""
    context_str = _build_context(finding)
    full_system = f"{SYSTEM_PROMPT}\n\n---\n\n{context_str}"

    messages = [{"role": "system", "content": full_system}]

    if history:
        for item in history[-6:]:  # Cap history to last 6 turns
            role = "user" if getattr(item, "role", "user") == "user" else "assistant"
            content = getattr(item, "content", "")
            if content:
                messages.append({"role": role, "content": content})

    messages.append({"role": "user", "content": question})
    return messages


def answer_finding_question(
    db: Session,
    finding: Finding,
    question: str,
    history: list[FindingQAMessage] | None = None,
    *,
    deny_list: list[str] | None = None,
    transport=None,
) -> dict:
    """Answers an analyst question grounded strictly in finding evidence.

    Returns:
        dict with keys: answer, reasoning, model, grounded_evidence_ids
    """
    messages = _build_messages(finding, question, history)
    result = ai_client.chat(
        db,
        LLMTask.qa,
        messages,
        deny_list=deny_list or [],
        transport=transport,
        max_tokens=2000,
        timeout=60.0,
    )

    answer = result.content or ""
    reasoning = result.reasoning_content or None

    # Parse cited evidence IDs: [Evidence #<id>]
    raw_citations = re.findall(r"\[Evidence #(\d+)\]", answer)
    available_ev_ids = {ev.id for ev in finding.evidence} if finding.evidence else set()
    grounded_ids = sorted({int(cid) for cid in raw_citations if int(cid) in available_ev_ids})

    # Save to ai_outputs for audit trail
    audit_payload = {
        "finding_id": finding.id,
        "question": question,
        "answer": answer,
        "reasoning": reasoning,
        "grounded_evidence_ids": grounded_ids,
    }
    audit_row = AIOutput(
        task=LLMTask.qa,
        assessment_id=finding.assessment_id,
        model=result.model,
        content=json.dumps(audit_payload),
    )
    db.add(audit_row)
    db.commit()

    return {
        "answer": answer,
        "reasoning": reasoning,
        "model": result.model,
        "grounded_evidence_ids": grounded_ids,
    }
