"""Live model catalog endpoint (additive M2 enhancement).

The catalog is metadata only. These tests pin the hard rules: the API key is
never echoed, every role can read, upstream failures degrade instead of 500,
and a provider edit invalidates the cached catalog.
"""

import pytest

import app.api.settings_llm as settings_llm
from app.ai.catalog import CatalogError, clear_cache
from app.database import SessionLocal
from app.models.llm import LLMProvider, LLMTaskConfig

OPENROUTER_PAYLOAD = {
    "data": [
        {
            "id": "deepseek/deepseek-chat",
            "name": "DeepSeek: DeepSeek V3",
            "context_length": 163840,
            "pricing": {"prompt": "0.00000032", "completion": "0.00000089"},
            "architecture": {"modality": "text->text", "output_modalities": ["text"]},
            "supported_parameters": ["temperature", "max_tokens", "structured_outputs"],
            "endpoints": ["/api/v1/chat/completions"],
        },
        {
            "id": "baidu/ernie-5.5-flash-preview:free",
            "name": "Baidu: ERNIE-5.5-Flash-Preview (free)",
            "context_length": 1024000,
            "pricing": {"prompt": "0", "completion": "0"},
            "architecture": {"modality": "text+image->text", "output_modalities": ["text"]},
            "supported_parameters": ["reasoning", "reasoning_effort", "max_tokens"],
            "reasoning": {
                "mandatory": True,
                "supported_efforts": ["high", "medium", "low"],
                "default_effort": "medium",
            },
            "endpoints": ["/api/v1/chat/completions"],
        },
        {
            "id": "openai/text-embedding-3-large",
            "name": "Embedding model (not selectable)",
            "pricing": {"prompt": "0.00000013", "completion": "0"},
            "architecture": {"modality": "text->vector", "output_modalities": ["vector"]},
            "endpoints": ["/api/v1/embeddings"],
        },
    ]
}


@pytest.fixture(autouse=True)
def reset_state():
    def clean():
        with SessionLocal() as db:
            db.query(LLMTaskConfig).delete()
            db.query(LLMProvider).delete()
            db.commit()
        clear_cache()

    clean()
    yield
    clean()


@pytest.fixture()
def provider(client, auth):
    resp = client.post(
        "/api/settings/llm/providers",
        json={
            "name": "OpenRouter",
            "base_url": "https://openrouter.ai/api/v1",
            "api_key": "sk-super-secret-catalog-key",
            "enabled": True,
            "acknowledged_external_processing": True,
        },
        headers=auth,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _patch_catalog(monkeypatch, payload=OPENROUTER_PAYLOAD, exc=None):
    calls = []

    def fake_fetch(base_url, headers, *, zdr=False, transport=None):
        calls.append({"base_url": base_url, "zdr": zdr, "headers": headers})
        if exc is not None:
            raise exc
        return payload

    monkeypatch.setattr(settings_llm.catalog, "fetch_catalog", fake_fetch)
    return calls


def test_catalog_normalizes_pricing_and_filters_non_chat_models(client, auth, provider, monkeypatch):
    calls = _patch_catalog(monkeypatch)
    resp = client.get(f"/api/settings/llm/providers/{provider['id']}/models", headers=auth)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["source"] == "live"
    assert body["zdr_supported"] is True
    assert len(body["models"]) == 2
    paid = next(m for m in body["models"] if m["id"] == "deepseek/deepseek-chat")
    assert paid["prompt_price"] == 0.32
    assert paid["completion_price"] == 0.89
    assert paid["free"] is False
    assert paid["structured_outputs"] is True
    assert paid["supported_efforts"] == []
    free = next(m for m in body["models"] if m["id"].endswith(":free"))
    assert free["free"] is True
    assert free["reasoning"] is True
    assert free["supported_efforts"] == ["high", "medium", "low"]
    assert free["default_effort"] == "medium"
    assert calls[0]["base_url"].endswith("/api/v1")
    assert "sk-super-secret-catalog-key" not in str(body)


def test_catalog_key_is_used_only_for_the_outbound_request(client, auth, provider, monkeypatch):
    calls = _patch_catalog(monkeypatch)
    resp = client.get(f"/api/settings/llm/providers/{provider['id']}/models", headers=auth)
    assert resp.status_code == 200
    assert calls[0]["headers"]["Authorization"].startswith("Bearer ")
    assert "sk-super-secret-catalog-key" not in resp.text


def test_zdr_filter_is_forwarded_only_for_openrouter(client, auth, provider, monkeypatch):
    calls = _patch_catalog(monkeypatch)
    resp = client.get(f"/api/settings/llm/providers/{provider['id']}/models?zdr=true", headers=auth)
    assert resp.status_code == 200
    body = resp.json()
    assert body["zdr_filter"] is True
    assert all(m["zero_data_retention"] for m in body["models"])
    assert calls[0]["zdr"] is True

    other = client.post(
        "/api/settings/llm/providers",
        json={"name": "Local", "base_url": "http://localhost:11434/v1", "enabled": False},
        headers=auth,
    ).json()
    _patch_catalog(monkeypatch)
    local = client.get(f"/api/settings/llm/providers/{other['id']}/models?zdr=true", headers=auth)
    assert local.json()["zdr_supported"] is False
    assert local.json()["zdr_filter"] is False


def test_upstream_failure_degrades_to_unavailable(client, auth, provider, monkeypatch):
    _patch_catalog(monkeypatch, exc=CatalogError("Provider returned HTTP 503 for its model list"))
    resp = client.get(f"/api/settings/llm/providers/{provider['id']}/models", headers=auth)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["source"] == "unavailable"
    assert body["models"] == []
    assert "503" in body["notice"]
    assert "sk-super-secret-catalog-key" not in str(body)


def test_catalog_is_cached_and_invalidated_on_provider_edit(client, auth, provider, monkeypatch):
    calls = _patch_catalog(monkeypatch)
    url = f"/api/settings/llm/providers/{provider['id']}/models"
    assert client.get(url, headers=auth).status_code == 200
    assert client.get(url, headers=auth).status_code == 200
    assert len(calls) == 1

    updated = client.put(
        f"/api/settings/llm/providers/{provider['id']}",
        json={"name": "OpenRouter", "base_url": "https://openrouter.ai/api/v1", "enabled": True},
        headers=auth,
    )
    assert updated.status_code == 200
    assert client.get(url, headers=auth).status_code == 200
    assert len(calls) == 2


def test_catalog_requires_auth_and_known_provider(client, auth, provider):
    url = f"/api/settings/llm/providers/{provider['id']}/models"
    assert client.get(url).status_code == 401
    assert client.get("/api/settings/llm/providers/9999/models", headers=auth).status_code == 404


def test_viewer_can_browse_the_catalog(client, auth, provider, monkeypatch):
    _patch_catalog(monkeypatch)
    created = client.post(
        "/api/users",
        json={"email": "catalog-viewer@example.com", "password": "viewerpass1", "full_name": "Catalog Viewer", "role": "viewer"},
        headers=auth,
    )
    assert created.status_code in (201, 400), created.text
    login = client.post(
        "/api/auth/login",
        data={"username": "catalog-viewer@example.com", "password": "viewerpass1"},
    )
    viewer = {"Authorization": f"Bearer {login.json()['access_token']}"}
    resp = client.get(f"/api/settings/llm/providers/{provider['id']}/models", headers=viewer)
    assert resp.status_code == 200, resp.text
    assert resp.json()["source"] == "live"
