"""Gemini provider support via Google's OpenAI-compatible endpoint (additive).

Google exposes an official OpenAI-compatible REST surface at
``https://generativelanguage.googleapis.com/v1beta/openai``. A provider row
pointing at that base URL therefore works with the existing chat client, the
live model catalog proxy and the admin test-connection button with no
Gemini-specific backend branch and no schema change.

These tests pin that contract so a later refactor cannot silently break it:
  * POST /chat/completions is built from the stored base_url,
  * the Gemini API key travels as a Bearer token and is never logged/returned,
  * GET /models is proxied from the same base_url and normalized to chat models,
  * the settings test-connection endpoint reports the Gemini model.

All outbound calls use httpx.MockTransport or a monkeypatched seam; no network.
"""

import json

import httpx
import pytest
from sqlalchemy import delete

import app.api.settings_llm as settings_llm
from app.ai import catalog
from app.ai.client import ChatResult, chat
from app.database import SessionLocal
from app.models.llm import LLMProvider, LLMTask, LLMTaskConfig, encrypt_secret

GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/openai"
GEMINI_KEY = "AIzaSyD-test-only-gemini-key-1234567890"
GEMINI_MODEL = "gemini-3.8-flash"

GEMINI_MODELS_PAYLOAD = {
    "data": [
        {"id": "gemini-3.8-flash", "name": "Gemini 3.8 Flash"},
        {"id": "gemini-4-carbon", "name": "Gemini 4 Carbon", "supported_parameters": ["reasoning_effort"]},
        {"id": "gemini-embedding-001", "name": "Gemini Embedding (not selectable)"},
    ]
}


def _completion(content: str = "pong") -> dict:
    return {
        "choices": [
            {"index": 0, "message": {"role": "assistant", "content": content}, "finish_reason": "stop"}
        ]
    }


@pytest.fixture(autouse=True)
def clean_llm_tables():
    def clean():
        with SessionLocal() as db:
            db.execute(delete(LLMTaskConfig))
            db.execute(delete(LLMProvider))
            db.commit()
        catalog.clear_cache()

    clean()
    yield
    clean()


def _seed_gemini(model: str = GEMINI_MODEL) -> int:
    with SessionLocal() as db:
        provider = LLMProvider(
            name="Google Gemini",
            base_url=GEMINI_BASE,
            api_key_encrypted=encrypt_secret(GEMINI_KEY),
            enabled=True,
        )
        db.add(provider)
        db.flush()
        db.add(
            LLMTaskConfig(
                task=LLMTask.interpretation,
                provider_id=provider.id,
                model=model,
                temperature=0.2,
            )
        )
        db.commit()
        return provider.id


def test_gemini_chat_uses_openai_compat_endpoint_and_bearer_key(caplog):
    _seed_gemini()
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["auth"] = request.headers.get("Authorization")
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json=_completion())

    with SessionLocal() as db:
        result = chat(
            db,
            LLMTask.interpretation,
            [{"role": "user", "content": "ping"}],
            transport=httpx.MockTransport(handler),
        )

    assert isinstance(result, ChatResult)
    assert result.content == "pong"
    assert result.model == GEMINI_MODEL
    assert seen["url"] == f"{GEMINI_BASE}/chat/completions"
    assert seen["auth"] == f"Bearer {GEMINI_KEY}"
    assert seen["body"]["model"] == GEMINI_MODEL
    # Gemini is not an o1/o3/o4 slug, so it keeps temperature rather than effort.
    assert seen["body"]["temperature"] == 0.2
    assert "reasoning_effort" not in seen["body"]
    assert GEMINI_KEY not in caplog.text


def test_gemini_models_url_is_the_openai_compat_path():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        return httpx.Response(200, json=GEMINI_MODELS_PAYLOAD)

    payload = catalog.fetch_catalog(
        GEMINI_BASE,
        {"Authorization": f"Bearer {GEMINI_KEY}"},
        transport=httpx.MockTransport(handler),
    )
    assert seen["url"] == f"{GEMINI_BASE}/models"
    assert payload == GEMINI_MODELS_PAYLOAD


def test_gemini_catalog_normalizes_to_chat_models_without_leaking_key(monkeypatch):
    provider_id = _seed_gemini()
    calls = {}

    def fake_fetch(base_url, headers, *, zdr=False, transport=None):
        calls["base_url"] = base_url
        calls["headers"] = headers
        return GEMINI_MODELS_PAYLOAD

    monkeypatch.setattr(catalog, "fetch_catalog", fake_fetch)
    with SessionLocal() as db:
        provider = db.get(LLMProvider, provider_id)
        source, models, notice = catalog.get_catalog(provider)

    assert source == "live"
    assert notice == ""
    assert calls["base_url"] == GEMINI_BASE
    assert calls["headers"]["Authorization"] == f"Bearer {GEMINI_KEY}"
    assert {model.id for model in models} == {"gemini-3.8-flash", "gemini-4-carbon"}
    assert GEMINI_KEY not in str(models)


def test_gemini_provider_passes_settings_test_connection(client, auth, monkeypatch):
    provider_id = _seed_gemini()
    calls = []

    def fake_send(base_url, headers, body, timeout, transport):
        calls.append({"base_url": base_url, "body": body})
        return _completion()

    monkeypatch.setattr(settings_llm.ai_client, "_send_with_retry", fake_send)
    resp = client.post("/api/settings/llm/test", json={"provider_id": provider_id}, headers=auth)

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["ok"] is True
    assert body["model"] == GEMINI_MODEL
    assert calls[0]["base_url"] == GEMINI_BASE
    assert calls[0]["body"]["model"] == GEMINI_MODEL
    assert GEMINI_KEY not in resp.text
