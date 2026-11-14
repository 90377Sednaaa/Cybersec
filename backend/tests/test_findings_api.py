"""M4 T4.1: findings API — filters, detail, verification state machine, roles.

Rows are inserted directly (normalizer-style `ai_candidate` candidates) so the
state machine is tested independently of the scan pipeline.
"""

from app.database import SessionLocal
from app.models import (
    Assessment,
    AssessmentStatus,
    Evidence,
    EvidenceKind,
    Finding,
    FindingStatus,
    ScanIntensity,
    Severity,
    Target,
)

DETAIL_KEYS = {
    "id", "assessment_id", "category", "title", "description", "severity", "score",
    "status", "ai_confidence", "remediation", "assessor_notes",
    "verified_by_id", "verified_at", "verified_by", "evidence",
}

def _add_finding(**overrides) -> int:
    """Insert one candidate finding and return its id (id escapes the session)."""
    defaults = dict(
        assessment_id=None,
        category="Security configuration & HTTPS",
        title="Missing Content-Security-Policy",
        description="No CSP header was returned.",
        severity=Severity.high,
        score=7.0,
        status=FindingStatus.ai_candidate,
        ai_confidence=1.0,
        remediation="Serve a CSP header.",
        assessor_notes="",
    )
    defaults.update(overrides)
    with SessionLocal() as db:
        finding = Finding(**defaults)
        db.add(finding)
        db.commit()
        return finding.id

def _add_assessment(target_id: int) -> int:
    with SessionLocal() as db:
        assessment = Assessment(
            target_id=target_id,
            intensity=ScanIntensity.passive_safe,
            categories=["Security configuration & HTTPS"],
            status=AssessmentStatus.completed,
        )
        db.add(assessment)
        db.commit()
        return assessment.id

def _viewer_auth(client, auth: dict[str, str]) -> dict[str, str]:
    """Create a viewer via the admin users API, log in, return auth headers.

    File-unique email: the DB persists across the whole pytest run, so two
    test files must not fight over the same viewer account.
    """
    created = client.post(
        "/api/users",
        json={"email": "viewer-findings@example.com", "password": "viewerpw123", "role": "viewer"},
        headers=auth,
    )
    assert created.status_code in (201, 409)  # fresh or already created by an earlier test
    token = client.post(
        "/api/auth/login",
        data={"username": "viewer-findings@example.com", "password": "viewerpw123"},
    ).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}

# --- list & detail -----------------------------------------------------------

def test_list_returns_frozen_contract_shape(client, auth):
    _add_finding()
    resp = client.get("/api/findings", headers=auth)
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) >= 1
    assert set(body[0]) == {
        "id", "assessment_id", "category", "title", "description", "severity", "score",
        "status", "ai_confidence", "remediation", "assessor_notes",
    }

def test_list_requires_auth(client):
    assert client.get("/api/findings").status_code == 401

def test_list_filters(client, auth, passive_target):
    assessment_id = _add_assessment(passive_target["id"])
    in_assessment_high = _add_finding(assessment_id=assessment_id, severity=Severity.high)
    in_assessment_dismissed = _add_finding(
        assessment_id=assessment_id,
        title="HTTP TRACE enabled",
        severity=Severity.low,
        status=FindingStatus.false_positive,
        category="Information disclosure",
    )
    _add_finding(title="Orphan candidate", severity=Severity.medium)  # no assessment

    base = client.get("/api/findings", headers=auth).json()

    r = client.get(f"/api/findings?assessment_id={assessment_id}", headers=auth)
    assert {f["id"] for f in r.json()} == {in_assessment_high, in_assessment_dismissed}

    r = client.get("/api/findings?status=false_positive", headers=auth)
    assert {f["id"] for f in r.json()} == {in_assessment_dismissed}

    r = client.get("/api/findings?severity=high", headers=auth)
    assert {f["id"] for f in r.json()} >= {in_assessment_high}

    r = client.get("/api/findings?category=Information%20disclosure", headers=auth)
    assert {f["id"] for f in r.json()} == {in_assessment_dismissed}

    r = client.get(
        f"/api/findings?assessment_id={assessment_id}&status=false_positive", headers=auth
    )
    assert {f["id"] for f in r.json()} == {in_assessment_dismissed}

    assert len(base) >= 3

def test_detail_includes_evidence_and_audit_fields(client, auth):
    finding_id = _add_finding()
    with SessionLocal() as db:
        db.add(
            Evidence(
                finding_id=finding_id,
                kind=EvidenceKind.tool_output,
                label="Output of prober job #1",
                content="content-security-policy: missing",
                tool="prober",
            )
        )
        db.commit()

    resp = client.get(f"/api/findings/{finding_id}", headers=auth)
    assert resp.status_code == 200
    body = resp.json()
    assert set(body) == DETAIL_KEYS
    assert body["verified_by"] is None and body["verified_by_id"] is None
    assert len(body["evidence"]) == 1
    assert body["evidence"][0]["kind"] == "tool_output"
    assert "file_path" not in body["evidence"][0]  # stored paths never leak

def test_detail_404(client, auth):
    assert client.get("/api/findings/99999", headers=auth).status_code == 404

# --- verification state machine ----------------------------------------------

def test_patch_to_verified_stamps_attribution(client, auth):
    finding_id = _add_finding()
    resp = client.patch(f"/api/findings/{finding_id}", json={"status": "verified"}, headers=auth)
    assert resp.status_code == 200
    assert resp.json()["status"] == "verified"

    detail = client.get(f"/api/findings/{finding_id}", headers=auth).json()
    assert detail["verified_by"] == "admin@example.com"  # attribution from the JWT
    assert detail["verified_by_id"] is not None
    assert detail["verified_at"] is not None

def test_patch_illegal_transitions_409(client, auth):
    cases = [
        # (seed status, attempted status) — every move outside ALLOWED_TRANSITIONS
        (FindingStatus.verified, FindingStatus.ai_candidate),
        (FindingStatus.false_positive, FindingStatus.verified),
        (FindingStatus.false_positive, FindingStatus.needs_evidence),
        (FindingStatus.needs_evidence, FindingStatus.ai_candidate),
    ]
    for seed, attempt in cases:
        finding_id = _add_finding(status=seed)
        resp = client.patch(
            f"/api/findings/{finding_id}", json={"status": attempt.value}, headers=auth
        )
        assert resp.status_code == 409, f"{seed.value} -> {attempt.value} must be illegal"
        # the finding keeps its original status after the rejection
        assert client.get(f"/api/findings/{finding_id}", headers=auth).json()["status"] == seed.value

def test_patch_reopen_paths_allowed(client, auth):
    # verified -> needs_evidence (reopen), then back to verified (re-stamp)
    finding_id = _add_finding()
    assert client.patch(f"/api/findings/{finding_id}", json={"status": "verified"}, headers=auth).status_code == 200
    assert client.patch(f"/api/findings/{finding_id}", json={"status": "needs_evidence"}, headers=auth).status_code == 200
    detail = client.get(f"/api/findings/{finding_id}", headers=auth).json()
    assert detail["verified_by"] is None  # stale attribution dropped on reopen

    assert client.patch(f"/api/findings/{finding_id}", json={"status": "verified"}, headers=auth).status_code == 200
    detail = client.get(f"/api/findings/{finding_id}", headers=auth).json()
    assert detail["verified_by"] == "admin@example.com"

    # false_positive -> ai_candidate (reopen a dismissal)
    fp_id = _add_finding(status=FindingStatus.false_positive, title="Stale alert")
    assert client.patch(f"/api/findings/{fp_id}", json={"status": "ai_candidate"}, headers=auth).status_code == 200

def test_patch_notes_and_severity_without_status_change(client, auth):
    finding_id = _add_finding()
    resp = client.patch(
        f"/api/findings/{finding_id}",
        json={"severity": "medium", "assessor_notes": "Checked manually - header really missing."},
        headers=auth,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ai_candidate"  # untouched
    assert body["severity"] == "medium"
    assert body["assessor_notes"].startswith("Checked manually")

def test_patch_empty_body_422(client, auth):
    finding_id = _add_finding()
    assert client.patch(f"/api/findings/{finding_id}", json={}, headers=auth).status_code == 422

def test_patch_explicit_nulls_treated_as_absent(client, auth):
    """Explicit JSON nulls are NOT NULL columns - they must be ignored (or
    422), never crash the commit with a 500. Regression for a review finding."""
    finding_id = _add_finding()
    for body in ({"severity": None}, {"score": None}, {"assessor_notes": None},
                 {"severity": None, "status": "verified"}):
        resp = client.patch(f"/api/findings/{finding_id}", json=body, headers=auth)
        assert resp.status_code in (200, 422), f"{body} -> {resp.status_code}"
        if resp.status_code == 200 and "status" in body:
            # null severity ignored, but the real field in the same body applies
            assert resp.json()["status"] == "verified"
            assert resp.json()["severity"] == "high"  # original value kept
    detail = client.get(f"/api/findings/{finding_id}", headers=auth).json()
    assert detail["severity"] == "high" and detail["score"] == 7.0  # nothing nulled

def test_patch_unknown_finding_404(client, auth):
    assert client.patch("/api/findings/99999", json={"status": "verified"}, headers=auth).status_code == 404

def test_patch_score_out_of_range_422(client, auth):
    finding_id = _add_finding()
    assert client.patch(f"/api/findings/{finding_id}", json={"score": 11}, headers=auth).status_code == 422

# --- role guards --------------------------------------------------------------

def test_patch_viewer_403(client, auth):
    finding_id = _add_finding()
    viewer = _viewer_auth(client, auth)
    resp = client.patch(f"/api/findings/{finding_id}", json={"status": "verified"}, headers=viewer)
    assert resp.status_code == 403
    # and the viewer cannot smuggle a change through notes either
    resp = client.patch(f"/api/findings/{finding_id}", json={"assessor_notes": "x"}, headers=viewer)
    assert resp.status_code == 403
    assert client.get(f"/api/findings/{finding_id}", headers=auth).json()["status"] == "ai_candidate"

def test_viewer_can_read_findings(client, auth):
    _add_finding()
    viewer = _viewer_auth(client, auth)
    assert client.get("/api/findings", headers=viewer).status_code == 200


# --- Wave 4 regression: proposal 06 / F-31 (total + pagination) -----------------

def test_list_sends_the_filtered_total_in_x_total_count(client, auth, passive_target):
    """The header must describe the *filtered* set, not the whole table, or the
    dashboard would label a filtered count as the total."""
    assessment_id = _add_assessment(passive_target["id"])
    _add_finding(assessment_id=assessment_id, severity=Severity.high)
    _add_finding(
        assessment_id=assessment_id,
        title="HTTP TRACE enabled",
        status=FindingStatus.false_positive,
    )

    both = client.get(f"/api/findings?assessment_id={assessment_id}", headers=auth)
    assert both.status_code == 200
    assert both.headers["x-total-count"] == "2"
    assert len(both.json()) == 2

    filtered = client.get(
        f"/api/findings?assessment_id={assessment_id}&status=false_positive", headers=auth
    )
    assert filtered.headers["x-total-count"] == "1"
    assert [f["status"] for f in filtered.json()] == ["false_positive"]


def test_list_limit_offset_paginate_without_changing_the_body_shape(client, auth, passive_target):
    assessment_id = _add_assessment(passive_target["id"])
    for index in range(5):
        _add_finding(assessment_id=assessment_id, title=f"Page {index}")

    first = client.get(f"/api/findings?assessment_id={assessment_id}&limit=2", headers=auth)
    assert len(first.json()) == 2
    assert first.headers["x-total-count"] == "5"
    # frozen contract: still a bare list of FindingOut, newest first
    assert set(first.json()[0]) == {
        "id", "assessment_id", "category", "title", "description", "severity", "score",
        "status", "ai_confidence", "remediation", "assessor_notes",
    }
    assert first.json()[0]["title"] == "Page 4"

    second = client.get(
        f"/api/findings?assessment_id={assessment_id}&limit=2&offset=2", headers=auth
    )
    assert [f["title"] for f in second.json()] == ["Page 2", "Page 1"]

    last = client.get(
        f"/api/findings?assessment_id={assessment_id}&limit=2&offset=4", headers=auth
    )
    assert [f["title"] for f in last.json()] == ["Page 0"]

    beyond = client.get(
        f"/api/findings?assessment_id={assessment_id}&limit=2&offset=10", headers=auth
    )
    assert beyond.json() == []
    assert beyond.headers["x-total-count"] == "5"  # the total is unaffected by the offset


def test_list_rejects_out_of_range_pagination(client, auth):
    assert client.get("/api/findings?limit=0", headers=auth).status_code == 422
    assert client.get("/api/findings?limit=501", headers=auth).status_code == 422
    assert client.get("/api/findings?offset=-1", headers=auth).status_code == 422
