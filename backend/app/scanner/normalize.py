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
import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.evidence_capture import capture_http_transcript
from app.models import Assessment, Evidence, EvidenceKind, Finding, FindingStatus, Job, JobStatus, Severity
from app.risk import score_for

ZAP_RISK_MAP = {
    "informational": Severity.info,
    "low": Severity.low,
    "medium": Severity.medium,
    "high": Severity.high,
    "critical": Severity.critical,
}

# High-signal exposed ports/services that warrant deterministic review even
# when no LLM provider is configured.
RISKY_PORTS: dict[int, tuple[str, Severity, str, str]] = {
    21: (
        "FTP",
        Severity.medium,
        "Exposed FTP service (port 21)",
        "Disable plaintext FTP or migrate to SFTP/FTPS and restrict access to trusted networks.",
    ),
    23: (
        "Telnet",
        Severity.high,
        "Exposed Telnet service (port 23)",
        "Disable Telnet immediately (credentials travel in cleartext) and use SSH with key authentication.",
    ),
    445: (
        "SMB",
        Severity.high,
        "Exposed SMB service (port 445)",
        "Block SMB from untrusted networks at the firewall and disable SMBv1.",
    ),
    3306: (
        "MySQL",
        Severity.high,
        "Exposed MySQL database port (3306)",
        "Bind MySQL to localhost or an internal VPC interface and require TLS + least-privilege credentials.",
    ),
    3389: (
        "RDP",
        Severity.medium,
        "Exposed Remote Desktop service (port 3389)",
        "Place RDP behind a VPN/bastion with MFA rather than exposing port 3389 directly.",
    ),
    5432: (
        "PostgreSQL",
        Severity.high,
        "Exposed PostgreSQL database port (5432)",
        "Restrict PostgreSQL listen_addresses/pg_hba.conf to application hosts and require TLS.",
    ),
    6379: (
        "Redis",
        Severity.high,
        "Exposed Redis port (6379)",
        "Bind Redis to loopback/private networks, enable ACL/AUTH, and disable dangerous commands.",
    ),
    9200: (
        "Elasticsearch",
        Severity.high,
        "Exposed Elasticsearch HTTP port (9200)",
        "Restrict Elasticsearch port 9200 to internal networks and enforce authentication and TLS.",
    ),
    11211: (
        "Memcached",
        Severity.high,
        "Exposed Memcached port (11211)",
        "Bind Memcached to localhost/internal interfaces; exposed instances leak cached data and enable amplification.",
    ),
    27017: (
        "MongoDB",
        Severity.high,
        "Exposed MongoDB database port (27017)",
        "Restrict MongoDB to private networks and enforce authentication and TLS.",
    ),
}


def normalize_title_key(title: str) -> str:
    """Canonical dedup key: case-insensitive, collapsed whitespace, strips leading 'AI:'."""
    cleaned = re.sub(r"^ai:\s*", "", (title or "").strip(), flags=re.IGNORECASE)
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned.lower()


def _title_taken(db: Session, assessment_id: int, title: str) -> bool:
    target_key = normalize_title_key(title)
    if not target_key:
        return True
    existing = db.scalars(select(Finding.title).where(Finding.assessment_id == assessment_id))
    return any(normalize_title_key(existing_title) == target_key for existing_title in existing)


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
    effective_score = score if score > 0.0 else score_for(severity)
    finding = Finding(
        assessment_id=assessment.id,
        source_job_id=job.id,
        category=category,
        title=title,
        description=description,
        severity=severity,
        score=effective_score,
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
    # M4's helper (evidence_capture.py, wiring handed to M1): attach the readable
    # request/response transcript for prober findings. Idempotent per
    # (finding, job), so normalizer retries and AI interpretation - which calls
    # create_candidate again - cannot pile up duplicates.
    capture_http_transcript(db, finding, job)
    return finding


def _format_zap_evidence(alert: dict) -> str:
    parts: list[str] = []
    method = alert.get("method") or ""
    url = alert.get("url") or ""
    if url:
        parts.append(f"Target: {f'{method} ' if method else ''}{url}")
    if alert.get("param"):
        parts.append(f"Parameter: {alert['param']}")
    if alert.get("attack"):
        parts.append(f"Attack: {alert['attack']}")
    if alert.get("cwe"):
        parts.append(f"CWE: CWE-{alert['cwe']}")
    if alert.get("evidence"):
        parts.append(f"Evidence:\n{alert['evidence']}")
    return "\n".join(parts)


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
        fallback_headers = json.dumps(raw.get("headers", {}), indent=2)
        for c in raw.get("candidate_findings", []):
            title = c["title"]
            description = (c.get("description") or "").strip() or title
            evidence = (c.get("evidence") or "").strip() or fallback_headers
            finding = create_candidate(
                db,
                assessment,
                job,
                category=c.get("category", "Security configuration & HTTPS"),
                title=title,
                description=description,
                severity=Severity(c.get("severity", "low")),
                remediation=c.get("remediation", ""),
                evidence_content=evidence,
            )
            created += 1 if finding else 0

    if job.tool == "nmap":
        for host in raw.get("hosts", []):
            addr = host.get("address") or host.get("hostname") or "target"
            for port_info in host.get("open_ports", []):
                port_num = int(port_info.get("port", 0))
                rule = RISKY_PORTS.get(port_num)
                if not rule:
                    continue
                service_label, severity, title, remediation = rule
                product = " ".join(
                    p for p in (port_info.get("product"), port_info.get("version"), port_info.get("extrainfo")) if p
                )
                service_detail = f" ({product})" if product else ""
                evidence = (
                    f"Host: {addr}\n"
                    f"Port: {port_num}/{port_info.get('protocol', 'tcp')} open\n"
                    f"Service: {port_info.get('service') or service_label}{service_detail}"
                )
                finding = create_candidate(
                    db,
                    assessment,
                    job,
                    category="Security configuration & HTTPS",
                    title=title,
                    description=(
                        f"Nmap detected an open {service_label} service on {addr}:{port_num}{service_detail}. "
                        "Exposing administrative, database, or cleartext services expands the attack surface."
                    ),
                    severity=severity,
                    remediation=remediation,
                    evidence_content=evidence,
                )
                created += 1 if finding else 0

    if job.tool == "zap":
        from app.scanner.zap_runner import zap_category

        for a in raw.get("alerts", []):
            if not a.get("title"):
                continue
            severity = ZAP_RISK_MAP.get(str(a.get("risk", "low")).lower(), Severity.low)
            finding = create_candidate(
                db,
                assessment,
                job,
                category=zap_category(a["title"]),
                title=a["title"],
                description=(a.get("description") or "")[:1500] or a["title"],
                severity=severity,
                remediation=a.get("solution", ""),
                evidence_content=_format_zap_evidence(a) or str(a.get("evidence", "")),
            )
            created += 1 if finding else 0

    db.commit()
    return created


def normalize_assessment(db: Session, assessment: Assessment, jobs: list[Job]) -> int:
    total = 0
    for job in jobs:
        if job.status == JobStatus.completed:
            total += normalize_job(db, assessment, job)
    return total
