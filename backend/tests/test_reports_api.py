"""M4 T4.4: report generation - job lifecycle, template content, download.

The full stack (Jinja2 render + Playwright Chromium) runs in these tests when
Chromium is installed; if it is not, the lifecycle test asserts the graceful
`failed` path instead. Assertions branch on the observed row state, so the
suite is green either way and honest about which path ran.
"""

from datetime import datetime, timedelta, timezone

from app.database import SessionLocal
from app.models import (
    Assessment,
    AssessmentStatus,
    Evidence,
    EvidenceKind,
    Finding,
    FindingStatus,
    Report,
    ReportStatus,
    ScanIntensity,
    Severity,
)
from app.reporting import REPORTS_DIR, build_report_context, render_report_html
from app.schemas.findings import ReportOut

def _seed_assessment(client, auth: dict[str, str]) -> int:
    """Target via the API + a completed assessment with findings and evidence."""
    target = client.post(
        "/api/targets",
        json={
            "name": "Juice Shop",
            "base_url": "http://localhost:3000",
            "authorization_ref": "TEST-AUTH-003",
            "allowed_intensity": "passive_safe",
            "in_scope_assets": ["http://localhost:3000"],
        },
        headers=auth,
    ).json()

    with SessionLocal() as db:
        assessment = Assessment(
            target_id=target["id"],
            intensity=ScanIntensity.passive_safe,
            categories=["Security configuration & HTTPS", "Exposed files & directories"],
            status=AssessmentStatus.completed,
        )
        db.add(assessment)
        db.flush()
        assessment_id = assessment.id

        csp = Finding(
            assessment_id=assessment_id,
            category="Security configuration & HTTPS",
            title="Missing Content-Security-Policy",
            description="No CSP header was returned.",
            severity=Severity.high,
            status=FindingStatus.ai_candidate,
            ai_confidence=1.0,
            remediation="Serve a Content-Security-Policy header.",
            assessor_notes="Checked manually - the header is genuinely absent on every route.",
        )
        backup = Finding(
            assessment_id=assessment_id,
            category="Exposed files & directories",
            title="Backup archive exposed",
            description="/backup.zip is reachable.",
            severity=Severity.critical,
            status=FindingStatus.ai_candidate,
            ai_confidence=1.0,
            remediation="Remove the backup from the web root and block archive extensions.",
        )
        db.add_all([csp, backup])
        db.flush()
        db.add(
            Evidence(
                finding_id=csp.id,
                kind=EvidenceKind.tool_output,
                label="Output of prober job #1",
                content="content-security-policy: missing",
                tool="prober",
            )
        )
        db.commit()
    return assessment_id

def _verify_one(client, auth: dict[str, str], assessment_id: int) -> None:
    finding = [
        f for f in client.get("/api/findings", headers=auth).json()
        if f["assessment_id"] == assessment_id and f["title"] == "Missing Content-Security-Policy"
    ][0]
    resp = client.patch(f"/api/findings/{finding['id']}", json={"status": "verified"}, headers=auth)
    assert resp.status_code == 200

# --- lifecycle -----------------------------------------------------------------

def test_report_lifecycle_and_download(client, auth):
    assessment_id = _seed_assessment(client, auth)
    _verify_one(client, auth, assessment_id)

    resp = client.post(f"/api/assessments/{assessment_id}/report", headers=auth)
    assert resp.status_code == 202, resp.text
    body = resp.json()
    assert set(body) == set(ReportOut.model_fields)  # frozen ReportOut shape
    assert body["status"] == "pending"  # 202 returns before the job flips the row

    # BackgroundTasks run after the response inside TestClient, so the row is
    # already settled here - no sleeps, deterministic.
    with SessionLocal() as db:
        row = db.get(Report, body["id"])
        assert row is not None
        assert row.status in (ReportStatus.ready, ReportStatus.failed)
        assert row.finished_at is not None
        if row.status == ReportStatus.failed:
            assert "playwright" in row.error.lower() or "chromium" in row.error.lower()

    listed = client.get(f"/api/assessments/{assessment_id}/reports", headers=auth).json()
    assert [r["id"] for r in listed] == [body["id"]]

    if row.status == ReportStatus.ready:
        pdf = client.get(f"/api/reports/{body['id']}", headers=auth)
        assert pdf.status_code == 200
        assert pdf.headers["content-type"] == "application/pdf"
        assert pdf.content.startswith(b"%PDF-")
        assert len(pdf.content) > 10_000  # a multi-section report, not a blank page
        assert "attachment" in pdf.headers["content-disposition"]
    else:
        block = client.get(f"/api/reports/{body['id']}", headers=auth)
        assert block.status_code == 409  # failed rows cannot download

def test_report_never_blocks_the_api_on_chromium_absence(client, auth, monkeypatch, tmp_path):
    """The failure path is exercised even where Chromium exists, by pointing
    Playwright at an impossible browser path - the API must still answer 202."""
    assessment_id = _seed_assessment(client, auth)
    monkeypatch.setattr("app.reporting.REPORTS_DIR", tmp_path)
    monkeypatch.setenv("PLAYWRIGHT_BROWSERS_PATH", str(tmp_path / "no-browsers-here"))

    resp = client.post(f"/api/assessments/{assessment_id}/report", headers=auth)
    assert resp.status_code == 202

    with SessionLocal() as db:
        report = db.query(Report).filter_by(assessment_id=assessment_id).order_by(Report.id.desc()).first()
        assert report is not None
        assert report.status == ReportStatus.failed
        assert report.error  # actionable message recorded on the row

# --- template / context content -------------------------------------------------

def test_report_context_groups_and_scores(client, auth):
    assessment_id = _seed_assessment(client, auth)
    _verify_one(client, auth, assessment_id)
    with SessionLocal() as db:
        assessment = db.get(Assessment, assessment_id)
        ctx = build_report_context(db, assessment)
    assert ctx["counts"]["high"] == 1 and ctx["counts"]["critical"] == 1
    assert ctx["verified_count"] == 1 and ctx["total_findings"] == 2
    assert [tier for tier, rows in ctx["findings_by_severity"]] == ["critical", "high"]
    # explicit score 0 falls back to the representative band value (high -> 8.0)
    high_row = ctx["findings_by_severity"][1][1][0]
    assert high_row["score"] == 8.0
    assert high_row["verified_by"] == "admin@example.com"
    assert high_row["evidence"][0]["kind"] == "tool_output"

def test_report_html_sections_render(client, auth):
    assessment_id = _seed_assessment(client, auth)
    _verify_one(client, auth, assessment_id)
    with SessionLocal() as db:
        html = render_report_html(db, db.get(Assessment, assessment_id))
    for marker in (
        "Security Assessment Report",
        "Juice Shop",
        "Missing Content-Security-Policy",
        "Backup archive exposed",
        "OWASP Risk Rating Methodology",
        "verified by an assessor",
        "Serve a Content-Security-Policy header",
        "AI executive summary pending",  # M2 placeholder while M2 is not wired
        "Assessor notes",  # not set here -> placeholder sections still valid
    ):
        assert marker in html, f"report HTML missing: {marker}"
    # evidence excerpt made it into the rendered report
    assert "content-security-policy: missing" in html

def test_verified_finding_shows_attribution_in_html(client, auth):
    assessment_id = _seed_assessment(client, auth)
    _verify_one(client, auth, assessment_id)
    with SessionLocal() as db:
        html = render_report_html(db, db.get(Assessment, assessment_id))
    assert "Verified by admin@example.com" in html

# --- guards ---------------------------------------------------------------------

def test_create_report_viewer_403(client, auth):
    assessment_id = _seed_assessment(client, auth)
    client.post(
        "/api/users",
        json={"email": "viewer-reports@example.com", "password": "viewerpw123", "role": "viewer"},
        headers=auth,
    )
    token = client.post(
        "/api/auth/login",
        data={"username": "viewer-reports@example.com", "password": "viewerpw123"},
    ).json()["access_token"]
    resp = client.post(
        f"/api/assessments/{assessment_id}/report",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403

def test_create_report_unknown_assessment_404(client, auth):
    assert client.post("/api/assessments/99999/report", headers=auth).status_code == 404

def test_reports_list_unknown_assessment_404(client, auth):
    assert client.get("/api/assessments/99999/reports", headers=auth).status_code == 404

def test_download_unknown_report_404(client, auth):
    assert client.get("/api/reports/99999", headers=auth).status_code == 404

# --- deletion --------------------------------------------------------------------

def _seed_report(assessment_id: int, *, status: ReportStatus, stored_name: str = "", pdf: bytes | None = None) -> int:
    """Create a report row directly, so the test never depends on Chromium."""
    with SessionLocal() as db:
        report = Report(assessment_id=assessment_id, status=status, file_path=stored_name)
        db.add(report)
        db.commit()
        db.refresh(report)
        report_id = report.id
    if stored_name and pdf is not None:
        REPORTS_DIR.mkdir(parents=True, exist_ok=True)
        (REPORTS_DIR / stored_name).write_bytes(pdf)
    return report_id


def test_delete_ready_report_removes_row_and_pdf(client, auth):
    assessment_id = _seed_assessment(client, auth)
    report_id = _seed_report(
        assessment_id, status=ReportStatus.ready, stored_name="delete-me-test.pdf", pdf=b"%PDF-1.4 fake"
    )
    pdf_path = REPORTS_DIR / "delete-me-test.pdf"
    assert pdf_path.is_file()

    resp = client.delete(f"/api/reports/{report_id}", headers=auth)
    assert resp.status_code == 204, resp.text

    with SessionLocal() as db:
        assert db.get(Report, report_id) is None
    assert not pdf_path.exists()  # the PDF is cleaned up, not orphaned on disk
    listed = client.get(f"/api/assessments/{assessment_id}/reports", headers=auth).json()
    assert report_id not in [r["id"] for r in listed]


def test_delete_pending_report_is_refused(client, auth):
    """The background job still owns a pending row; deleting it would break the job."""
    assessment_id = _seed_assessment(client, auth)
    report_id = _seed_report(assessment_id, status=ReportStatus.pending)

    resp = client.delete(f"/api/reports/{report_id}", headers=auth)
    assert resp.status_code == 409, resp.text
    with SessionLocal() as db:
        assert db.get(Report, report_id) is not None


def test_delete_report_outside_reports_dir_keeps_the_file(client, auth, tmp_path):
    """A tampered file_path must never unlink anything outside the reports folder."""
    assessment_id = _seed_assessment(client, auth)
    outside = tmp_path / "keep-me.txt"
    outside.write_text("important", encoding="utf-8")
    report_id = _seed_report(assessment_id, status=ReportStatus.ready, stored_name="../../keep-me.txt")

    resp = client.delete(f"/api/reports/{report_id}", headers=auth)
    assert resp.status_code == 204, resp.text
    assert outside.is_file()  # row is gone, but the outside file survives


def test_delete_report_unknown_404(client, auth):
    assert client.delete("/api/reports/99999", headers=auth).status_code == 404


# --- Wave 1 regression: F-30 (duplicate report jobs) ----------------------------

def test_duplicate_report_requests_return_same_pending_row(client, auth, monkeypatch):
    """Two fast clicks must not enqueue two Chromium renders. The second POST
    returns the SAME pending row with the same 202 - additive, no new status."""
    import app.api.reports as reports_api

    monkeypatch.setattr(reports_api, "run_report_job", lambda _report_id: None)
    assessment_id = _seed_assessment(client, auth)

    first = client.post(f"/api/assessments/{assessment_id}/report", headers=auth)
    second = client.post(f"/api/assessments/{assessment_id}/report", headers=auth)
    assert first.status_code == 202 and second.status_code == 202
    assert first.json()["id"] == second.json()["id"]

    listed = client.get(f"/api/assessments/{assessment_id}/reports", headers=auth).json()
    assert len(listed) == 1


def test_stale_pending_does_not_block_a_new_report(client, auth, monkeypatch):
    """A wedged pending row must not make report generation permanently
    unavailable; it settles to failed and a fresh row is created."""
    import app.api.reports as reports_api

    monkeypatch.setattr(reports_api, "run_report_job", lambda _report_id: None)
    assessment_id = _seed_assessment(client, auth)
    stale_id = _seed_report(assessment_id, status=ReportStatus.pending)
    _backdate_pending(stale_id)

    resp = client.post(f"/api/assessments/{assessment_id}/report", headers=auth)
    assert resp.status_code == 202
    assert resp.json()["id"] != stale_id
    with SessionLocal() as db:
        assert db.get(Report, stale_id).status == ReportStatus.failed


# --- Wave 0 regressions: F-29 (pending wedge), F-33 (error reflection) ---------

def _backdate_pending(report_id: int) -> None:
    with SessionLocal() as db:
        row = db.get(Report, report_id)
        row.created_at = datetime.now(timezone.utc) - timedelta(hours=1)
        db.commit()


def test_report_job_commit_failure_marks_row_failed(client, auth, monkeypatch, tmp_path):
    """F-29: db.commit() used to sit outside the try. When it raised (locked DB)
    the row stayed `pending` forever, and delete_report refuses pending rows."""
    from app import database
    from app import reporting

    assessment_id = _seed_assessment(client, auth)
    report_id = _seed_report(assessment_id, status=ReportStatus.pending)

    real_factory = database.SessionLocal
    monkeypatch.setattr(reporting, "REPORTS_DIR", tmp_path)
    monkeypatch.setattr(reporting, "generate_pdf_bytes", lambda _html: b"%PDF-1.4 fake")

    def flaky_session():
        session = real_factory()
        original, state = session.commit, {"raised": False}

        def commit():
            if not state["raised"]:
                state["raised"] = True
                raise RuntimeError("database is locked")
            return original()

        monkeypatch.setattr(session, "commit", commit)
        return session

    monkeypatch.setattr(database, "SessionLocal", flaky_session)
    reporting.run_report_job(report_id)
    # Restore real sessions before the API call below, otherwise the delete
    # endpoint would inherit the deliberately flaky commit too.
    monkeypatch.undo()

    with real_factory() as db:
        row = db.get(Report, report_id)
        assert row.status == ReportStatus.failed
        assert row.finished_at is not None
        assert "could not be saved" in row.error
    # A failed (not pending) row is now deletable.
    assert client.delete(f"/api/reports/{report_id}", headers=auth).status_code == 204


def test_stale_pending_report_settles_on_list(client, auth):
    """F-29 backstop: a worker that died before writing anything leaves a row
    the UI would poll forever. Listing ages it out to failed."""
    assessment_id = _seed_assessment(client, auth)
    report_id = _seed_report(assessment_id, status=ReportStatus.pending)
    _backdate_pending(report_id)

    listed = client.get(f"/api/assessments/{assessment_id}/reports", headers=auth).json()
    row = [r for r in listed if r["id"] == report_id][0]
    assert row["status"] == "failed"
    assert row["finished_at"] is not None


def test_delete_stale_pending_without_listing(client, auth):
    assessment_id = _seed_assessment(client, auth)
    report_id = _seed_report(assessment_id, status=ReportStatus.pending)
    _backdate_pending(report_id)
    assert client.delete(f"/api/reports/{report_id}", headers=auth).status_code == 204


def test_safe_error_strips_absolute_paths():
    from app.reporting import _safe_error

    cleaned = _safe_error(r"failed at C:\Users\PC\app\chrome.exe and /home/runner/browser")
    assert r"C:\Users" not in cleaned
    assert "/home/runner" not in cleaned
    assert "<path>" in cleaned


def test_failed_report_download_does_not_reflect_internal_error(client, auth):
    """F-33: the download 409 used to echo the raw Playwright error, including
    local filesystem paths. The detail now stays on the row for the UI toggle."""
    assessment_id = _seed_assessment(client, auth)
    report_id = _seed_report(assessment_id, status=ReportStatus.failed)
    with SessionLocal() as db:
        row = db.get(Report, report_id)
        row.error = r"PDF generation failed: C:\Users\PC\AppData\chrome.exe missing"
        db.commit()

    resp = client.get(f"/api/reports/{report_id}", headers=auth)
    assert resp.status_code == 409
    assert "AppData" not in resp.text
    assert "C:" not in resp.text
    assert "report list" in resp.text


def test_delete_report_viewer_403(client, auth):
    assessment_id = _seed_assessment(client, auth)
    report_id = _seed_report(assessment_id, status=ReportStatus.ready, stored_name="viewer-guard-test.pdf", pdf=b"%PDF-1.4 x")
    client.post(
        "/api/users",
        json={"email": "viewer-delete-reports@example.com", "password": "viewerpw123", "role": "viewer"},
        headers=auth,
    )
    token = client.post(
        "/api/auth/login",
        data={"username": "viewer-delete-reports@example.com", "password": "viewerpw123"},
    ).json()["access_token"]

    resp = client.delete(f"/api/reports/{report_id}", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403
    with SessionLocal() as db:
        assert db.get(Report, report_id) is not None


# --- Wave 4 regression: F-40 (index), F-31 (one total for UI and PDF) -------------


def test_report_insert_race_returns_the_winner(client, auth, monkeypatch):
    """F-40: the pending pre-check is not atomic. When a competing request
    inserts first, the unique index rejects this insert; the endpoint must
    answer with the winner's row and the same 202, not a 500."""
    from app.api import reports as reports_api

    assessment_id = _seed_assessment(client, auth)
    existing_id = _seed_report(assessment_id, status=ReportStatus.pending)

    # Simulate the lost race: this request's pre-check ran before the winner
    # committed, so it sees nothing.
    monkeypatch.setattr(reports_api, "_live_pending", lambda _db, _aid: [])

    resp = client.post(f"/api/assessments/{assessment_id}/report", headers=auth)
    assert resp.status_code == 202, resp.text
    assert resp.json()["id"] == existing_id
    with SessionLocal() as db:
        pending = [
            row
            for row in db.query(Report).filter(
                Report.assessment_id == assessment_id,
                Report.status == ReportStatus.pending,
            )
        ]
        assert len(pending) == 1


def test_report_total_matches_the_findings_api_total(client, auth):
    """F-31: the PDF context loads every finding uncapped, and the API reports
    the same authoritative count while its default page stays at 200."""
    assessment_id = _seed_assessment(client, auth)  # seeds 2 findings
    with SessionLocal() as db:
        db.add_all(
            [
                Finding(
                    assessment_id=assessment_id,
                    category="Input validation & injection",
                    title=f"Bulk finding {index}",
                    description="synthetic",
                    severity=Severity.low,
                    status=FindingStatus.ai_candidate,
                )
                for index in range(203)
            ]
        )
        db.commit()

    try:
        full = client.get(f"/api/findings?assessment_id={assessment_id}&limit=500", headers=auth)
        assert len(full.json()) == 205
        assert full.headers["x-total-count"] == "205"

        capped = client.get(f"/api/findings?assessment_id={assessment_id}", headers=auth)
        assert len(capped.json()) == 200  # unchanged default page
        assert capped.headers["x-total-count"] == "205"

        with SessionLocal() as db:
            context = build_report_context(db, db.get(Assessment, assessment_id))
        assert context["total_findings"] == 205
        assert sum(context["counts"].values()) == 205
    finally:
        with SessionLocal() as db:
            db.query(Finding).filter(Finding.assessment_id == assessment_id).delete()
            db.commit()
