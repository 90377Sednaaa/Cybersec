"""Summarizer tests (M2 T2.5). Mocked provider, no network.

Core claim: summaries come from VERIFIED findings only - the hard filter is
what keeps the report honest (an unconfirmed candidate must never reach the
executive narrative). Outputs are audited into ai_outputs.
"""

import json

import pytest
from sqlalchemy import delete

import app.ai.client as ai_client
from app.ai.summarize import summarize_assessment, verified_findings_for
from app.database import SessionLocal
from app.models import (
    AIOutput,
    Assessment,
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
from app.models.llm import LLMTaskConfig


SUMMARY_JSON = json.dumps(
    {
        "executive_summary": "Assessment of the authorized lab target confirmed 1 verified finding; overall risk is moderate.",
        "target_overview": "Local Juice Shop instance used for the assessment.",
        "finding_explanations": [
            {"title": "Backup archive exposed", "explanation": "The archive is reachable and may leak source.", "remediation": "Remove and rotate."}
        ],
    }
)


@pytest.fixture()
def summarizer_configured():
    with SessionLocal() as db:
        db.query(AIOutput).delete()
        db.query(LLMTaskConfig).delete()
        db.query(LLMProvider).delete()
        provider = LLMProvider(name="OpenRouter", base_url="http://mock-provider.test/api/v1", enabled=True)
        db.add(provider)
        db.flush()
        db.add(LLMTaskConfig(task=LLMTask.summary, provider_id=provider.id, model="reasoning-model"))
        db.commit()
    yield
    with SessionLocal() as db:
        db.query(AIOutput).delete()
        db.query(LLMTaskConfig).delete()
        db.query(LLMProvider).delete()
        db.commit()


def _assessment_with_findings():
    with SessionLocal() as db:
        target = Target(name="sum-target", base_url="http://127.0.0.1:9876", allowed_intensity=ScanIntensity.passive_safe)
        db.add(target)
        db.flush()
        assessment = Assessment(target_id=target.id, intensity=ScanIntensity.passive_safe, categories=[])
        db.add(assessment)
        db.flush()
        job = Job(assessment_id=assessment.id, tool="prober", status=JobStatus.completed)
        db.add(job)
        verified = Finding(
            assessment_id=assessment.id,
            source_job_id=job.id,
            category="Exposed files & directories",
            title="Backup archive exposed",
            description="desc",
            severity=Severity.high,
            status=FindingStatus.verified,
            verified_at=None,
        )
        candidate = Finding(
            assessment_id=assessment.id,
            source_job_id=job.id,
            category="Information disclosure",
            title="Candidate-only danger",
            description="must not reach the summary",
            severity=Severity.info,
            status=FindingStatus.ai_candidate,
        )
        db.add_all([verified, candidate])
        db.commit()
        return assessment.id, verified.id, candidate.id, verified.title


def _patch_llm(monkeypatch, content: str):
    requests = []

    def fake_send_with_retry(base_url, headers, body, timeout, transport):
        requests.append(body)
        return {
            "choices": [
                {
                    "message": {"role": "assistant", "content": content, "reasoning_content": "thinking about the exposure"},
                    "finish_reason": "stop",
                }
            ]
        }

    monkeypatch.setattr(ai_client, "_send_with_retry", fake_send_with_retry)
    return requests


def test_summary_uses_verified_findings_only(summarizer_configured, monkeypatch):
    assessment_id, verified_id, candidate_id, verified_title = _assessment_with_findings()
    requests = _patch_llm(monkeypatch, SUMMARY_JSON)
    with SessionLocal() as db:
        assessment = db.get(Assessment, assessment_id)
        findings = list(db.query(Finding).filter(Finding.assessment_id == assessment_id))
        summary = summarize_assessment(db, assessment, findings)
        assert summary is not None
        assert summary["executive_summary"].startswith("Assessment of the authorized lab target")
        sent = json.dumps(requests)
        assert "Backup archive exposed" in sent          # verified: included
        assert "Candidate-only danger" not in sent       # ai_candidate: hard-filtered from the prompt


def test_verified_findings_for_loader(summarizer_configured):
    assessment_id, verified_id, candidate_id, verified_title = _assessment_with_findings()
    with SessionLocal() as db:
        findings = verified_findings_for(db, assessment_id)
    assert [f.id for f in findings] == [verified_id]


def test_no_verified_findings_returns_none_without_call(summarizer_configured, monkeypatch):
    with SessionLocal() as db:
        target = Target(name="empty", base_url="http://127.0.0.1:9876", allowed_intensity=ScanIntensity.passive_safe)
        db.add(target)
        db.flush()
        assessment = Assessment(target_id=target.id, intensity=ScanIntensity.passive_safe, categories=[])
        db.add(assessment)
        db.commit()
        assessment_id = assessment.id
    requests = _patch_llm(monkeypatch, SUMMARY_JSON)
    with SessionLocal() as db:
        assessment = db.get(Assessment, assessment_id)
        assert summarize_assessment(db, assessment, []) is None
    assert not requests


def test_summary_outputs_audited_to_ai_outputs(summarizer_configured, monkeypatch):
    assessment_id, verified_id, candidate_id, verified_title = _assessment_with_findings()
    _patch_llm(monkeypatch, SUMMARY_JSON)
    with SessionLocal() as db:
        assessment = db.get(Assessment, assessment_id)
        findings = list(db.query(Finding).filter(Finding.assessment_id == assessment_id))
        summarize_assessment(db, assessment, findings, deny_list=["127.0.0.1:9876"])
        rows = list(db.query(AIOutput).all())
        assert all(r.task == LLMTask.summary for r in rows)
        assert all(r.model == "reasoning-model" for r in rows)
        assessment_summaries = [r for r in rows if r.finding_id is None]
        finding_summaries = [r for r in rows if r.finding_id == verified_id]
        assert len(assessment_summaries) == 1
        assert "executive_summary" in json.loads(assessment_summaries[0].content)
        assert len(finding_summaries) == 1
        assert "Bank" not in str([r.content for r in finding_summaries])
        clean = db.query(AIOutput).count()
    assert clean >= 2  # one whole-assessment row + one per finding, persisted


def test_reasoning_content_never_pollutes_summary(summarizer_configured, monkeypatch):
    assessment_id, verified_id, candidate_id, verified_title = _assessment_with_findings()
    _patch_llm(monkeypatch, SUMMARY_JSON)
    with SessionLocal() as db:
        assessment = db.get(Assessment, assessment_id)
        findings = list(db.query(Finding).filter(Finding.assessment_id == assessment_id))
        summary = summarize_assessment(db, assessment, findings)
    assert "thinking about" not in json.dumps(summary)


def test_fenced_summary_json_is_parsed():
    """Regression (F-12): a model wrapping JSON in ```json ... ``` used to fail
    with "Extra data" because only the opening fence was stripped."""
    from app.ai.summarize import _parse_summary

    summary = _parse_summary("```json\n" + SUMMARY_JSON + "\n```")
    assert summary is not None
    assert summary["executive_summary"].startswith("Assessment of the authorized lab target")
    assert _parse_summary(SUMMARY_JSON) is not None  # unfenced still works


def test_summarizer_accepts_fenced_json_end_to_end(summarizer_configured, monkeypatch):
    assessment_id, _verified_id, _candidate_id, _title = _assessment_with_findings()
    _patch_llm(monkeypatch, "```json\n" + SUMMARY_JSON + "\n```")
    with SessionLocal() as db:
        assessment = db.get(Assessment, assessment_id)
        findings = list(db.query(Finding).filter(Finding.assessment_id == assessment_id))
        summary = summarize_assessment(db, assessment, findings)
    assert summary is not None
    assert "executive_summary" in summary


def test_unparseable_output_raises_request_error_not_silent_bad_summary(summarizer_configured, monkeypatch):
    assessment_id, verified_id, candidate_id, verified_title = _assessment_with_findings()
    _patch_llm(monkeypatch, "I will describe the findings in prose...")  # no JSON at all
    with SessionLocal() as db:
        assessment = db.get(Assessment, assessment_id)
        findings = list(db.query(Finding).filter(Finding.assessment_id == assessment_id))
        import pytest as _pytest

        with _pytest.raises(ai_client.LLMRequestError):
            summarize_assessment(db, assessment, findings)


def test_summarize_silent_when_config_missing(monkeypatch):
    with SessionLocal() as db:
        db.query(AIOutput).delete()
        db.query(LLMTaskConfig).delete()
        db.query(LLMProvider).delete()
        db.commit()
    assessment_id, verified_id, candidate_id, verified_title = _assessment_with_findings()
    with SessionLocal() as db, pytest.raises(ai_client.NoProviderConfigured):
        assessment = db.get(Assessment, assessment_id)
        findings = list(db.query(Finding).filter(Finding.assessment_id == assessment_id))
        summarize_assessment(db, assessment, findings)
