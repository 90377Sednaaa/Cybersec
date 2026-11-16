"""Report generation engine (M4 T4.4).

Pipeline: build_report_context() gathers assessment/target/findings/evidence
-> Jinja2 renders report.html -> Playwright headless Chromium prints the PDF
-> run_report_job() persists the outcome on the Report row.

Fail-soft like M1's runners: a missing browser or any render error marks the
report `failed` with an actionable message instead of crashing the API. The
AI summary (M2) is an optional context key - until M2 lands, the template
renders a clean placeholder.
"""

import base64
import json
import logging
import re
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import (
    AIOutput,
    Assessment,
    EvidenceKind,
    Finding,
    FindingStatus,
    Job,
    LLMTask,
    Report,
    ReportStatus,
    Severity,
    Target,
    User,
)
from app.models.user import utcnow
from app.risk import score_for

logger = logging.getLogger(__name__)

BACKEND_DIR = Path(__file__).resolve().parents[1]
REPORTS_DIR = BACKEND_DIR / "reports"  # generated PDFs (runtime artifacts, gitignored)
TEMPLATE_DIR = BACKEND_DIR / "app" / "templates"

SEVERITY_ORDER = (
    Severity.critical,
    Severity.high,
    Severity.medium,
    Severity.low,
    Severity.info,
)

_LOGO_CACHE: str | None = None

def get_logo_base64() -> str:
    global _LOGO_CACHE
    if _LOGO_CACHE is not None:
        return _LOGO_CACHE
    logo_file = BACKEND_DIR.parent / "frontend" / "src" / "assets" / "aletheia-logo.png"
    if logo_file.exists():
        try:
            b64 = base64.b64encode(logo_file.read_bytes()).decode("ascii")
            _LOGO_CACHE = f"data:image/png;base64,{b64}"
            return _LOGO_CACHE
        except Exception:
            pass
    _LOGO_CACHE = ""
    return _LOGO_CACHE

class ReportError(RuntimeError):
    """Raised when PDF generation cannot proceed; message must be actionable."""

def _latest_summary_row(db: Session, assessment_id: int) -> AIOutput | None:
    """The most recent assessment-level summary row (not a per-finding one)."""
    return db.scalar(
        select(AIOutput)
        .where(
            AIOutput.task == LLMTask.summary,
            AIOutput.assessment_id == assessment_id,
            AIOutput.finding_id.is_(None),
        )
        .order_by(AIOutput.id.desc())
    )


def latest_ai_summary(db: Session, assessment_id: int) -> str | None:
    """Read the stored executive summary. Read-only: never calls a provider."""
    row = _latest_summary_row(db, assessment_id)
    if row is None:
        return None
    try:
        payload = json.loads(row.content)
    except (TypeError, ValueError):
        return None
    text = payload.get("executive_summary") if isinstance(payload, dict) else None
    return text.strip() if isinstance(text, str) and text.strip() else None


def ensure_ai_summary(db: Session, assessment: Assessment) -> None:
    """Generate a summary when the cached one is missing or older than a verification.

    M2's `summarize_assessment` stores its output in `ai_outputs` and uses only
    VERIFIED findings. AI is optional: a missing provider, a rejected model or
    malformed output must never break a report, so every failure degrades to the
    template's "AI executive summary pending" placeholder.
    """
    # Imported lazily: app.ai.* pulls in the provider client, and reporting.py
    # is imported while the app factory is still assembling routers.
    from app.ai.summarize import summarize_assessment, verified_findings_for

    verified = verified_findings_for(db, assessment.id)
    if not verified:
        return

    cached = _latest_summary_row(db, assessment.id)
    if cached is not None:
        stamps = [f.verified_at for f in verified if f.verified_at is not None]
        latest = max(stamps) if stamps else None
        if latest is not None and latest.tzinfo is not None:
            # SQLite drops tzinfo on round-trip; AIOutput.created_at is naive.
            latest = latest.replace(tzinfo=None)
        if latest is None or cached.created_at >= latest:
            return

    try:
        summarize_assessment(db, assessment, verified)
    except Exception as exc:  # noqa: BLE001 - AI is optional, the report must render
        logger.warning("AI summary unavailable for assessment %s: %s", assessment.id, exc)
        db.rollback()


def build_report_context(db: Session, assessment: Assessment) -> dict:
    """Collect everything the template needs (no ORM objects cross the boundary)."""
    target = db.get(Target, assessment.target_id)

    # Deliberately uncapped: the PDF is the complete record for this assessment,
    # so its totals must match the API's authoritative X-Total-Count (proposal
    # 06) rather than whatever page of the list the UI happened to load.
    # selectinload(Finding.evidence): the row builder below reads f.evidence for
    # every finding, which was one SELECT per finding (F-34).
    findings = list(
        db.scalars(
            select(Finding)
            .where(Finding.assessment_id == assessment.id)
            .order_by(Finding.id)
            .options(selectinload(Finding.evidence))
        )
    )
    verifier_emails = {
        u.id: u.email for u in db.scalars(select(User)).all()
    }

    jobs = list(db.scalars(select(Job).where(Job.assessment_id == assessment.id).order_by(Job.id)))

    def finding_row(f: Finding) -> dict:
        evidence = [
            {
                "kind": e.kind.value,
                "label": e.label,
                "tool": e.tool,
                "excerpt": e.content[:400],
                "is_upload": e.kind == EvidenceKind.upload,
            }
            for e in f.evidence
        ]
        return {
            "id": f.id,
            "title": f.title,
            "category": f.category,
            "status": f.status.value,
            "severity": f.severity.value,
            # explicit assessor score, else the representative band value
            "score": f.score if f.score > 0 else score_for(f.severity),
            "description": f.description,
            "remediation": f.remediation,
            "assessor_notes": f.assessor_notes,
            "verified_by": verifier_emails.get(f.verified_by_id) if f.verified_by_id else None,
            "evidence": evidence,
        }

    by_severity: dict[Severity, list[dict]] = {tier: [] for tier in SEVERITY_ORDER}
    recommendations: list[str] = []
    for f in findings:
        by_severity[f.severity].append(finding_row(f))
        if f.remediation and f.remediation not in recommendations:
            recommendations.append(f.remediation)

    verified_count = sum(1 for f in findings if f.status == FindingStatus.verified)

    # Calculate overall security posture
    max_severity = Severity.info
    for tier in SEVERITY_ORDER:
        if by_severity[tier]:
            max_severity = tier
            break

    posture_meta = {
        Severity.critical: {
            "tier": "critical",
            "label": "CRITICAL RISK",
            "summary": "Urgent attention required. Critical vulnerabilities were identified that allow significant system compromise or high-impact data exposure.",
        },
        Severity.high: {
            "tier": "high",
            "label": "HIGH RISK",
            "summary": "Elevated risk profile. Direct exploitation vectors exist that could compromise critical application resources or user sessions.",
        },
        Severity.medium: {
            "tier": "medium",
            "label": "MODERATE RISK",
            "summary": "Moderate risk profile. Several security weaknesses were detected that should be addressed in upcoming scheduled maintenance.",
        },
        Severity.low: {
            "tier": "low",
            "label": "LOW RISK",
            "summary": "Low risk profile. Identified items primarily consist of security header configurations and defense-in-depth hardening.",
        },
        Severity.info: {
            "tier": "info",
            "label": "INFORMATIONAL",
            "summary": "Clean baseline. No actionable exploitable vulnerabilities were identified in the scoped evaluation.",
        },
    }
    overall_posture = posture_meta.get(max_severity, posture_meta[Severity.info])

    # Prioritized remediation roadmap
    roadmap = {
        "immediate": [],
        "short_term": [],
        "long_term": [],
    }
    for f in findings:
        item = {
            "id": f.id,
            "title": f.title,
            "severity": f.severity.value,
            "category": f.category,
            "remediation": f.remediation,
            "status": f.status.value,
        }
        if f.severity in (Severity.critical, Severity.high):
            roadmap["immediate"].append(item)
        elif f.severity == Severity.medium:
            roadmap["short_term"].append(item)
        else:
            roadmap["long_term"].append(item)

    return {
        "platform": "Aletheia - AI-Assisted Security Assessment Platform",
        "logo_base64": get_logo_base64(),
        "overall_posture": overall_posture,
        "roadmap": roadmap,
        "generated_at": utcnow(),
        "assessment": {
            "id": assessment.id,
            "intensity": assessment.intensity.value,
            "categories": assessment.categories,
            "status": assessment.status.value,
            "started_at": assessment.started_at,
            "finished_at": assessment.finished_at,
        },
        "target": {
            "name": target.name if target else "Unknown target",
            "base_url": target.base_url if target else "",
            "authorization_ref": target.authorization_ref if target else "",
            "allowed_intensity": target.allowed_intensity.value if target else "",
            "in_scope_assets": target.in_scope_assets if target else [],
            "out_of_scope_assets": target.out_of_scope_assets if target else [],
        },
        "jobs": [
            {"tool": j.tool, "status": j.status.value, "command": j.command} for j in jobs
        ],
        "severity_order": [t.value for t in SEVERITY_ORDER],
        "findings_by_severity": [
            (tier.value, by_severity[tier]) for tier in SEVERITY_ORDER if by_severity[tier]
        ],
        "counts": {t.value: len(by_severity[t]) for t in SEVERITY_ORDER},
        "verified_counts": {
            t.value: sum(1 for row in by_severity[t] if row["status"] == "verified")
            for t in SEVERITY_ORDER
        },
        "total_findings": len(findings),
        "verified_count": verified_count,
        "unverified_count": len(findings) - verified_count,
        "recommendations": recommendations,
        "ai_summary": latest_ai_summary(db, assessment.id),
    }

def render_report_html(db: Session, assessment: Assessment) -> str:
    """Render the Jinja2 template for one assessment."""
    env = Environment(
        loader=FileSystemLoader(TEMPLATE_DIR),
        autoescape=select_autoescape(["html"]),
    )
    template = env.get_template("report.html")
    return template.render(**build_report_context(db, assessment))

def generate_pdf_bytes(html: str) -> bytes:
    """Print HTML to PDF with headless Chromium (sync API; runs in a worker thread)."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as exc:
        raise ReportError(
            "Playwright is not installed - add it (backend/requirements.txt) and run "
            "'playwright install chromium' (PLAN.md section 11)"
        ) from exc
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            try:
                page = browser.new_page()
                page.set_content(html, wait_until="load")
                return page.pdf(
                    format="A4",
                    margin={"top": "18mm", "bottom": "18mm", "left": "16mm", "right": "16mm"},
                    print_background=True,
                )
            finally:
                browser.close()
    except ReportError:
        raise
    except Exception as exc:  # missing chromium executable, launch failures, ...
        raise ReportError(
            "PDF generation failed: "
            f"{exc}. If Chromium is missing, run 'playwright install chromium'."
        ) from exc

_ABS_PATH_RE = re.compile(
    r"(?:[A-Za-z]:[\\/]|\/(?:Users|home|tmp|var|usr|opt|root)\/)[^\s\"'<>]+"
)


def _safe_error(message: str) -> str:
    """Keep the actionable part of a worker error but drop absolute filesystem
    paths. This text is stored on the row, returned by the API and rendered in
    the report list, so local paths must not leak through it."""
    return _ABS_PATH_RE.sub("<path>", message)[:2000]


def run_report_job(report_id: int) -> None:
    """Background job: render, print, persist. Never raises - failures land on
    the row. The final commit is guarded too: when it raised (e.g. a locked DB)
    the row stayed `pending` forever, and `delete_report` refuses pending rows
    with 409, so the wedged report could never be removed."""
    from app.database import SessionLocal

    with SessionLocal() as db:
        report = db.get(Report, report_id)
        if report is None:
            return
        try:
            assessment = db.get(Assessment, report.assessment_id)
            if assessment is None:
                raise ReportError("Assessment no longer exists")
            # M2 T2.5: summarise verified findings before the template is
            # rendered, so the PDF carries the AI executive summary.
            ensure_ai_summary(db, assessment)
            html = render_report_html(db, assessment)
            pdf = generate_pdf_bytes(html)
            REPORTS_DIR.mkdir(parents=True, exist_ok=True)
            stored_name = f"report-{report.id}-{utcnow().strftime('%Y%m%d%H%M%S')}.pdf"
            (REPORTS_DIR / stored_name).write_bytes(pdf)
            report.file_path = stored_name
            report.status = ReportStatus.ready
            report.error = ""
        except ReportError as exc:
            report.status = ReportStatus.failed
            report.error = _safe_error(str(exc))
        except Exception as exc:  # defensive: a report job must never crash the API
            report.status = ReportStatus.failed
            report.error = _safe_error(f"Unexpected report failure: {exc}")
        report.finished_at = utcnow()
        try:
            db.commit()
        except Exception as exc:  # a failed commit must not wedge the row
            db.rollback()
            try:
                stale = db.get(Report, report_id)
                if stale is not None:
                    stale.status = ReportStatus.failed
                    stale.error = _safe_error(f"Report could not be saved: {exc}")
                    stale.finished_at = utcnow()
                    db.commit()
            except Exception:
                # DB is unavailable. The API's stale-pending recovery is the
                # backstop for a worker that died before it could write at all.
                pass
