"""Report generation engine (M4 T4.4).

Pipeline: build_report_context() gathers assessment/target/findings/evidence
-> Jinja2 renders report.html -> Playwright headless Chromium prints the PDF
-> run_report_job() persists the outcome on the Report row.

Fail-soft like M1's runners: a missing browser or any render error marks the
report `failed` with an actionable message instead of crashing the API. The
AI summary (M2) is an optional context key - until M2 lands, the template
renders a clean placeholder.
"""

from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    Assessment,
    EvidenceKind,
    Finding,
    FindingStatus,
    Job,
    Report,
    ReportStatus,
    Severity,
    Target,
    User,
)
from app.models.user import utcnow
from app.risk import score_for

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

class ReportError(RuntimeError):
    """Raised when PDF generation cannot proceed; message must be actionable."""

def build_report_context(db: Session, assessment: Assessment) -> dict:
    """Collect everything the template needs (no ORM objects cross the boundary)."""
    target = db.get(Target, assessment.target_id)

    findings = list(
        db.scalars(select(Finding).where(Finding.assessment_id == assessment.id).order_by(Finding.id))
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
    return {
        "platform": "Aletheia - AI-Assisted Security Assessment Platform",
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
        "ai_summary": None,  # M2 summarizer output renders here once available
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
            f"PDF generation failed: {exc}. If Chromium is missing, run 'playwright install chromium'."
        ) from exc

def run_report_job(report_id: int) -> None:
    """Background job: render, print, persist. Never raises - failures land on the row."""
    from app.database import SessionLocal

    with SessionLocal() as db:
        report = db.get(Report, report_id)
        if report is None:
            return
        assessment = db.get(Assessment, report.assessment_id)
        if assessment is None:
            report.status = ReportStatus.failed
            report.error = "Assessment no longer exists"
            report.finished_at = utcnow()
            db.commit()
            return
        try:
            html = render_report_html(db, assessment)
            pdf = generate_pdf_bytes(html)
            REPORTS_DIR.mkdir(parents=True, exist_ok=True)
            stored_name = f"report-{report.id}-{utcnow().strftime('%Y%m%d%H%M%S')}.pdf"
            (REPORTS_DIR / stored_name).write_bytes(pdf)
            report.file_path = stored_name
            report.status = ReportStatus.ready
        except ReportError as exc:
            report.status = ReportStatus.failed
            report.error = str(exc)[:2000]
        except Exception as exc:  # defensive: a report job must never crash the API
            report.status = ReportStatus.failed
            report.error = f"Unexpected report failure: {exc}"[:2000]
        report.finished_at = utcnow()
        db.commit()
