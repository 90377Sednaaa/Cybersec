"""Interpreter tests (M2 T2.4).

Fixture-driven: raw prober/ZAP payloads go in, candidate findings come out,
against a monkeypatched provider transport (no network). Pipeline-level test
exercises the real orchestrator hook end-to-end.
"""

import asyncio
import functools
import http.server
import json
import threading

import pytest
from pydantic import ValidationError

import app.ai.client as ai_client
import app.scanner.orchestrator as ai_orch
from app.ai.interpret import (
    CandidateFinding,
    interpret_assessment,
    build_context,
)
from app.database import SessionLocal
from app.models import (
    AIOutput,
    Assessment,
    Finding,
    FindingStatus,
    Job,
    JobStatus,
    LLMTask,
    ScanIntensity,
    Severity,
    Target,
)
from app.models.llm import LLMTaskConfig, LLMProvider
from tests.test_llm_client import completion_body

INDEX_HTML = b"<html><head><title>Interp App</title></head><body>hi</body></html>"


class _Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        self.wfile.write(INDEX_HTML)

    def log_message(self, *args):  # silence output
        pass


@pytest.fixture()
def local_site():
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(_Handler))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}"
    finally:
        server.shutdown()


PROBER_RAW = json.dumps(
    {
        "status_code": 200,
        "headers": {"server": "TestServer/1.0", "authorization": "Bearer ayJraw-token-abc123"},
        "candidate_findings": [{"title": "Missing security header: content-security-policy", "severity": "low", "category": "Security configuration & HTTPS"}],
    }
)

ZAP_RAW = json.dumps(
    {
        "alerts": [
            {"title": "Path Traversal", "risk": "high", "description": "d", "solution": "s", "evidence": "/backup.zip"},
        ]
    }
)

AI_OUTPUT = {
    "findings": [
        {
            "title": "AI: stacked banner leak suggests outdated stack",
            "description": "Server banner + missing headers together indicate an unpatched stack.",
            "category": "Security configuration & HTTPS",
            "severity": "medium",
            "confidence": 0.7,
            "remediation": "Update the server and add security headers.",
        },
        {
            "title": "AI: exposed backup archive may contain source",
            "description": "/backup.zip could leak source and configuration.",
            "category": "Exposed files & directories",
            "severity": "high",
            "confidence": 0.8,
            "remediation": "Remove the archive from the webroot.",
        },
        {
            "title": "AI: bearer-style token seen in headers",
            "description": "A header pattern consistent with credentials; investigate leakage.",
            "category": "Information disclosure",
            "severity": "critical",
            "confidence": 0.6,
            "remediation": "Rotate any leaked credential immediately.",
        },
    ]
}


def _assessment_with_raw_jobs():
    with SessionLocal() as db:
        target = Target(
            name="interp-target",
            base_url="http://127.0.0.1:9876",
            authorization_ref="TEST-AUTH-INTERP",
            in_scope_assets=["http://127.0.0.1:9876"],
            allowed_intensity=ScanIntensity.passive_safe,
        )
        db.add(target)
        db.flush()
        assessment = Assessment(target_id=target.id, intensity=ScanIntensity.passive_safe, categories=[])
        db.add(assessment)
        db.flush()
        # SQLite reuses rowids after the newest rows are deleted, so a recycled
        # assessment id could otherwise inherit another test's audit rows.
        db.query(AIOutput).filter(AIOutput.assessment_id == assessment.id).delete()
        ids = []
        for tool, raw in (("prober", PROBER_RAW), ("zap", ZAP_RAW)):
            job = Job(assessment_id=assessment.id, tool=tool, status=JobStatus.pending)
            db.add(job)
            db.flush()
            job.status = JobStatus.completed
            job.raw_output = raw
            ids.append(job.id)
        db.commit()
        return target.id, assessment.id, ids


@pytest.fixture()
def interpreter_configured():
    """Enabled provider + interpretation task model, like a configured Settings row."""
    with SessionLocal() as db:
        from sqlalchemy import delete

        db.execute(delete(LLMTaskConfig))
        db.execute(delete(LLMProvider))
        provider = LLMProvider(
            name="OpenRouter",
            base_url="http://mock-provider.test/api/v1",
            api_key_encrypted="",
            enabled=True,
        )
        db.add(provider)
        db.flush()
        cfg = LLMTaskConfig(task=LLMTask.interpretation, provider_id=provider.id, model="test-model")
        db.add(cfg)
        db.commit()
    yield
    with SessionLocal() as db:
        from sqlalchemy import delete

        db.execute(delete(LLMTaskConfig))
        db.execute(delete(LLMProvider))
        db.commit()


def _patch_llm(monkeypatch, contents: list[str]):
    """Queue of canned completion bodies; the last one repeats forever."""
    requests: list[dict] = []

    def fake_send_with_retry(base_url, headers, body, timeout, transport):
        requests.append(body)
        content = contents[min(len(requests) - 1, len(contents) - 1)]
        return {"choices": [{"message": {"content": content}, "finish_reason": "stop"}]}

    monkeypatch.setattr(ai_client, "_send_with_retry", fake_send_with_retry)
    return requests


def test_interpret_produces_candidate_findings(interpreter_configured, monkeypatch):
    _target_id, assessment_id, _jobs = _assessment_with_raw_jobs()
    _patch_llm(monkeypatch, [json.dumps(AI_OUTPUT)])

    with SessionLocal() as db:
        assessment = db.get(Assessment, assessment_id)
        jobs = list(assessment.jobs)
        created = interpret_assessment(db, assessment, jobs)
        assert created == 3
        findings = db.query(Finding).filter(Finding.assessment_id == assessment_id).all()
        assert len(findings) == 3
        for f in findings:
            assert f.status == FindingStatus.ai_candidate
            assert f.verified_by_id is None
            assert f.title.startswith("AI:")
        by_title = {f.title: f for f in findings}
        assert by_title["AI: exposed backup archive may contain source"].severity == Severity.high
        assert 0.0 <= by_title["AI: exposed backup archive may contain source"].ai_confidence <= 1.0


def test_interpret_skips_duplicate_titles(interpreter_configured, monkeypatch):
    from app.scanner.normalize import create_candidate

    _target_id, assessment_id, _jobs = _assessment_with_raw_jobs()
    with SessionLocal() as db:
        assessment = db.get(Assessment, assessment_id)
        jobs = list(assessment.jobs)
        create_candidate(
            db,
            assessment,
            jobs[0],
            category="Exposed files & directories",
            title="AI: exposed backup archive may contain source",  # the interpreter will also emit this
            description="rule-based",
            severity=Severity.low,
        )
        db.commit()
    _patch_llm(monkeypatch, [json.dumps(AI_OUTPUT)])

    with SessionLocal() as db:
        assessment = db.get(Assessment, assessment_id)
        created = interpret_assessment(db, assessment, list(assessment.jobs))
        assert created == 2
        count = db.query(Finding).filter(Finding.assessment_id == assessment_id, Finding.title == "AI: exposed backup archive may contain source").count()
        assert count == 1  # dedup by (assessment, title), no collision with the rule-based finding


def test_interpret_retries_repairable_json(interpreter_configured, monkeypatch):
    """First reply is fenced/drivel, the repair-retry asks again - the pipeline survives."""
    _target_id, assessment_id, _jobs = _assessment_with_raw_jobs()
    requests = _patch_llm(
        monkeypatch,
        ['return in prose', '```json\n' + json.dumps(AI_OUTPUT) + '\n```'],
    )
    with SessionLocal() as db:
        assessment = db.get(Assessment, assessment_id)
        created = interpret_assessment(db, assessment, list(assessment.jobs))
    assert created == 3
    assert len(requests) == 2
    assert "Return ONLY the JSON object" in requests[1]["messages"][-1]["content"]


def test_interpret_unrepairable_output_degrades_gracefully(interpreter_configured, monkeypatch):
    _target_id, assessment_id, _jobs = _assessment_with_raw_jobs()
    _patch_llm(monkeypatch, ["no JSON here"])
    with SessionLocal() as db:
        assessment = db.get(Assessment, assessment_id)
        created = interpret_assessment(db, assessment, list(assessment.jobs))
        assert created == 0
        note = db.get(Assessment, assessment_id).notes
    assert "AI interpretation failed" in note


def test_findings_from_unparseable_models_never_marked_verified(interpreter_configured, monkeypatch):
    """Even AI output rendered verified=False: confirmed status requires a human."""
    _target_id, assessment_id, _jobs = _assessment_with_raw_jobs()
    _patch_llm(monkeypatch, [json.dumps(AI_OUTPUT)])
    with SessionLocal() as db:
        assessment = db.get(Assessment, assessment_id)
        interpret_assessment(db, assessment, list(assessment.jobs))
        findings = db.query(Finding).filter(Finding.assessment_id == assessment_id).all()
    assert all(f.status != FindingStatus.verified for f in findings)


def test_interpret_drops_low_confidence_and_bad_severity(interpreter_configured, monkeypatch):
    payload = {
        "findings": [
            {"title": "Weak #1", "description": "x", "severity": "high", "confidence": 0.1},
            {"title": "Weak #2", "description": "x", "severity": "apocalypse", "confidence": 0.9},
            {"title": "Valid", "description": "x", "severity": "medium", "confidence": 0.8},
        ]
    }
    _target_id, assessment_id, _jobs = _assessment_with_raw_jobs()
    _patch_llm(monkeypatch, [json.dumps(payload)])
    with SessionLocal() as db:
        assessment = db.get(Assessment, assessment_id)
        interpret_assessment(db, assessment, list(assessment.jobs))
        findings = {f.title: f for f in db.query(Finding).filter(Finding.assessment_id == assessment_id)}
    assert "Weak #1" not in findings  # below the 0.3 floor, dropped
    assert findings["Weak #2"].severity == Severity.low  # invalid suggestion clamped conservatively
    assert findings["Valid"].severity == Severity.medium


def test_interpret_prompts_are_redacted(interpreter_configured, monkeypatch):
    """Raw outputs planted with secrets arrive at the provider already redacted."""
    _target_id, assessment_id, _jobs = _assessment_with_raw_jobs()
    requests = _patch_llm(monkeypatch, [json.dumps(AI_OUTPUT)])
    with SessionLocal() as db:
        assessment = db.get(Assessment, assessment_id)
        interpret_assessment(db, assessment, list(assessment.jobs), deny_list=["127.0.0.1:9876"])
    sent = json.dumps(requests)
    assert "[REDACTED]" in sent
    assert "Bearer ayJraw-token-abc123" not in sent
    assert "127.0.0.1:9876" not in sent


def test_interpret_silent_to_missing_config(monkeypatch):
    """AI interpretation is off by default - NoProviderConfigured is a 0, not a crash."""
    with SessionLocal() as db:
        from sqlalchemy import delete

        db.execute(delete(LLMTaskConfig))
        db.execute(delete(LLMProvider))
        db.commit()
    _target_id, assessment_id, _jobs = _assessment_with_raw_jobs()
    with SessionLocal() as db:
        assessment = db.get(Assessment, assessment_id)
        assert interpret_assessment(db, assessment, list(assessment.jobs)) == 0


def test_build_context_includes_completed_jobs_only():
    _target_id, assessment_id, _jobs = _assessment_with_raw_jobs()
    with SessionLocal() as db:
        assessment = db.get(Assessment, assessment_id)
        context = build_context(list(assessment.jobs))
    assert "prober" in context
    assert "zap" in context


def test_pipeline_runs_ai_interpretation_after_normalize(local_site, interpreter_configured, monkeypatch):
    """Level above the unit tests: the real orchestrator hook runs post-normalize,
    adds AI candidates on top of rule-based ones, and completes the assessment
    even if the AI layer is misconfigured."""
    _patch_llm(monkeypatch, [json.dumps(AI_OUTPUT)])
    with SessionLocal() as db:
        target = Target(
            name="pipe-ai",
            base_url=local_site,
            authorization_ref="TEST-AUTH-PIPE-AI",
            in_scope_assets=[local_site],
            allowed_intensity=ScanIntensity.passive_safe,
        )
        db.add(target)
        db.flush()
        assessment = Assessment(target_id=target.id, intensity=ScanIntensity.passive_safe, categories=[])
        db.add(assessment)
        db.commit()
        assessment_id = assessment.id
        target_id = target.id

    handle = ai_orch.PipelineHandle(assessment_id)
    asyncio.run(ai_orch.run_pipeline(assessment_id, handle))

    with SessionLocal() as db:
        from app.models import AssessmentStatus

        assessment = db.get(Assessment, assessment_id)
        assert assessment.status == AssessmentStatus.completed
        assert assessment.notes.endswith("AI interpretation added 3 candidate finding(s).")
        ai_findings = db.query(Finding).filter(Finding.assessment_id == assessment_id, Finding.title.startswith("AI:")).count()
        assert ai_findings == 3
        # cleanup
        for job in assessment.jobs:
            db.delete(job)
        for finding in db.query(Finding).filter(Finding.assessment_id == assessment_id):
            db.delete(finding)
        db.delete(assessment)
        db.delete(db.get(Target, target_id))
        db.commit()


def test_pipeline_completes_when_ai_is_down(local_site, interpreter_configured, monkeypatch):
    """Provider outage: pipeline still completes; a note records the skip."""
    _patch_llm(monkeypatch, ['not json'])
    with SessionLocal() as db:
        target = Target(
            name="pipe-ai-down",
            base_url=local_site,
            authorization_ref="TEST-AUTH-PIPE-DOWN",
            in_scope_assets=[local_site],
            allowed_intensity=ScanIntensity.passive_safe,
        )
        db.add(target)
        db.flush()
        assessment = Assessment(target_id=target.id, intensity=ScanIntensity.passive_safe, categories=[])
        db.add(assessment)
        db.commit()
        assessment_id = assessment.id
        target_id = target.id

    handle = ai_orch.PipelineHandle(assessment_id)
    asyncio.run(ai_orch.run_pipeline(assessment_id, handle))

    with SessionLocal() as db:
        from app.models import AssessmentStatus

        assessment = db.get(Assessment, assessment_id)
        assert assessment.status == AssessmentStatus.completed
        assert "AI interpretation failed" in assessment.notes
        for job in assessment.jobs:
            db.delete(job)
        for finding in db.query(Finding).filter(Finding.assessment_id == assessment_id):
            db.delete(finding)
        db.delete(assessment)
        db.delete(db.get(Target, target_id))
        db.commit()


# --- Wave 4 regression: F-16 (interpretation audit trail) -----------------------

def _interpretation_outputs(assessment_id: int) -> list[AIOutput]:
    with SessionLocal() as db:
        return list(
            db.query(AIOutput)
            .filter(
                AIOutput.assessment_id == assessment_id,
                AIOutput.task == LLMTask.interpretation,
            )
            .order_by(AIOutput.id)
        )


def test_interpretation_writes_an_ai_output_row(interpreter_configured, monkeypatch):
    """models/llm.py promises an ai_outputs row per AI task; interpretation wrote
    none, so the evidence pack could not show what the interpreter answered."""
    _target_id, assessment_id, _jobs = _assessment_with_raw_jobs()
    _patch_llm(monkeypatch, [json.dumps(AI_OUTPUT)])

    with SessionLocal() as db:
        assessment = db.get(Assessment, assessment_id)
        interpret_assessment(db, assessment, list(assessment.jobs))

    rows = _interpretation_outputs(assessment_id)
    assert len(rows) == 1
    assert rows[0].model == "test-model"
    assert "AI: stacked banner leak" in rows[0].content
    assert rows[0].finding_id is None  # assessment-level, kept apart from findings


def test_interpretation_retry_records_each_model_answer(interpreter_configured, monkeypatch):
    _target_id, assessment_id, _jobs = _assessment_with_raw_jobs()
    _patch_llm(monkeypatch, ["return in prose", json.dumps(AI_OUTPUT)])

    with SessionLocal() as db:
        assessment = db.get(Assessment, assessment_id)
        assert interpret_assessment(db, assessment, list(assessment.jobs)) == 3

    rows = _interpretation_outputs(assessment_id)
    assert len(rows) == 2  # the unusable answer is evidence too
    assert rows[0].content == "return in prose"
    assert "AI: stacked banner leak" in rows[1].content


def test_interpretation_failure_is_recorded(interpreter_configured, monkeypatch):
    """An empty ai_outputs table must never mean 'the AI was never asked'."""
    _target_id, assessment_id, _jobs = _assessment_with_raw_jobs()
    _patch_llm(monkeypatch, ["no JSON here"])

    with SessionLocal() as db:
        assessment = db.get(Assessment, assessment_id)
        assert interpret_assessment(db, assessment, list(assessment.jobs)) == 0

    rows = _interpretation_outputs(assessment_id)
    assert len(rows) == 4  # three attempts plus the terminal failure row
    assert any("unparseable" in row.content for row in rows)


def test_no_provider_writes_no_output_row(monkeypatch):
    """No configured provider means nothing was asked; that is not an AI output."""
    from sqlalchemy import delete

    with SessionLocal() as db:
        db.execute(delete(LLMTaskConfig))
        db.execute(delete(LLMProvider))
        db.commit()

    _target_id, assessment_id, _jobs = _assessment_with_raw_jobs()
    with SessionLocal() as db:
        assessment = db.get(Assessment, assessment_id)
        assert interpret_assessment(db, assessment, list(assessment.jobs)) == 0

    assert _interpretation_outputs(assessment_id) == []
