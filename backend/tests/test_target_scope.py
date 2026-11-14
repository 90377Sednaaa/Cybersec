"""Target scope & authorization contract (Wave 2a: F-02, F-08, F-10).

Proposal 05: a target needs an authorization record, `base_url` must be an
absolute http(s) URL, only an admin may allow full_intrusive scanning, updates
are partial, and the orchestrator re-checks the target's allowed intensity at
scheduling time instead of trusting the value frozen on the assessment.
"""

import asyncio

import pytest

import app.scanner.orchestrator as orch
from app.database import SessionLocal
from app.models import Assessment, AssessmentStatus, JobStatus, ScanIntensity, Target
from app.scanner.base import RunnerError
from app.scanner.nmap_runner import build_nmap_target_args


def _assessor_auth(client, auth, email: str = "w2-assessor@example.com") -> dict[str, str]:
    created = client.post(
        "/api/users",
        json={"email": email, "password": "assesspw123", "full_name": "W2 Assessor", "role": "assessor"},
        headers=auth,
    )
    assert created.status_code in (201, 409), created.text  # 409 = already exists
    token = client.post("/api/auth/login", data={"username": email, "password": "assesspw123"}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _target_body(**overrides) -> dict:
    body = {
        "name": "Scope target",
        "base_url": "http://127.0.0.1:9",
        "authorization_ref": "AUTH-W2-001",
        "allowed_intensity": "passive_safe",
        "in_scope_assets": ["http://127.0.0.1:9"],
    }
    body.update(overrides)
    return body


# --- create-time validation -----------------------------------------------------

def test_target_requires_an_authorization_reference(client, auth):
    body = _target_body()
    body.pop("authorization_ref")
    resp = client.post("/api/targets", json=body, headers=auth)
    assert resp.status_code == 422, resp.text

    resp = client.post("/api/targets", json=_target_body(authorization_ref="   "), headers=auth)
    assert resp.status_code == 422, resp.text  # whitespace is not a record


def test_target_base_url_must_be_absolute_http(client, auth):
    for bad in ("not-a-url", "ftp://example.com", "http://"):
        resp = client.post("/api/targets", json=_target_body(base_url=bad), headers=auth)
        assert resp.status_code == 422, f"{bad!r} was accepted: {resp.text}"

    ok = client.post("/api/targets", json=_target_body(base_url="https://example.com/app"), headers=auth)
    assert ok.status_code == 201, ok.text
    # The stored value is not normalised - no surprise trailing slash.
    assert ok.json()["base_url"] == "https://example.com/app"


# --- intensity escalation is an admin decision ----------------------------------

def test_assessor_cannot_allow_full_intrusive(client, auth):
    assessor = _assessor_auth(client, auth)
    resp = client.post(
        "/api/targets", json=_target_body(allowed_intensity="full_intrusive"), headers=assessor
    )
    assert resp.status_code == 403, resp.text
    assert "admin" in resp.json()["detail"].lower()


def test_assessor_may_register_a_passive_target(client, auth):
    assessor = _assessor_auth(client, auth)
    resp = client.post("/api/targets", json=_target_body(), headers=assessor)
    assert resp.status_code == 201, resp.text


def test_admin_may_allow_full_intrusive(client, auth):
    resp = client.post("/api/targets", json=_target_body(allowed_intensity="full_intrusive"), headers=auth)
    assert resp.status_code == 201, resp.text
    assert resp.json()["allowed_intensity"] == "full_intrusive"


def test_assessor_cannot_escalate_an_existing_target(client, auth, passive_target):
    assessor = _assessor_auth(client, auth)
    resp = client.patch(
        f"/api/targets/{passive_target['id']}", json={"allowed_intensity": "full_intrusive"}, headers=assessor
    )
    assert resp.status_code == 403, resp.text


# --- partial update -------------------------------------------------------------

def test_patch_preserves_fields_it_does_not_mention(client, auth):
    """Regression (F-02): PUT mass-assigned a full TargetCreate, so a partial
    body silently reset authorization_ref and both scope lists."""
    created = client.post(
        "/api/targets",
        json=_target_body(
            in_scope_assets=["http://127.0.0.1:9", "http://127.0.0.1:9/api"],
            out_of_scope_assets=["http://127.0.0.1:9/admin"],
        ),
        headers=auth,
    ).json()

    patched = client.patch(f"/api/targets/{created['id']}", json={"name": "Renamed"}, headers=auth)
    assert patched.status_code == 200, patched.text
    body = patched.json()
    assert body["name"] == "Renamed"
    assert body["authorization_ref"] == "AUTH-W2-001"
    assert body["in_scope_assets"] == ["http://127.0.0.1:9", "http://127.0.0.1:9/api"]
    assert body["out_of_scope_assets"] == ["http://127.0.0.1:9/admin"]
    assert body["allowed_intensity"] == "passive_safe"


def test_put_is_no_longer_accepted(client, auth, passive_target):
    resp = client.put(f"/api/targets/{passive_target['id']}", json={"name": "x"}, headers=auth)
    assert resp.status_code == 405, resp.text


# --- one live run per target ----------------------------------------------------

def test_second_running_assessment_on_one_target_is_rejected(client, auth, passive_target):
    """F-08: two POSTs created two live pipelines scanning the same host."""
    with SessionLocal() as db:
        db.add(
            Assessment(
                target_id=passive_target["id"],
                intensity=ScanIntensity.passive_safe,
                categories=[],
                status=AssessmentStatus.running,
            )
        )
        db.commit()

    resp = client.post(
        "/api/assessments",
        json={"target_id": passive_target["id"], "categories": ["Security configuration & HTTPS"]},
        headers=auth,
    )
    assert resp.status_code == 409, resp.text
    assert "already has a running assessment" in resp.json()["detail"]


# --- orchestrator re-checks the target, not the frozen assessment ----------------

def test_downgraded_target_skips_intrusive_tools(client, auth, monkeypatch):
    """F-02: assessment.intensity is frozen at creation. Lowering the target's
    allowed level afterwards used to leave zap (and prober's intrusive checks)
    running anyway."""
    target = client.post(
        "/api/targets", json=_target_body(allowed_intensity="full_intrusive"), headers=auth
    ).json()
    assessment = client.post(
        "/api/assessments",
        json={
            "target_id": target["id"],
            "intensity": "full_intrusive",
            "categories": ["Security configuration & HTTPS"],
        },
        headers=auth,
    ).json()
    assert [j["tool"] for j in assessment["jobs"]] == ["dns", "nmap", "prober", "zap"]
    assessment_id = assessment["id"]

    # Admin lowers the target while the run is queued/starting.
    lowered = client.patch(
        f"/api/targets/{target['id']}", json={"allowed_intensity": "passive_safe"}, headers=auth
    )
    assert lowered.status_code == 200, lowered.text

    async def fake_run_job(db, _handle, _assessment, _target, job, _effective=None):
        job.status = JobStatus.completed
        db.commit()

    async def fake_interpret(_db, _handle, _assessment, _jobs, _target):
        return None

    monkeypatch.setattr(orch, "_run_job", fake_run_job)
    monkeypatch.setattr(orch, "_run_interpret", fake_interpret)
    monkeypatch.setattr(orch, "normalize_assessment", lambda _db, _a, _jobs: 0)

    asyncio.run(orch.run_pipeline(assessment_id, orch.PipelineHandle(assessment_id)))

    with SessionLocal() as db:
        row = db.get(Assessment, assessment_id)
        tools = {j.tool: j.status for j in row.jobs}
        assert tools["zap"] == JobStatus.cancelled
        assert "skipped" in next(j.log for j in row.jobs if j.tool == "zap")
        assert tools["dns"] == JobStatus.completed
        assert "downgraded to passive_safe" in (row.notes or "")
        # cleanup
        for job in row.jobs:
            db.delete(job)
        db.delete(row)
        db.commit()


def test_effective_intensity_never_exceeds_the_target():
    from app.scanner.orchestrator import effective_intensity

    frozen = Assessment(intensity=ScanIntensity.full_intrusive, categories=[])
    permissive = Target(name="t", base_url="http://x.test", allowed_intensity=ScanIntensity.full_intrusive)
    locked = Target(name="t", base_url="http://x.test", allowed_intensity=ScanIntensity.passive_safe)
    assert effective_intensity(frozen, permissive) == ScanIntensity.full_intrusive
    assert effective_intensity(frozen, locked) == ScanIntensity.passive_safe


# --- nmap argument injection ----------------------------------------------------

@pytest.mark.parametrize("url", ["http://-6", "http://--open", "http://-sV:80"])
def test_leading_dash_hostname_is_rejected(url):
    """F-10: urlsplit("http://-6").hostname == "-6", which nmap's own parser
    reads as a flag."""
    with pytest.raises(RunnerError):
        build_nmap_target_args(url)
