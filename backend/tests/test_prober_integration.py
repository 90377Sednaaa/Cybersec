"""Prober + normalizer + orchestrator integration test (T1.4/T1.6).

Starts a real local HTTP server (deliberately missing security headers, with a
backup.zip to probe), drives the orchestrator's real job lifecycle against it,
then runs the normalizer and asserts candidate findings land in the DB with
status ai_candidate.
"""

import asyncio
import functools
import http.server
import json
import threading

import pytest

from app.database import SessionLocal
from app.models import (
    Assessment,
    AssessmentStatus,
    Finding,
    FindingStatus,
    Job,
    JobStatus,
    ScanIntensity,
    Target,
)
from app.scanner.orchestrator import PipelineHandle, _run_job, run_pipeline  # noqa: SLF001 - testing internals
from app.scanner.normalize import normalize_assessment

INDEX_HTML = b"<html><head><title>Test App</title></head><body>hello</body></html>"


class _Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        if self.path == "/backup.zip":
            self.send_response(200)
            self.send_header("Content-Type", "application/zip")
            self.end_headers()
            self.wfile.write(b"PK\x03\x04")
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        # Deliberately NO security headers, and a leaky banner.
        self.send_header("Server", "TestServer/1.0")
        self.end_headers()
        self.wfile.write(INDEX_HTML)

    def log_message(self, *args):  # silence test output
        pass


@pytest.fixture()
def local_site():
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(_Handler))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()


def _assessment_with_job(intensity: ScanIntensity, base_url: str):
    with SessionLocal() as db:
        target = Target(name="prober-target", base_url=base_url, allowed_intensity=intensity)
        db.add(target)
        db.flush()
        assessment = Assessment(
            target_id=target.id,
            intensity=intensity,
            categories=["Security configuration & HTTPS", "Exposed files & directories"],
        )
        db.add(assessment)
        db.flush()
        job = Job(assessment_id=assessment.id, tool="prober", status=JobStatus.pending)
        db.add(job)
        db.commit()
        return target.id, assessment.id, job.id


def _run_prober_job(target_id: int, assessment_id: int, job_id: int) -> None:
    """Drive the orchestrator's real job lifecycle (status transitions included)."""

    async def main():
        with SessionLocal() as db:
            target = db.get(Target, target_id)
            assessment = db.get(Assessment, assessment_id)
            job = db.get(Job, job_id)
            handle = PipelineHandle(assessment_id)
            await _run_job(db, handle, assessment, target, job)

    asyncio.run(main())


def test_prober_full_run_produces_candidates(local_site):
    target_id, assessment_id, job_id = _assessment_with_job(ScanIntensity.full_intrusive, local_site)
    _run_prober_job(target_id, assessment_id, job_id)

    with SessionLocal() as db:
        job = db.get(Job, job_id)
        assert job.status == JobStatus.completed
        raw = json.loads(job.raw_output)
        assert raw["status_code"] == 200
        # BaseHTTPRequestHandler prepends its own banner; ours is appended.
        assert "TestServer/1.0" in raw["headers"]["server"]
        # Intrusive wordlist found the planted backup.zip
        assert {"path": "/backup.zip", "status": 200} in raw["probed_paths"]

        created = normalize_assessment(db, db.get(Assessment, assessment_id), [job])
        assert created >= 4

        titles = {f.title for f in db.query(Finding).filter(Finding.assessment_id == assessment_id)}
        assert any("Missing security header: content-security-policy" in t for t in titles)
        assert any("backup.zip" in t for t in titles)
        assert any("TestServer/1.0" in t for t in titles)
        for f in db.query(Finding).filter(Finding.assessment_id == assessment_id):
            assert f.status == FindingStatus.ai_candidate
            assert f.verified_by_id is None


def test_gate_and_role_endpoints(client, auth):
    """T1.7: full intensity against a passive_safe target is a 409 before any job
    exists; viewers are 403 on creation. (Cancel is exercised in the live smoke
    run - racing a real pipeline inside TestClient is timing-flaky.)"""
    resp = client.post(
        "/api/targets",
        json={
            "name": "Gate",
            "base_url": "http://127.0.0.1:9",
            "authorization_ref": "TEST-AUTH-002",
            "allowed_intensity": "passive_safe",
        },
        headers=auth,
    )
    target_id = resp.json()["id"]

    blocked = client.post(
        "/api/assessments",
        json={"target_id": target_id, "intensity": "full_intrusive"},
        headers=auth,
    )
    assert blocked.status_code == 409
    assert "Intensity gate" in blocked.json()["detail"]

    # viewer-role requests must be rejected on creation (403)
    import uuid

    email = f"viewer-{uuid.uuid4().hex[:6]}@example.com"
    assert client.post("/api/users", json={"email": email, "password": "viewerpass1", "role": "viewer"}, headers=auth).status_code == 201
    vtoken = client.post("/api/auth/login", data={"username": email, "password": "viewerpass1"}).json()["access_token"]
    denied = client.post(
        "/api/assessments", json={"target_id": target_id}, headers={"Authorization": f"Bearer {vtoken}"}
    )
    assert denied.status_code == 403


def test_full_pipeline_end_to_end(local_site):
    """T1.6 smoke: the real orchestrator runs dns+nmap+prober, normalizer emits
    candidates, assessment completes even though nmap is missing on this machine."""
    with SessionLocal() as db:
        target = Target(name="pipe-target", base_url=local_site, allowed_intensity=ScanIntensity.passive_safe)
        db.add(target)
        db.flush()
        assessment = Assessment(target_id=target.id, intensity=ScanIntensity.passive_safe, categories=["all"])
        db.add(assessment)
        db.commit()
        assessment_id = assessment.id

    handle = PipelineHandle(assessment_id)
    asyncio.run(run_pipeline(assessment_id, handle))

    with SessionLocal() as db:
        assessment = db.get(Assessment, assessment_id)
        assert assessment.status == AssessmentStatus.completed
        tools = {j.tool: j.status for j in assessment.jobs}
        assert tools["prober"] == JobStatus.completed
        assert tools["dns"] == JobStatus.completed
        # nmap binary is not installed in this environment; the pipeline must
        # fail that job gracefully and still complete.
        assert tools["nmap"] == JobStatus.failed
        assert any("nmap executable not found" in j.log for j in assessment.jobs)
        findings = db.query(Finding).filter(Finding.assessment_id == assessment_id).all()
        assert len(findings) >= 3
        assert all(f.status == FindingStatus.ai_candidate for f in findings)
        # cleanup so later tests start from a clean state
        for j in assessment.jobs:
            db.delete(j)
        for f in findings:
            db.delete(f)
        db.delete(assessment)
        db.delete(db.get(Target, assessment.target_id))
        db.commit()
