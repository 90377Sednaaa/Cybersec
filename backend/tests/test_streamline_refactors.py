"""Regression tests for streamlined scanner, orchestrator, and AI refactors."""

from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import httpx
import pytest
from sqlalchemy import delete

import app.ai.client as ai_client
from app.ai.interpret import extract_json_text, interpret_assessment
from app.ai.qa import answer_finding_question
from app.ai.summarize import summarize_assessment
from app.database import SessionLocal
from app.models import (
    AIOutput,
    Assessment,
    AssessmentStatus,
    Evidence,
    Finding,
    FindingStatus,
    Job,
    JobStatus,
    LLMProvider,
    LLMTask,
    LLMTaskConfig,
    ScanIntensity,
    Severity,
    Target,
)
from app.reporting import ensure_ai_summary
from app.scanner.base import RunnerError, ScanContext
from app.scanner.nmap_runner import build_nmap_argv, parse_nmap_xml
from app.scanner.normalize import normalize_job
from app.scanner.prober import checks
from app.scanner.zap_runner import ZapRunner, build_zap_exclude_regexes


# --- Nmap fixes -------------------------------------------------------------


def test_build_nmap_argv_omits_top_ports_when_explicit_port_present():
    """Targets like http://localhost:3000 must not send both --top-ports and -p."""
    argv = build_nmap_argv("nmap", "http://localhost:3000", is_full=False)
    assert "--top-ports" not in argv
    assert "-p" in argv
    assert "3000" in argv
    assert argv[-1] == "localhost"

    argv_default = build_nmap_argv("nmap", "https://example.com/app", is_full=True)
    assert "--top-ports" in argv_default
    assert "5000" in argv_default
    assert "-p" not in argv_default


def test_parse_nmap_xml_extracts_cpe_and_extrainfo():
    xml = """<?xml version="1.0"?>
    <nmaprun>
      <host>
        <address addr="127.0.0.1"/>
        <ports>
          <port protocol="tcp" portid="3306">
            <state state="open"/>
            <service name="mysql" product="MySQL" version="8.0.34" extrainfo="unauthorized">
              <cpe>cpe:/a:mysql:mysql:8.0.34</cpe>
            </service>
          </port>
        </ports>
      </host>
    </nmaprun>"""
    parsed = parse_nmap_xml(xml)
    port = parsed["hosts"][0]["open_ports"][0]
    assert port["port"] == 3306
    assert port["extrainfo"] == "unauthorized"
    assert port["cpe"] == ["cpe:/a:mysql:mysql:8.0.34"]


def test_normalize_nmap_flags_exposed_risky_ports():
    with SessionLocal() as db:
        target = Target(
            name="nmap-norm-target",
            base_url="http://127.0.0.1:8080",
            authorization_ref="TEST-NMAP-NORM",
            allowed_intensity=ScanIntensity.passive_safe,
        )
        db.add(target)
        db.flush()
        assessment = Assessment(target_id=target.id, intensity=ScanIntensity.passive_safe, categories=[])
        db.add(assessment)
        db.flush()
        job = Job(
            assessment_id=assessment.id,
            tool="nmap",
            status=JobStatus.completed,
            raw_output=json.dumps(
                {
                    "hosts": [
                        {
                            "address": "127.0.0.1",
                            "hostname": "localhost",
                            "open_ports": [
                                {"port": 3306, "protocol": "tcp", "service": "mysql", "product": "MySQL", "version": "8.0"},
                                {"port": 23, "protocol": "tcp", "service": "telnet", "product": "", "version": ""},
                                {"port": 443, "protocol": "tcp", "service": "https", "product": "nginx", "version": "1.24"},
                            ],
                        }
                    ],
                    "summary": "done",
                }
            ),
        )
        db.add(job)
        db.commit()

        created = normalize_job(db, assessment, job)
        assert created == 2
        findings = db.query(Finding).filter(Finding.assessment_id == assessment.id).all()
        titles = {f.title for f in findings}
        assert "Exposed MySQL database port (3306)" in titles
        assert "Exposed Telnet service (port 23)" in titles
        assert all(f.status == FindingStatus.ai_candidate for f in findings)
        assert all(f.score >= 8.0 for f in findings)

        # cleanup
        for f in findings:
            for e in list(f.evidence):
                db.delete(e)
            db.delete(f)
        db.delete(job)
        db.delete(assessment)
        db.delete(target)
        db.commit()


# --- Prober fixes -----------------------------------------------------------


def test_prober_soft_404_and_content_sanity():
    spa_html = b"<!DOCTYPE html><html><head><title>Juice Shop</title></head><body><app-root></app-root></body></html>"
    baseline = {
        "status_code": 200,
        "content_type": "text/html",
        "length": len(spa_html),
        "prefix": spa_html[:128],
    }
    assert checks.is_soft_404(baseline, status_code=200, content_type="text/html; charset=utf-8", body=spa_html) is True
    assert checks.is_soft_404(baseline, status_code=200, content_type="application/zip", body=b"PK\x03\x04") is False
    assert checks.matches_expected_content("/.git/HEAD", "text/html", spa_html) is False
    assert checks.matches_expected_content("/.git/HEAD", "text/plain", b"ref: refs/heads/main\n") is True
    assert checks.matches_expected_content("/.env", "text/plain", b"DB_HOST=localhost\n") is True
    assert checks.matches_expected_content("/backup.zip", "application/zip", b"PK\x03\x04") is True


def test_prober_cors_samesite_and_csp_frame_ancestors():
    headers = httpx.Headers(
        [
            ("content-security-policy", "default-src 'self'; frame-ancestors 'none'"),
            ("access-control-allow-origin", "*"),
            ("access-control-allow-credentials", "true"),
            ("set-cookie", "sid=abc; HttpOnly; Secure"),
        ]
    )
    _facts, sec_findings = checks.check_security_headers(headers)
    titles = {f["title"] for f in sec_findings}
    assert not any("x-frame-options" in t for t in titles)
    assert any("CORS" in t for t in titles)

    _cookies, cookie_findings = checks.check_cookies(headers)
    assert [f["title"] for f in cookie_findings] == ["Cookie 'sid' missing SameSite attribute"]


def test_get_tls_info_uses_supplied_non_443_port():
    called_with: list[tuple[str, int]] = []

    def fake_connect(addr, timeout=5):
        called_with.append(addr)
        raise OSError("refused")

    with patch("socket.create_connection", side_effect=fake_connect):
        assert checks.get_tls_info("localhost", 8443) is None

    assert called_with == [("localhost", 8443)]


# --- ZAP fixes --------------------------------------------------------------


def test_zap_runner_tracks_scan_id_and_applies_exclusions(monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "zap_api_url", "http://zap.local:8080")
    monkeypatch.setattr(settings, "zap_api_key", "test-key")
    monkeypatch.setattr("app.scanner.zap_runner.POLL_SECONDS", 0.0)

    seen_requests: list[tuple[str, dict[str, str]]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        params = dict(request.url.params)
        seen_requests.append((path, params))
        if path == "/JSON/core/view/version/":
            return httpx.Response(200, json={"version": "2.15.0"})
        if path == "/JSON/spider/action/scan/":
            return httpx.Response(200, json={"scan": "42"})
        if path == "/JSON/spider/view/status/":
            return httpx.Response(200, json={"status": "100"})
        if path == "/JSON/ascan/action/scan/":
            return httpx.Response(200, json={"scan": "99"})
        if path == "/JSON/ascan/view/status/":
            return httpx.Response(200, json={"status": "100"})
        if path == "/JSON/core/view/alerts/":
            return httpx.Response(
                200,
                json={
                    "alerts": [
                        {
                            "pluginId": "40012",
                            "name": "Reflected XSS",
                            "risk": "High",
                            "confidence": "Medium",
                            "url": "http://127.0.0.1:3000/search?q=1",
                            "method": "GET",
                            "param": "q",
                            "attack": "<script>alert(1)</script>",
                            "evidence": "<script>alert(1)</script>",
                            "cweid": "79",
                        }
                    ]
                },
            )
        return httpx.Response(200, json={"Result": "OK"})

    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(
        ZapRunner,
        "_client",
        lambda self: httpx.AsyncClient(base_url="http://zap.local:8080", transport=transport),
    )

    job = SimpleNamespace(raw_output="", log="", progress=0.0)
    ctx = ScanContext(
        db=MagicMock(),
        target=SimpleNamespace(
            base_url="http://127.0.0.1:3000",
            authorization_ref="TEST-ZAP",
            in_scope_assets=["http://127.0.0.1:3000"],
            out_of_scope_assets=["/logout"],
        ),
        assessment=SimpleNamespace(intensity=ScanIntensity.full_intrusive),
        job=job,
        emit_log=lambda _line: None,
        emit_progress=lambda _value: None,
        cancelled=lambda: False,
    )

    asyncio.run(ZapRunner().run(ctx))

    spider_polls = [p for path, p in seen_requests if path == "/JSON/spider/view/status/"]
    ascan_polls = [p for path, p in seen_requests if path == "/JSON/ascan/view/status/"]
    exclusions = [p for path, p in seen_requests if path.endswith("/excludeFromScan/")]
    assert spider_polls and spider_polls[0].get("scanId") == "42"
    assert ascan_polls and ascan_polls[0].get("scanId") == "99"
    assert len(exclusions) == 2  # spider + ascan
    parsed = json.loads(job.raw_output)
    assert parsed["alerts"][0]["param"] == "q"
    assert parsed["alerts"][0]["method"] == "GET"


def test_zap_runner_stops_scan_on_cancel(monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "zap_api_url", "http://zap.local:8080")
    monkeypatch.setattr(settings, "zap_api_key", "test-key")
    monkeypatch.setattr("app.scanner.zap_runner.POLL_SECONDS", 0.0)

    stopped: list[tuple[str, str | None]] = []
    cancel_flag = {"now": False}

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        params = dict(request.url.params)
        if path == "/JSON/core/view/version/":
            return httpx.Response(200, json={"version": "2.15.0"})
        if path == "/JSON/spider/action/scan/":
            cancel_flag["now"] = True
            return httpx.Response(200, json={"scan": "7"})
        if path == "/JSON/spider/action/stop/":
            stopped.append((path, params.get("scanId")))
            return httpx.Response(200, json={"Result": "OK"})
        return httpx.Response(200, json={"status": "10"})

    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(
        ZapRunner,
        "_client",
        lambda self: httpx.AsyncClient(base_url="http://zap.local:8080", transport=transport),
    )

    job = SimpleNamespace(raw_output="", log="", progress=0.0)
    ctx = ScanContext(
        db=MagicMock(),
        target=SimpleNamespace(
            base_url="http://127.0.0.1:3000",
            authorization_ref="TEST-ZAP-CANCEL",
            in_scope_assets=["http://127.0.0.1:3000"],
            out_of_scope_assets=[],
        ),
        assessment=SimpleNamespace(intensity=ScanIntensity.passive_safe),
        job=job,
        emit_log=lambda _line: None,
        emit_progress=lambda _value: None,
        cancelled=lambda: cancel_flag["now"],
    )

    with pytest.raises(RunnerError, match="Cancelled"):
        asyncio.run(ZapRunner().run(ctx))

    assert stopped == [("/JSON/spider/action/stop/", "7")]


def test_build_zap_exclude_regexes():
    regexes = build_zap_exclude_regexes("http://localhost:3000/app", ["/logout", "http://localhost:3000/pay"])
    assert len(regexes) == 2
    assert any("logout" in r for r in regexes)
    assert any("pay" in r for r in regexes)


# --- Tool selection & Re-run AI endpoint -----------------------------------


def test_assessment_custom_tools_and_intensity_gate(client, auth, monkeypatch):
    import app.api.assessments as assessments_api

    monkeypatch.setattr(assessments_api, "start_pipeline", lambda _aid: None)

    target_resp = client.post(
        "/api/targets",
        json={
            "name": "ToolSelectTarget",
            "base_url": "http://127.0.0.1:9",
            "authorization_ref": "TEST-AUTH-TOOLS",
            "allowed_intensity": "passive_safe",
        },
        headers=auth,
    )
    assert target_resp.status_code == 201
    target_id = target_resp.json()["id"]

    # Unknown tool -> 422
    bad = client.post(
        "/api/assessments",
        json={"target_id": target_id, "tools": ["nonexistent"]},
        headers=auth,
    )
    assert bad.status_code == 422

    # Intrusive tool on passive_safe -> 409
    gated = client.post(
        "/api/assessments",
        json={"target_id": target_id, "tools": ["prober", "zap"]},
        headers=auth,
    )
    assert gated.status_code == 409

    # Valid subset -> 201 with only requested jobs
    ok = client.post(
        "/api/assessments",
        json={"target_id": target_id, "tools": ["prober"]},
        headers=auth,
    )
    assert ok.status_code == 201
    assert [j["tool"] for j in ok.json()["jobs"]] == ["prober"]


def test_rerun_interpret_endpoint(client, auth, monkeypatch):
    with SessionLocal() as db:
        db.execute(delete(LLMTaskConfig))
        db.execute(delete(LLMProvider))
        provider = LLMProvider(
            name="Mock",
            base_url="https://mock.test/v1",
            api_key_encrypted="",
            enabled=True,
        )
        db.add(provider)
        db.flush()
        db.add(LLMTaskConfig(task=LLMTask.interpretation, provider_id=provider.id, model="mock-m"))
        target = Target(
            name="ReInterpTarget",
            base_url="http://127.0.0.1:9999",
            authorization_ref="TEST-REINTERP",
            allowed_intensity=ScanIntensity.passive_safe,
        )
        db.add(target)
        db.flush()
        assessment = Assessment(
            target_id=target.id,
            intensity=ScanIntensity.passive_safe,
            categories=["Information disclosure"],
            status=AssessmentStatus.completed,
        )
        db.add(assessment)
        db.flush()
        db.add(
            Job(
                assessment_id=assessment.id,
                tool="prober",
                status=JobStatus.completed,
                raw_output=json.dumps({"status_code": 200, "headers": {"server": "OldNginx/1.10"}}),
            )
        )
        db.commit()
        aid = assessment.id

    payload = {
        "findings": [
            {
                "title": "Outdated Nginx banner suggests unpatched server",
                "description": "Server header reports OldNginx/1.10.",
                "category": "Information disclosure",
                "severity": "medium",
                "confidence": 0.85,
                "remediation": "Upgrade Nginx and hide the Server version.",
                "source_tool": "prober",
                "evidence_excerpt": "Server: OldNginx/1.10",
            }
        ]
    }
    monkeypatch.setattr(
        ai_client,
        "_send_with_retry",
        lambda *_a, **_kw: {"choices": [{"message": {"content": json.dumps(payload)}, "finish_reason": "stop"}]},
    )

    resp = client.post(f"/api/assessments/{aid}/interpret", headers=auth)
    assert resp.status_code == 200
    body = resp.json()
    assert body["created"] == 1
    assert "AI re-interpretation added 1" in body["notes"]


# --- AI Pipeline fixes ------------------------------------------------------


def test_extract_json_text_handles_prose_and_fences():
    prose = 'Sure, here is the JSON result:\n```json\n{"findings": []}\n```\nHope this helps!'
    assert json.loads(extract_json_text(prose)) == {"findings": []}

    bare_prose = 'Analysis complete: {"executive_summary": "All good."}'
    assert json.loads(extract_json_text(bare_prose)) == {"executive_summary": "All good."}


def test_ai_client_captures_openrouter_reasoning_field(monkeypatch):
    with SessionLocal() as db:
        db.execute(delete(LLMTaskConfig))
        db.execute(delete(LLMProvider))
        provider = LLMProvider(name="OR", base_url="https://openrouter.ai/api/v1", api_key_encrypted="", enabled=True)
        db.add(provider)
        db.flush()
        db.add(LLMTaskConfig(task=LLMTask.qa, provider_id=provider.id, model="google/gemini-2.5-pro"))
        db.commit()

        monkeypatch.setattr(
            ai_client,
            "_send_with_retry",
            lambda *_a, **_kw: {
                "choices": [{"message": {"content": "Answer.", "reasoning": "Step-by-step trace"}, "finish_reason": "stop"}]
            },
        )
        res = ai_client.chat(db, LLMTask.qa, [{"role": "user", "content": "hi"}])
        assert res.reasoning_content == "Step-by-step trace"


def test_summarize_retries_and_reporting_passes_deny_list(monkeypatch):
    calls: list[dict] = []
    responses = [
        "not json at all",
        json.dumps({"executive_summary": "Concise verified summary.", "target_overview": "App.", "finding_explanations": []}),
    ]

    def fake_send(_url, _headers, body, _timeout, _transport):
        calls.append(body)
        content = responses[min(len(calls) - 1, len(responses) - 1)]
        return {"choices": [{"message": {"content": content}, "finish_reason": "stop"}]}

    monkeypatch.setattr(ai_client, "_send_with_retry", fake_send)

    with SessionLocal() as db:
        db.execute(delete(LLMTaskConfig))
        db.execute(delete(LLMProvider))
        provider = LLMProvider(name="OR", base_url="https://openrouter.ai/api/v1", api_key_encrypted="", enabled=True)
        db.add(provider)
        db.flush()
        db.add(LLMTaskConfig(task=LLMTask.summary, provider_id=provider.id, model="test-sum"))
        target = Target(
            name="TopSecretInternalApp",
            base_url="http://127.0.0.1:4567",
            authorization_ref="SECRET-REF-999",
            allowed_intensity=ScanIntensity.passive_safe,
        )
        db.add(target)
        db.flush()
        assessment = Assessment(target_id=target.id, intensity=ScanIntensity.passive_safe, categories=[])
        db.add(assessment)
        db.flush()
        finding = Finding(
            assessment_id=assessment.id,
            category="Information disclosure",
            title="Issue on TopSecretInternalApp",
            description="Contains SECRET-REF-999",
            severity=Severity.medium,
            status=FindingStatus.verified,
        )
        db.add(finding)
        db.commit()

        ensure_ai_summary(db, assessment)
        assert len(calls) == 2
        sent_text = json.dumps(calls[0])
        assert "TopSecretInternalApp" not in sent_text
        assert "SECRET-REF-999" not in sent_text
        assert "[REDACTED]" in sent_text


def test_qa_stamps_finding_id_on_audit_row(monkeypatch):
    monkeypatch.setattr(
        ai_client,
        "_send_with_retry",
        lambda *_a, **_kw: {"choices": [{"message": {"content": "Confirmed per evidence."}, "finish_reason": "stop"}]},
    )
    with SessionLocal() as db:
        db.execute(delete(LLMTaskConfig))
        db.execute(delete(LLMProvider))
        provider = LLMProvider(name="OR", base_url="https://openrouter.ai/api/v1", api_key_encrypted="", enabled=True)
        db.add(provider)
        db.flush()
        db.add(LLMTaskConfig(task=LLMTask.qa, provider_id=provider.id, model="test-qa"))
        target = Target(
            name="QATarget",
            base_url="http://127.0.0.1:4321",
            authorization_ref="AUTH-QA-1",
            allowed_intensity=ScanIntensity.passive_safe,
        )
        db.add(target)
        db.flush()
        assessment = Assessment(target_id=target.id, intensity=ScanIntensity.passive_safe, categories=[])
        db.add(assessment)
        db.flush()
        finding = Finding(
            assessment_id=assessment.id,
            category="Information disclosure",
            title="QA Audit Finding",
            description="desc",
            severity=Severity.low,
            status=FindingStatus.ai_candidate,
        )
        db.add(finding)
        db.commit()

        answer_finding_question(db, finding, "Explain this?")
        row = db.query(AIOutput).filter(AIOutput.task == LLMTask.qa, AIOutput.finding_id == finding.id).first()
        assert row is not None
        assert row.finding_id == finding.id


# --- Polish & AI Orchestration tests ---------------------------------------


def test_build_context_digests_large_zap_and_nmap_payloads():
    from app.ai.interpret import build_context

    zap_alerts = [
        {
            "title": f"Low Noise Alert {i % 3}",
            "risk": "low",
            "url": f"http://localhost:3000/page/{i}",
            "evidence": "x" * 200,
        }
        for i in range(60)
    ] + [
        {
            "title": "SQL Injection in Login",
            "risk": "high",
            "url": "http://localhost:3000/rest/user/login",
            "param": "email",
            "cwe": "89",
            "evidence": "SQLITE_ERROR",
        }
    ]
    job = SimpleNamespace(
        tool="zap",
        status=JobStatus.completed,
        raw_output=json.dumps({"mode": "full_intrusive", "alerts": zap_alerts}),
    )
    digest = build_context([job])
    # High-risk alert must appear first despite 60 preceding low-risk alerts
    assert "SQL Injection in Login" in digest
    assert "instances=20" in digest
    assert "cwe=89" in digest


def test_report_renders_ai_target_overview_explanations_and_excludes_fp_roadmap(client, auth):
    from app.reporting import build_report_context, render_report_html

    target = client.post(
        "/api/targets",
        json={
            "name": "ReportPolishApp",
            "base_url": "http://127.0.0.1:3001",
            "authorization_ref": "AUTH-RPT-1",
            "allowed_intensity": "passive_safe",
        },
        headers=auth,
    ).json()

    with SessionLocal() as db:
        assessment = Assessment(
            target_id=target["id"],
            intensity=ScanIntensity.passive_safe,
            categories=["Security configuration & HTTPS"],
            status=AssessmentStatus.completed,
        )
        db.add(assessment)
        db.flush()
        f_verified = Finding(
            assessment_id=assessment.id,
            category="Security configuration & HTTPS",
            title="Missing CSP Header",
            description="No CSP present.",
            severity=Severity.high,
            status=FindingStatus.verified,
            remediation="Add CSP.",
        )
        f_fp = Finding(
            assessment_id=assessment.id,
            category="Exposed files & directories",
            title="Dismissed False Positive",
            description="Not real.",
            severity=Severity.critical,
            status=FindingStatus.false_positive,
            remediation="Do not remediate.",
        )
        db.add_all([f_verified, f_fp])
        db.flush()
        db.add(
            AIOutput(
                task=LLMTask.summary,
                assessment_id=assessment.id,
                model="summary-model",
                content=json.dumps(
                    {
                        "executive_summary": "One verified high-risk header gap.",
                        "target_overview": "Internal demo application on port 3001.",
                        "finding_explanations": [
                            {
                                "title": "Missing CSP Header",
                                "explanation": "Without CSP, injected scripts execute unrestricted.",
                                "remediation": "Deploy strict nonce-based CSP.",
                            }
                        ],
                    }
                ),
            )
        )
        db.commit()

        ctx = build_report_context(db, assessment)
        assert ctx["overall_posture"]["tier"] == "high"  # false_positive critical does not distort posture
        assert ctx["false_positive_count"] == 1
        roadmap_titles = [item["title"] for bucket in ctx["roadmap"].values() for item in bucket]
        assert "Dismissed False Positive" not in roadmap_titles
        assert "Missing CSP Header" in roadmap_titles

        html = render_report_html(db, assessment)
        assert "Internal demo application on port 3001." in html
        assert "Without CSP, injected scripts execute unrestricted." in html
        assert "Deploy strict nonce-based CSP." in html
        assert "Passive / Safe" in html


def test_prioritization_endpoints_and_audit(client, auth, monkeypatch):
    with SessionLocal() as db:
        db.execute(delete(LLMTaskConfig))
        db.execute(delete(LLMProvider))
        provider = LLMProvider(name="PrioMock", base_url="https://mock.test/v1", api_key_encrypted="", enabled=True)
        db.add(provider)
        db.flush()
        db.add(LLMTaskConfig(task=LLMTask.prioritization, provider_id=provider.id, model="prio-model"))
        target = Target(
            name="PrioSecretTarget",
            base_url="http://127.0.0.1:7777",
            authorization_ref="AUTH-PRIO-99",
            allowed_intensity=ScanIntensity.passive_safe,
        )
        db.add(target)
        db.flush()
        assessment = Assessment(
            target_id=target.id,
            intensity=ScanIntensity.passive_safe,
            categories=["Session management"],
            status=AssessmentStatus.completed,
        )
        db.add(assessment)
        db.flush()
        f1 = Finding(
            assessment_id=assessment.id,
            category="Session management",
            title="Cookie missing HttpOnly on PrioSecretTarget",
            description="desc1",
            severity=Severity.low,
            status=FindingStatus.ai_candidate,
        )
        f2 = Finding(
            assessment_id=assessment.id,
            category="Input validation & injection",
            title="Reflected XSS in search",
            description="desc2",
            severity=Severity.high,
            status=FindingStatus.ai_candidate,
        )
        db.add_all([f1, f2])
        db.commit()
        aid, f1_id, f2_id = assessment.id, f1.id, f2.id

    captured: list[dict] = []

    def fake_send(_url, _headers, body, _timeout, _transport):
        captured.append(body)
        return {
            "choices": [
                {
                    "message": {
                        "content": json.dumps(
                            {
                                "rankings": [
                                    {
                                        "finding_id": f2_id,
                                        "rank": 1,
                                        "urgency": "immediate",
                                        "rationale": "Direct script execution enables session theft.",
                                    },
                                    {
                                        "finding_id": f1_id,
                                        "rank": 2,
                                        "urgency": "high",
                                        "rationale": "Amplifies XSS by allowing document.cookie access.",
                                    },
                                ]
                            }
                        )
                    },
                    "finish_reason": "stop",
                }
            ]
        }

    monkeypatch.setattr(ai_client, "_send_with_retry", fake_send)

    post_resp = client.post(f"/api/assessments/{aid}/prioritize", headers=auth)
    assert post_resp.status_code == 200, post_resp.text
    data = post_resp.json()
    assert [r["finding_id"] for r in data["rankings"]] == [f2_id, f1_id]
    assert data["rankings"][0]["urgency"] == "immediate"
    assert "PrioSecretTarget" not in json.dumps(captured)

    # Cached GET returns same ranking without calling LLM again
    get_resp = client.get(f"/api/assessments/{aid}/prioritization", headers=auth)
    assert get_resp.status_code == 200
    assert len(get_resp.json()["rankings"]) == 2
    assert len(captured) == 1

    # Findings remain ai_candidate (never auto-confirmed)
    with SessionLocal() as db:
        assert db.get(Finding, f2_id).status == FindingStatus.ai_candidate


def test_on_demand_summary_endpoint(client, auth, monkeypatch):
    with SessionLocal() as db:
        db.execute(delete(LLMTaskConfig))
        db.execute(delete(LLMProvider))
        provider = LLMProvider(name="SumMock", base_url="https://mock.test/v1", api_key_encrypted="", enabled=True)
        db.add(provider)
        db.flush()
        db.add(LLMTaskConfig(task=LLMTask.summary, provider_id=provider.id, model="sum-model"))
        target = Target(
            name="SumEndpointApp",
            base_url="http://127.0.0.1:7788",
            authorization_ref="AUTH-SUM-1",
            allowed_intensity=ScanIntensity.passive_safe,
        )
        db.add(target)
        db.flush()
        assessment = Assessment(
            target_id=target.id,
            intensity=ScanIntensity.passive_safe,
            categories=["Security configuration & HTTPS"],
            status=AssessmentStatus.completed,
        )
        db.add(assessment)
        db.flush()
        db.add(
            Finding(
                assessment_id=assessment.id,
                category="Security configuration & HTTPS",
                title="Verified Header Gap",
                description="Verified.",
                severity=Severity.medium,
                status=FindingStatus.verified,
            )
        )
        db.commit()
        aid = assessment.id

    monkeypatch.setattr(
        ai_client,
        "_send_with_retry",
        lambda *_a, **_kw: {
            "choices": [
                {
                    "message": {
                        "content": json.dumps(
                            {
                                "executive_summary": "Fresh executive summary.",
                                "target_overview": "Target overview text.",
                                "finding_explanations": [],
                            }
                        )
                    },
                    "finish_reason": "stop",
                }
            ]
        },
    )

    resp = client.post(f"/api/assessments/{aid}/summary", headers=auth)
    assert resp.status_code == 200, resp.text
    assert resp.json()["executive_summary"] == "Fresh executive summary."


def test_nmap_runner_falls_back_to_popen_on_selector_loop(monkeypatch):
    """Under `uvicorn --reload` on Windows, SelectorEventLoop raises
    NotImplementedError on asyncio.create_subprocess_exec. NmapRunner must
    fall back transparently to subprocess.Popen and still parse XML."""
    import io
    from pathlib import Path
    from types import SimpleNamespace
    from unittest.mock import MagicMock

    from app.scanner.base import ScanContext
    from app.scanner.nmap_runner import NmapRunner

    xml_bytes = (
        b'<?xml version="1.0"?>'
        b'<nmaprun><host><address addr="127.0.0.1" addrtype="ipv4"/>'
        b'<ports><port protocol="tcp" portid="3000"><state state="open"/>'
        b'<service name="http" product="Node.js"/></port></ports></host>'
        b'<runstats><finished summary="Nmap done: 1 IP address"/></runstats></nmaprun>'
    )

    class FakePopen:
        def __init__(self, _argv, stdout=None, stderr=None) -> None:
            self.stdout = io.BytesIO(xml_bytes)
            self.stderr = io.BytesIO(b"")
            self.returncode = 0

        def poll(self):
            return self.returncode

        def wait(self):
            return self.returncode

        def kill(self):
            self.returncode = -9

    async def _raise_not_implemented(*_a, **_kw):
        raise NotImplementedError

    monkeypatch.setattr("app.scanner.nmap_runner.shutil.which", lambda _name: "nmap")
    monkeypatch.setattr("app.scanner.nmap_runner.asyncio.create_subprocess_exec", _raise_not_implemented)
    monkeypatch.setattr("app.scanner.nmap_runner.subprocess.Popen", FakePopen)

    job = SimpleNamespace(command="", raw_output=None)
    ctx = ScanContext(
        db=MagicMock(),
        target=SimpleNamespace(
            base_url="http://localhost:3000",
            authorization_ref="TEST-AUTH-NMAP-FALLBACK",
            in_scope_assets=["http://localhost:3000"],
        ),
        assessment=SimpleNamespace(intensity=ScanIntensity.passive_safe),
        job=job,
        emit_log=lambda _line: None,
        emit_progress=lambda _value: None,
        cancelled=lambda: False,
    )

    asyncio.run(NmapRunner().run(ctx))
    parsed = json.loads(job.raw_output)
    assert len(parsed["hosts"]) == 1
    assert parsed["hosts"][0]["address"] == "127.0.0.1"


def test_llm_client_retries_429_with_retry_after_and_backoff(monkeypatch):
    """HTTP 429 gets up to 3 attempts, honoring numeric Retry-After (clamped)
    or exponential backoff (2s, 5s) without breaking single-retry transport errors."""
    import httpx
    from app.ai import client as ai_client

    sleeps: list[float] = []
    monkeypatch.setattr(ai_client.time, "sleep", lambda s: sleeps.append(s))

    attempts = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            return httpx.Response(429, headers={"Retry-After": "3"}, text="rate limited")
        if attempts == 2:
            return httpx.Response(429, text="rate limited")
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": "ok"}, "finish_reason": "stop"}]},
        )

    result = ai_client._send_with_retry(
        "http://mock-provider.test/api/v1",
        {"Content-Type": "application/json"},
        {"model": "test", "messages": []},
        timeout=5.0,
        transport=httpx.MockTransport(handler),
    )
    assert result["choices"][0]["message"]["content"] == "ok"
    assert attempts == 3
    assert sleeps == [3.0, 5.0]


def test_retry_single_job_endpoint_and_intensity_gate(client, auth, monkeypatch):
    """POST /api/assessments/{id}/jobs/{job_id}/retry resets only the chosen job,
    starts single-job retry, and enforces the target intensity gate on zap."""
    from app.api import assessments as assessments_api

    target = client.post(
        "/api/targets",
        json={
            "name": "RetryJobTarget",
            "base_url": "http://127.0.0.1:3002",
            "authorization_ref": "AUTH-RETRY-1",
            "allowed_intensity": "passive_safe",
        },
        headers=auth,
    ).json()

    with SessionLocal() as db:
        assessment = Assessment(
            target_id=target["id"],
            intensity=ScanIntensity.passive_safe,
            categories=["Security configuration & HTTPS"],
            status=AssessmentStatus.completed,
        )
        db.add(assessment)
        db.flush()
        dns_job = Job(
            assessment_id=assessment.id,
            tool="dns",
            status=JobStatus.completed,
            progress=1.0,
            log="dns ok\n",
            raw_output=json.dumps({"records": {"A": ["127.0.0.1"]}}),
        )
        nmap_job = Job(
            assessment_id=assessment.id,
            tool="nmap",
            status=JobStatus.failed,
            progress=0.1,
            log="[error] boom\n",
        )
        zap_job = Job(
            assessment_id=assessment.id,
            tool="zap",
            status=JobStatus.cancelled,
            progress=0.0,
            log="[cancelled]\n",
        )
        db.add_all([dns_job, nmap_job, zap_job])
        db.commit()
        aid, dns_id, nmap_id, zap_id = assessment.id, dns_job.id, nmap_job.id, zap_job.id

    # Intrusive tool retry on a passive_safe target must be rejected with 409
    r_gate = client.post(f"/api/assessments/{aid}/jobs/{zap_id}/retry", headers=auth)
    assert r_gate.status_code == 409

    started: list[tuple[int, int]] = []
    monkeypatch.setattr(assessments_api, "start_job_retry", lambda a_id, j_id: started.append((a_id, j_id)))

    r_retry = client.post(f"/api/assessments/{aid}/jobs/{nmap_id}/retry", headers=auth)
    assert r_retry.status_code == 202, r_retry.text
    body = r_retry.json()
    assert body["status"] == "running"
    assert started == [(aid, nmap_id)]

    jobs_by_id = {j["id"]: j for j in body["jobs"]}
    # Only nmap was reset; dns stayed completed with its original log intact
    assert jobs_by_id[nmap_id]["status"] == "pending"
    assert jobs_by_id[nmap_id]["log"] == ""
    assert jobs_by_id[dns_id]["status"] == "completed"
    assert jobs_by_id[dns_id]["log"] == "dns ok\n"


