"""M4 T4.2: evidence API — upload rules, safe download, auto-capture helper.

Uploads in tests are redirected to a tmp dir via monkeypatching
app.api.evidence.EVIDENCE_DIR so the repo tree stays clean.
"""

from app.api import evidence as evidence_api
from app.database import SessionLocal
from app.models import (
    Evidence,
    EvidenceKind,
    Finding,
    FindingStatus,
    Job,
    Severity,
)
from app.evidence_capture import capture_http_transcript

def _add_finding() -> int:
    with SessionLocal() as db:
        finding = Finding(
            category="Exposed files & directories",
            title="Backup archive exposed",
            description="/backup.zip is reachable.",
            severity=Severity.high,
            status=FindingStatus.ai_candidate,
            ai_confidence=1.0,
        )
        db.add(finding)
        db.commit()
        return finding.id

def _add_job(raw_output: str, tool: str = "prober") -> int:
    with SessionLocal() as db:
        job = Job(tool=tool, status="completed", raw_output=raw_output)
        db.add(job)
        db.commit()
        return job.id

def _viewer_auth(client, auth: dict[str, str]) -> dict[str, str]:
    client.post(
        "/api/users",
        json={"email": "viewer@example.com", "password": "viewerpw123", "role": "viewer"},
        headers=auth,
    )
    token = client.post(
        "/api/auth/login",
        data={"username": "viewer@example.com", "password": "viewerpw123"},
    ).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}

# --- upload ------------------------------------------------------------------

def test_upload_round_trip(client, auth, tmp_path, monkeypatch):
    monkeypatch.setattr(evidence_api, "EVIDENCE_DIR", tmp_path)
    finding_id = _add_finding()
    resp = client.post(
        f"/api/findings/{finding_id}/evidence",
        files={"file": ("screenshot.png", b"\x89PNG fake bytes", "image/png")},
        headers=auth,
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["kind"] == "upload"
    assert body["label"] == "screenshot.png"
    assert "file_path" not in body  # stored paths never leak through the API

    stored = list(tmp_path.iterdir())
    assert len(stored) == 1
    assert stored[0].suffix == ".png"
    assert stored[0].read_bytes() == b"\x89PNG fake bytes"
    with SessionLocal() as db:
        row = db.get(Evidence, body["id"])
        assert row is not None and row.file_path == stored[0].name

def test_upload_over_5mb_413(client, auth, tmp_path, monkeypatch):
    monkeypatch.setattr(evidence_api, "EVIDENCE_DIR", tmp_path)
    finding_id = _add_finding()
    big = b"x" * (5 * 1024 * 1024 + 1)
    resp = client.post(
        f"/api/findings/{finding_id}/evidence",
        files={"file": ("big.log", big, "text/plain")},
        headers=auth,
    )
    assert resp.status_code == 413
    assert list(tmp_path.iterdir()) == []  # rejected file is never written

def test_upload_exactly_5mb_accepted(client, auth, tmp_path, monkeypatch):
    monkeypatch.setattr(evidence_api, "EVIDENCE_DIR", tmp_path)
    finding_id = _add_finding()
    resp = client.post(
        f"/api/findings/{finding_id}/evidence",
        files={"file": ("exact.log", b"x" * (5 * 1024 * 1024), "text/plain")},
        headers=auth,
    )
    assert resp.status_code == 201

def test_upload_disallowed_extension_415(client, auth, tmp_path, monkeypatch):
    monkeypatch.setattr(evidence_api, "EVIDENCE_DIR", tmp_path)
    finding_id = _add_finding()
    resp = client.post(
        f"/api/findings/{finding_id}/evidence",
        files={"file": ("shell.exe", b"MZ...", "application/octet-stream")},
        headers=auth,
    )
    assert resp.status_code == 415
    assert list(tmp_path.iterdir()) == []

def test_upload_no_extension_415(client, auth, tmp_path, monkeypatch):
    monkeypatch.setattr(evidence_api, "EVIDENCE_DIR", tmp_path)
    finding_id = _add_finding()
    resp = client.post(
        f"/api/findings/{finding_id}/evidence",
        files={"file": ("README", b"data", "text/plain")},
        headers=auth,
    )
    assert resp.status_code == 415

def test_upload_viewer_403(client, auth, tmp_path, monkeypatch):
    monkeypatch.setattr(evidence_api, "EVIDENCE_DIR", tmp_path)
    finding_id = _add_finding()
    viewer = _viewer_auth(client, auth)
    resp = client.post(
        f"/api/findings/{finding_id}/evidence",
        files={"file": ("note.txt", b"viewer try", "text/plain")},
        headers=viewer,
    )
    assert resp.status_code == 403

def test_upload_unknown_finding_404(client, auth, tmp_path, monkeypatch):
    monkeypatch.setattr(evidence_api, "EVIDENCE_DIR", tmp_path)
    resp = client.post(
        "/api/findings/99999/evidence",
        files={"file": ("note.txt", b"data", "text/plain")},
        headers=auth,
    )
    assert resp.status_code == 404

# --- list & download ---------------------------------------------------------

def test_list_evidence_mixes_auto_and_manual(client, auth, tmp_path, monkeypatch):
    monkeypatch.setattr(evidence_api, "EVIDENCE_DIR", tmp_path)
    finding_id = _add_finding()
    with SessionLocal() as db:
        db.add(
            Evidence(
                finding_id=finding_id,
                kind=EvidenceKind.tool_output,
                label="Output of prober job #1",
                content="prober headers...",
                tool="prober",
            )
        )
        db.commit()
    client.post(
        f"/api/findings/{finding_id}/evidence",
        files={"file": ("shot.png", b"png", "image/png")},
        headers=auth,
    )
    resp = client.get(f"/api/findings/{finding_id}/evidence", headers=auth)
    assert resp.status_code == 200
    kinds = [e["kind"] for e in resp.json()]
    assert kinds == ["tool_output", "upload"]

def test_download_round_trip(client, auth, tmp_path, monkeypatch):
    monkeypatch.setattr(evidence_api, "EVIDENCE_DIR", tmp_path)
    finding_id = _add_finding()
    payload = b"evidence bytes 123"
    evidence_id = client.post(
        f"/api/findings/{finding_id}/evidence",
        files={"file": ("capture.log", payload, "text/plain")},
        headers=auth,
    ).json()["id"]

    resp = client.get(f"/api/evidence/{evidence_id}/download", headers=auth)
    assert resp.status_code == 200
    assert resp.content == payload
    assert resp.headers["content-type"] == "application/octet-stream"
    assert "attachment" in resp.headers["content-disposition"]
    assert "capture.log" in resp.headers["content-disposition"]

def test_download_inline_evidence_404(client, auth):
    finding_id = _add_finding()
    with SessionLocal() as db:
        row = Evidence(
            finding_id=finding_id, kind=EvidenceKind.tool_output, label="inline", content="text"
        )
        db.add(row)
        db.commit()
        evidence_id = row.id
    resp = client.get(f"/api/evidence/{evidence_id}/download", headers=auth)
    assert resp.status_code == 404  # inline evidence has no file to download

def test_download_traversal_path_rejected(client, auth, tmp_path, monkeypatch):
    """A tampered/legacy row pointing outside the evidence dir must not serve."""
    monkeypatch.setattr(evidence_api, "EVIDENCE_DIR", tmp_path)
    finding_id = _add_finding()
    with SessionLocal() as db:
        row = Evidence(
            finding_id=finding_id,
            kind=EvidenceKind.upload,
            label="evil",
            file_path="../platform.db",
        )
        db.add(row)
        db.commit()
        evidence_id = row.id
    resp = client.get(f"/api/evidence/{evidence_id}/download", headers=auth)
    assert resp.status_code == 404

def test_download_missing_file_404(client, auth, tmp_path, monkeypatch):
    monkeypatch.setattr(evidence_api, "EVIDENCE_DIR", tmp_path)
    finding_id = _add_finding()
    with SessionLocal() as db:
        row = Evidence(
            finding_id=finding_id, kind=EvidenceKind.upload, label="gone.txt", file_path="deadbeef.txt"
        )
        db.add(row)
        db.commit()
        evidence_id = row.id
    assert client.get(f"/api/evidence/{evidence_id}/download", headers=auth).status_code == 404

def test_download_unknown_404(client, auth):
    assert client.get("/api/evidence/99999/download", headers=auth).status_code == 404

# --- auto-capture helper -------------------------------------------------------

def test_capture_http_transcript_from_prober_output():
    raw = {
        "url": "http://localhost:3000/",
        "status_code": 200,
        "headers": {"server": "express", "x-powered-by": "Express"},
        "cookies": ["session=abc; Path=/; HttpOnly"],
    }
    job_id = _add_job(__import__("json").dumps(raw))
    with SessionLocal() as db:
        finding = db.get(Finding, _add_finding())
        job = db.get(Job, job_id)
        evidence = capture_http_transcript(db, finding, job)
        assert evidence is not None
        db.commit()
        assert evidence.kind == EvidenceKind.http_transcript
        assert evidence.tool == "prober"
        assert "GET http://localhost:3000/" in evidence.content
        assert "server: express" in evidence.content
        assert "session=abc" in evidence.content

def test_capture_is_idempotent_per_finding_job():
    import json

    raw = {"url": "http://localhost:3000/", "status_code": 200, "headers": {"server": "express"}}
    job_id = _add_job(json.dumps(raw))
    finding_id = _add_finding()
    with SessionLocal() as db:
        finding = db.get(Finding, finding_id)
        job = db.get(Job, job_id)
        first = capture_http_transcript(db, finding, job)
        db.commit()
        second = capture_http_transcript(db, finding, job)
        assert first is not None and second is None  # retry adds no duplicate

def test_capture_skips_non_prober_and_bad_json():
    finding_id = _add_finding()
    zap_job = _add_job('{"alerts": []}', tool="zap")
    junk_job = _add_job("not json at all")
    with SessionLocal() as db:
        finding = db.get(Finding, finding_id)
        assert capture_http_transcript(db, finding, db.get(Job, zap_job)) is None
        assert capture_http_transcript(db, finding, db.get(Job, junk_job)) is None
