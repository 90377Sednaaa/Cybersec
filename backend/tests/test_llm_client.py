"""Unit tests for the OpenAI-compatible LLM client (M2 T2.1).

Everything runs against an httpx.MockTransport - no network access.
Provider/task config rows are seeded directly into the test DB.
"""

import json
import re

import httpx
import pytest
from sqlalchemy import delete, select

from app.ai import client as ai_client
from app.ai.client import ChatResult, LLMRequestError, NoProviderConfigured, chat
from app.database import SessionLocal
from app.models.llm import LLMProvider, LLMTask, LLMTaskConfig, encrypt_secret


OPENROUTER_BASE = "http://mock-provider.test/api/v1"
MODEL = "test-model"


def completion_body(content="ok", finish="stop", reasoning=None):
    message = {"role": "assistant", "content": content}
    if reasoning is not None:
        message["reasoning_content"] = reasoning
    return {
        "id": "chatcmpl-1",
        "choices": [{"index": 0, "message": message, "finish_reason": finish}],
    }


@pytest.fixture()
def provider():
    """An enabled provider + interpretation task config, wired to the mock base URL."""
    with SessionLocal() as db:
        db.execute(delete(LLMTaskConfig))
        db.execute(delete(LLMProvider))
        row = LLMProvider(
            name="OpenRouter",
            base_url=OPENROUTER_BASE,
            api_key_encrypted=encrypt_secret("sk-test-secret-key"),
            enabled=True,
        )
        db.add(row)
        db.flush()
        db.add(
            LLMTaskConfig(
                task=LLMTask.interpretation,
                provider_id=row.id,
                model=MODEL,
                temperature=0.2,
            )
        )
        db.commit()
        yield row


def _transport(handler) -> httpx.MockTransport:
    return httpx.MockTransport(handler)


def test_chat_returns_content_and_latency(provider):
    requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json=completion_body(content="hello"))

    with SessionLocal() as db:
        result = chat(
            db,
            LLMTask.interpretation,
            [{"role": "user", "content": "ping"}],
            transport=_transport(handler),
        )
    assert isinstance(result, ChatResult)
    assert result.content == "hello"
    assert result.model == MODEL
    assert result.latency_ms >= 0
    assert len(requests) == 1
    req = requests[0]
    assert req.method == "POST"
    assert re.search(r"/chat/completions$", str(req.url))
    body = json.loads(req.content)
    assert body["model"] == MODEL
    assert body["temperature"] == 0.2
    assert body["messages"] == [{"role": "user", "content": "ping"}]


def test_reasoning_model_omits_temperature_and_sets_reasoning_effort():
    requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json=completion_body())

    with SessionLocal() as db:
        db.execute(delete(LLMTaskConfig))
        db.execute(delete(LLMProvider))
        row = LLMProvider(name="OpenAI", base_url="http://mock-provider.test/api/v1", api_key_encrypted=encrypt_secret("sk-test"), enabled=True)
        db.add(row)
        db.flush()
        db.add(LLMTaskConfig(task=LLMTask.interpretation, provider_id=row.id, model="o3-mini", temperature=0.8))
        db.commit()

        chat(db, LLMTask.interpretation, [{"role": "user", "content": "solve"}], transport=_transport(handler))

    assert len(requests) == 1
    body = json.loads(requests[0].content)
    assert body["model"] == "o3-mini"
    assert "temperature" not in body
    assert body["reasoning_effort"] == "high"


def test_chat_sends_bearer_key_never_plaintext_in_logs(provider, caplog):
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["auth"] = request.headers.get("Authorization")
        return httpx.Response(200, json=completion_body())

    with SessionLocal() as db:
        chat(db, LLMTask.interpretation, [{"role": "user", "content": "hi"}], transport=_transport(handler))
    assert seen["auth"] == "Bearer sk-test-secret-key"
    assert "sk-test-secret-key" not in caplog.text


def test_no_auth_header_without_stored_key_ollama_profile():
    with SessionLocal() as db:
        db.execute(delete(LLMTaskConfig))
        db.execute(delete(LLMProvider))
        row = LLMProvider(name="Ollama", base_url="http://127.0.0.1:11434/v1", api_key_encrypted="", enabled=True)
        db.add(row)
        db.flush()
        db.add(LLMTaskConfig(task=LLMTask.interpretation, provider_id=row.id, model="llama3"))
        db.commit()

        seen = {}

        def handler(request: httpx.Request) -> httpx.Response:
            seen["auth"] = request.headers.get("Authorization")
            return httpx.Response(200, json=completion_body())

        chat(db, LLMTask.interpretation, [{"role": "user", "content": "hi"}], transport=_transport(handler))
    assert seen["auth"] is None


def test_retries_once_on_500_then_succeeds(provider):
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        if len(calls) == 1:
            return httpx.Response(503, text="unavailable")
        return httpx.Response(200, json=completion_body(content="second try"))

    with SessionLocal() as db:
        result = chat(db, LLMTask.interpretation, [{"role": "user", "content": "hi"}], transport=_transport(handler))
    assert len(calls) == 2
    assert result.content == "second try"


def test_transport_error_exhausts_retry_then_raises(provider):
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        raise httpx.ConnectTimeout("too slow")

    with SessionLocal() as db, pytest.raises(LLMRequestError, match="transport failure"):
        chat(db, LLMTask.interpretation, [{"role": "user", "content": "hi"}], transport=_transport(handler))
    assert len(calls) == 2


def test_client_error_no_retry_provider_rejection(provider):
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(401, json={"error": {"message": "bad key"}})

    with SessionLocal() as db, pytest.raises(LLMRequestError, match="HTTP 401"):
        chat(db, LLMTask.interpretation, [{"role": "user", "content": "hi"}], transport=_transport(handler))
    assert len(calls) == 1


def test_reasoning_content_captured_separately(provider):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json=completion_body(content="answer", reasoning="because of x", finish="stop"),
        )

    with SessionLocal() as db:
        result = chat(db, LLMTask.interpretation, [{"role": "user", "content": "hi"}], transport=_transport(handler))
    assert result.content == "answer"
    assert result.reasoning_content == "because of x"


def test_no_provider_configured_when_task_row_missing(provider):
    with SessionLocal() as db, pytest.raises(NoProviderConfigured):
        chat(db, LLMTask.summary, [{"role": "user", "content": "hi"}], transport=_transport(lambda r: None))


def test_no_provider_configured_when_provider_disabled():
    with SessionLocal() as db:
        db.execute(delete(LLMTaskConfig))
        db.execute(delete(LLMProvider))
        row = LLMProvider(name="Down", base_url=OPENROUTER_BASE, enabled=False)
        db.add(row)
        db.flush()
        db.add(LLMTaskConfig(task=LLMTask.interpretation, provider_id=row.id, model="m"))
        db.commit()
        with pytest.raises(NoProviderConfigured):
            chat(db, LLMTask.interpretation, [{"role": "user", "content": "hi"}], transport=_transport(lambda r: None))


def test_response_shape_error_raises_request_error(provider):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"unexpected": True})

    with SessionLocal() as db, pytest.raises(LLMRequestError, match="response shape"):
        chat(db, LLMTask.interpretation, [{"role": "user", "content": "hi"}], transport=_transport(handler))


def test_resolve_task_config_rules(provider):
    with SessionLocal() as db:
        cfg = ai_client.resolve_task_config(db, LLMTask.interpretation)
        assert cfg.model == MODEL
        with pytest.raises(NoProviderConfigured):
            ai_client.resolve_task_config(db, LLMTask.prioritization)


def test_model_specific_effort_replaces_temperature(provider):
    with SessionLocal() as db:
        cfg = db.scalar(select(LLMTaskConfig).where(LLMTaskConfig.task == LLMTask.interpretation))
        cfg.model = "google/gemini-4-carbon"
        cfg.effort = "high"
        db.commit()

    requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json=completion_body())

    with SessionLocal() as db:
        chat(db, LLMTask.interpretation, [{"role": "user", "content": "hi"}], transport=_transport(handler))

    body = json.loads(requests[0].content)
    assert body["reasoning_effort"] == "high"
    assert "temperature" not in body
