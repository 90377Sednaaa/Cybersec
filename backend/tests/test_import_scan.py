"""Tests for manual scan import (POST /api/assessments/import)."""

from __future__ import annotations

import json
import pathlib
from io import BytesIO

import pytest

FIXTURES = pathlib.Path(__file__).parent / "fixtures"
NMAP_FIXTURE = FIXTURES / "nmap_localhost.xml"

SAMPLE_ZAP_JSON = {
    "site": [
        {
            "@name": "http://127.0.0.1:8000",
            "alerts": [
                {
                    "pluginId": "10020",
                    "alert": "X-Frame-Options Header Missing",
                    "name": "X-Frame-Options Header Missing",
                    "risk": "Medium",
                    "confidence": "High",
                    "desc": "The X-Frame-Options header is not set.",
                    "solution": "Set X-Frame-Options to DENY.",
                    "url": "http://127.0.0.1:8000/",
                    "evidence": "<script>",
                    "cweid": "1021",
                }
            ],
        }
    ]
}


def test_import_nmap_xml_success(client, auth, passive_target):
    from app.database import SessionLocal
    from app.models import Job

    xml_content = NMAP_FIXTURE.read_bytes()
    resp = client.post(
        "/api/assessments/import",
        data={"target_id": passive_target["id"], "tool": "nmap"},
        files={"file": ("scan.xml", BytesIO(xml_content), "application/xml")},
        headers=auth,
    )
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["target_id"] == passive_target["id"]
    assert data["status"] in ("completed", "running")
    assert len(data["jobs"]) == 1
    job = data["jobs"][0]
    assert job["tool"] == "nmap"
    assert job["status"] == "completed"

    with SessionLocal() as db:
        job_row = db.get(Job, job["id"])
        assert job_row is not None
        assert "hosts" in json.loads(job_row.raw_output)


def test_import_zap_json_success(client, auth, passive_target):
    json_bytes = json.dumps(SAMPLE_ZAP_JSON).encode("utf-8")
    resp = client.post(
        "/api/assessments/import",
        data={"target_id": passive_target["id"], "tool": "zap"},
        files={"file": ("zap.json", BytesIO(json_bytes), "application/json")},
        headers=auth,
    )
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["target_id"] == passive_target["id"]
    assert len(data["jobs"]) == 1
    job = data["jobs"][0]
    assert job["tool"] == "zap"
    assert job["status"] == "completed"

    # Normalizer should have converted the ZAP alert into a candidate finding
    findings_resp = client.get(f"/api/findings?assessment_id={data['id']}", headers=auth)
    assert findings_resp.status_code == 200
    findings = findings_resp.json()
    assert any(f["title"] == "X-Frame-Options Header Missing" for f in findings)


def test_import_invalid_xml_returns_422(client, auth, passive_target):
    resp = client.post(
        "/api/assessments/import",
        data={"target_id": passive_target["id"], "tool": "nmap"},
        files={"file": ("bad.xml", BytesIO(b"<not valid xml>"), "application/xml")},
        headers=auth,
    )
    assert resp.status_code == 422
    assert "XML" in resp.json()["detail"]


def test_import_invalid_json_returns_422(client, auth, passive_target):
    resp = client.post(
        "/api/assessments/import",
        data={"target_id": passive_target["id"], "tool": "zap"},
        files={"file": ("bad.json", BytesIO(b"{not json"), "application/json")},
        headers=auth,
    )
    assert resp.status_code == 422
    assert "JSON" in resp.json()["detail"]


def test_import_invalid_tool_returns_422(client, auth, passive_target):
    resp = client.post(
        "/api/assessments/import",
        data={"target_id": passive_target["id"], "tool": "unknown_tool"},
        files={"file": ("dummy.txt", BytesIO(b"data"), "text/plain")},
        headers=auth,
    )
    assert resp.status_code == 422


def test_import_missing_target_returns_404(client, auth):
    resp = client.post(
        "/api/assessments/import",
        data={"target_id": 999999, "tool": "nmap"},
        files={"file": ("scan.xml", BytesIO(b"<xml></xml>"), "application/xml")},
        headers=auth,
    )
    assert resp.status_code == 404
