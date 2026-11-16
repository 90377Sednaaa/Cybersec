"""Tests for Finding Q&A (M2 T2.6 stretch).

Verifies evidence-grounded Q&A, reasoning extraction, redaction of sensitive
terms in question/evidence, and failure degradation when no provider is configured.
"""

from __future__ import annotations

import json
from datetime import datetime

import httpx
import pytest
from sqlalchemy import delete, select

import app.ai.client as ai_client
from app.ai.qa import answer_finding_question
from app.database import SessionLocal
from app.models import (
    AIOutput,
    Assessment,
    Evidence,
    EvidenceKind,
    Finding,
    FindingStatus,
    Job,
    JobStatus,
    LLMProvider,
    LLMTask,
    ScanIntensity,
    Severity,
    Target,
)
from app.models.llm import LLMTaskConfig, encrypt_secret
from app.schemas.findings import FindingQAMessage, FindingQARequest, FindingQAResponse

OPENROUTER_BASE = "http://mock-provider.test/api/v1"
MODEL = "deepseek/deepseek-r1"


def _mock_transport(handler):
    return httpx.MockTransport(handler)


@pytest.fixture()
def qa_configured():
    with SessionLocal() as db:
        db.execute(delete(AIOutput))
        db.execute(delete(LLMTaskConfig))
        db.execute(delete(LLMProvider))
        provider = LLMProvider(
            name="OpenRouter",
            base_url=OPENROUTER_BASE,
            api_key_encrypted=encrypt_secret("sk-test-live-key"),
            enabled=True,
        )
        db.add(provider)
        db.flush()
        db.add(LLMTaskConfig(task=LLMTask.qa, provider_id=provider.id, model=MODEL))
        db.commit()
    yield
    with SessionLocal() as db:
        db.execute(delete(AIOutput))
        db.execute(delete(LLMTaskConfig))
        db.execute(delete(LLMProvider))
        db.commit()


@pytest.fixture()
def sample_finding():
    with SessionLocal() as db:
        target = Target(name="test-target", base_url="http://127.0.0.1:8000", allowed_intensity=ScanIntensity.passive_safe)
        db.add(target)
        db.flush()
        assessment = Assessment(target_id=target.id, intensity=ScanIntensity.passive_safe, categories=[])
        db.add(assessment)
        db.flush()
        job = Job(assessment_id=assessment.id, tool="prober", status=JobStatus.completed)
        db.add(job)
        db.flush()
        finding = Finding(
            assessment_id=assessment.id,
            source_job_id=job.id,
            category="Security configuration and HTTPS",
            title="Missing Content-Security-Policy Header",
            description="The HTTP response lacks a Content-Security-Policy header, increasing XSS risk.",
            severity=Severity.medium,
            status=FindingStatus.ai_candidate,
            remediation="Configure a restrictive Content-Security-Policy header in the web server.",
        )
        db.add(finding)
        db.flush()
        ev1 = Evidence(
            finding_id=finding.id,
            kind=EvidenceKind.http_transcript,
            label="HTTP Response Headers",
            content="HTTP/1.1 200 OK\nServer: nginx/1.18.0\nContent-Type: text/html\n\n<html><body>Test</body></html>",
            tool="prober",
        )
        db.add(ev1)
        db.commit()
        return finding.id, ev1.id


def test_answer_finding_question_success(qa_configured, sample_finding):
    finding_id, ev_id = sample_finding
    recorded_requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.read())
        recorded_requests.append(body)
        return httpx.Response(
            200,
            json={
                "id": "chatcmpl-qa-1",
                "choices": [
                    {
                        "message": {
                            "role": "assistant",
                            "content": f"Based on [Evidence #{ev_id}], the server returned no Content-Security-Policy header.",
                            "reasoning_content": "Examined the headers in Evidence and confirmed CSP is absent.",
                        },
                        "finish_reason": "stop",
                    }
                ],
            },
        )

    with SessionLocal() as db:
        finding = db.get(Finding, finding_id)
        res = answer_finding_question(
            db,
            finding,
            "Does the HTTP evidence show a missing CSP header?",
            history=[FindingQAMessage(role="user", content="Hello")],
            deny_list=["test-target"],
            transport=_mock_transport(handler),
        )

        assert "Content-Security-Policy" in res["answer"]
        assert res["reasoning"] == "Examined the headers in Evidence and confirmed CSP is absent."
        assert res["grounded_evidence_ids"] == [ev_id]
        assert res["model"] == MODEL

        # Check prompt sent to transport
        assert len(recorded_requests) == 1
        messages = recorded_requests[0]["messages"]
        system_msg = next(m["content"] for m in messages if m["role"] == "system")
        assert "Missing Content-Security-Policy Header" in system_msg
        assert f"Evidence #{ev_id}" in system_msg

        # Check ai_outputs audit record
        audit = db.scalar(select(AIOutput).where(AIOutput.task == LLMTask.qa))
        assert audit is not None
        assert audit.assessment_id == finding.assessment_id
        content_json = json.loads(audit.content)
        assert content_json["question"] == "Does the HTTP evidence show a missing CSP header?"
        assert res["answer"] in content_json["answer"]


def test_answer_finding_question_redaction(qa_configured, sample_finding):
    finding_id, _ = sample_finding
    recorded_requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        recorded_requests.append(json.loads(request.read()))
        return httpx.Response(
            200,
            json={"choices": [{"message": {"role": "assistant", "content": "Evidence reviewed."}}]},
        )

    with SessionLocal() as db:
        finding = db.get(Finding, finding_id)
        # Add secret to question and evidence
        secret = "super_secret_auth_token_xyz"
        res = answer_finding_question(
            db,
            finding,
            f"Why is Bearer {secret} in the request?",
            deny_list=["super_secret_auth_token_xyz"],
            transport=_mock_transport(handler),
        )

        assert res["answer"] == "Evidence reviewed."
        payload_str = json.dumps(recorded_requests[0])
        assert secret not in payload_str
        assert "[REDACTED" in payload_str


def test_answer_finding_question_no_provider():
    with SessionLocal() as db:
        db.execute(delete(LLMTaskConfig))
        db.execute(delete(LLMProvider))
        db.commit()

        finding = Finding(id=999, assessment_id=1, title="Test", severity=Severity.low, status=FindingStatus.ai_candidate)
        with pytest.raises(ai_client.NoProviderConfigured):
            answer_finding_question(db, finding, "Is this vulnerable?")
