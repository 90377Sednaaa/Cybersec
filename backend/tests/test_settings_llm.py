"""Settings API tests (M2 T2.2).

Key assertions: the API key is write-only (never appears in any response),
mutations are admin-only, and enabling a provider requires the discretion
acknowledgment (`acknowledged_external_processing`), audited by timestamp.
"""

import pytest

import app.api.settings_llm as settings_llm
from app.ai.client import LLMRequestError
from app.database import SessionLocal
from app.models.llm import LLMProvider, LLMTask, LLMTaskConfig, encrypt_secret
from tests.test_llm_client import completion_body


@pytest.fixture(autouse=True)
def clean_llm_tables():
    with SessionLocal() as db:
        db.query(LLMTaskConfig).delete()
        db.query(LLMProvider).delete()
        db.commit()
    yield
    with SessionLocal() as db:
        db.query(LLMTaskConfig).delete()
        db.query(LLMProvider).delete()
        db.commit()


@pytest.fixture()
def viewer_auth(client, auth):
    login = client.post(
        "/api/auth/login",
        data={"username": "m2-viewer@example.com", "password": "viewerpass1"},
    )
    if login.status_code == 401:
        created = client.post(
            "/api/users",
            json={"email": "m2-viewer@example.com", "password": "viewerpass1", "full_name": "M2 Viewer", "role": "viewer"},
            headers=auth,
        )
        assert created.status_code in (201, 400), created.text  # 400 = already exists
        login = client.post(
            "/api/auth/login",
            data={"username": "m2-viewer@example.com", "password": "viewerpass1"},
        )
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def _put_provider(client, auth, **overrides):
    body = {"name": "OpenRouter", "base_url": "https://openrouter.ai/api/v1", "api_key": "sk-live-key-abcdef", **overrides}
    return client.put("/api/settings/llm/providers/1", json=body, headers=auth)


def test_get_settings_creates_default_task_configs(client, auth):
    resp = client.get("/api/settings/llm", headers=auth)
    assert resp.status_code == 200
    body = resp.json()
    assert body["providers"] == []
    tasks = {c["task"] for c in body["task_configs"]}
    assert tasks == {"interpretation", "summary", "prioritization", "qa"}
    for config in body["task_configs"]:
        assert config["provider_id"] is None
        assert config["model"] == ""


def test_get_and_create_responses_never_contain_the_key(client, auth):
    created = client.post(
        "/api/settings/llm/providers",
        json={"name": "OpenRouter", "base_url": "https://openrouter.ai/api/v1", "api_key": "sk-super-secret-value", "enabled": False},
        headers=auth,
    )
    assert created.status_code == 201, created.text
    listed = client.get("/api/settings/llm", headers=auth).json()
    for provider in listed["providers"]:
        assert "api_key" not in provider
        assert provider["has_api_key"] is True
    assert "sk-super-secret-value" not in str(listed)


def test_enabling_without_acknowledgment_rejected(client, auth):
    created = client.post(
        "/api/settings/llm/providers",
        json={"name": "OpenRouter", "base_url": "https://openrouter.ai/api/v1", "enabled": False},
        headers=auth,
    )
    assert created.status_code == 201
    provider_id = created.json()["id"]
    resp = client.put(
        f"/api/settings/llm/providers/{provider_id}",
        json={"name": "OpenRouter", "base_url": "https://openrouter.ai/api/v1", "enabled": True},
        headers=auth,
    )
    assert resp.status_code == 400
    assert "acknowledged_external_processing" in resp.json()["detail"]


def test_enable_with_acknowledgment_sets_auditable_timestamp(client, auth):
    created = client.post(
        "/api/settings/llm/providers",
        json={"name": "OpenRouter", "base_url": "https://openrouter.ai/api/v1", "enabled": False},
        headers=auth,
    )
    provider_id = created.json()["id"]
    resp = client.put(
        f"/api/settings/llm/providers/{provider_id}",
        json={
            "name": "OpenRouter",
            "base_url": "https://openrouter.ai/api/v1",
            "api_key": "sk-live-abcdefg",
            "enabled": True,
            "acknowledged_external_processing": True,
        },
        headers=auth,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["enabled"] is True
    assert body["acknowledged_external_at"] is not None
    assert body["has_api_key"] is True


def test_acknowledgment_is_sticky_on_later_updates(client, auth):
    created = client.post(
        "/api/settings/llm/providers",
        json={"name": "OpenRouter", "base_url": "https://openrouter.ai/api/v1", "enabled": True, "acknowledged_external_processing": True},
        headers=auth,
    )
    assert created.status_code == 201
    provider_id = created.json()["id"]
    resp = _put_provider(client, auth)
    assert resp.status_code == 200  # acknowledged already; no new ack sent


def test_ack_negation_is_ignored_sticky_ack_wins(client, auth):
    """Semantics: the acknowledgment is sticky once recorded; an explicit False
    cannot reinstate the prompt-gate for an already-acknowledged provider."""
    created = client.post(
        "/api/settings/llm/providers",
        json={"name": "OpenRouter", "base_url": "https://openrouter.ai/api/v1", "enabled": False},
        headers=auth,
    )
    provider_id = created.json()["id"]
    resp = _put_provider(client, auth, enabled=True, acknowledged_external_processing=True)
    assert resp.status_code == 200  # now the sticky ack is recorded
    resp = client.put(
        f"/api/settings/llm/providers/{provider_id}",
        json={"name": "OpenRouter", "base_url": "https://openrouter.ai/api/v1", "enabled": True, "acknowledged_external_processing": False},
        headers=auth,
    )
    assert resp.status_code == 200  # explicit False does not undo a recorded acknowledgment


def test_disable_never_requires_acknowledgment(client, auth):
    created = client.post(
        "/api/settings/llm/providers",
        json={"name": "OpenRouter", "base_url": "https://openrouter.ai/api/v1", "enabled": False},
        headers=auth,
    )
    provider_id = created.json()["id"]
    resp = client.put(
        f"/api/settings/llm/providers/{provider_id}",
        json={"name": "OpenRouter", "base_url": "https://openrouter.ai/api/v1", "api_key": "k", "enabled": False, "acknowledged_external_processing": False},
        headers=auth,
    )
    assert resp.status_code == 200


def test_updating_key_ignores_empty_string(client, auth):
    created = client.post(
        "/api/settings/llm/providers",
        json={"name": "OpenRouter", "base_url": "https://openrouter.ai/api/v1", "api_key": "sk-existing-key", "enabled": False},
        headers=auth,
    )
    provider_id = created.json()["id"]
    resp = client.put(
        f"/api/settings/llm/providers/{provider_id}",
        json={"name": "OpenRouter", "base_url": "https://openrouter.ai/api/v1", "api_key": "", "enabled": False},
        headers=auth,
    )
    assert resp.status_code == 200
    assert resp.json()["has_api_key"] is True


def test_non_admin_mutations_forbidden(client, auth, viewer_auth):
    assert client.post("/api/settings/llm/providers", json={"name": "x", "base_url": "https://x"}, headers=viewer_auth).status_code == 403
    assert client.post("/api/settings/llm/test", json={"provider_id": 1}, headers=viewer_auth).status_code == 403
    assert client.put("/api/settings/llm/tasks/summary", json={"provider_id": None, "model": "m"}, headers=viewer_auth).status_code == 403


def test_unknown_provider_404(client, auth):
    assert client.put("/api/settings/llm/providers/999", json={"name": "x", "base_url": "https://x"}, headers=auth).status_code == 404
    assert client.post("/api/settings/llm/test", json={"provider_id": 999}, headers=auth).status_code == 404


def test_update_task_config_happy_path(client, auth):
    provider_id = client.post(
        "/api/settings/llm/providers",
        json={"name": "OpenRouter", "base_url": "https://openrouter.ai/api/v1", "enabled": True, "acknowledged_external_processing": True},
        headers=auth,
    ).json()["id"]
    resp = client.put(
        "/api/settings/llm/tasks/interpretation",
        json={"provider_id": provider_id, "model": "deepseek/deepseek-chat", "temperature": 0.2},
        headers=auth,
    )
    assert resp.status_code == 200, resp.text
    config = resp.json()
    assert config["task"] == "interpretation"
    assert config["model"] == "deepseek/deepseek-chat"
    assert config["provider_id"] == provider_id


def _patch_send(monkeypatch, results=None, exc=None):
    calls = []

    def fake_send_with_retry(base_url, headers, body, timeout, transport):
        calls.append({"base_url": base_url, "body": body})
        if exc is not None:
            raise exc
        if results:
            return results.pop(0)
        return completion_body(content="pong")

    monkeypatch.setattr(settings_llm.ai_client, "_send_with_retry", fake_send_with_retry)
    return calls


def test_connection_ok_reports_model_and_latency(client, auth, monkeypatch):
    provider_id = client.post(
        "/api/settings/llm/providers",
        json={"name": "OpenRouter", "base_url": "https://openrouter.ai/api/v1", "api_key": "sk-x", "enabled": True, "acknowledged_external_processing": True},
        headers=auth,
    ).json()["id"]
    client.put(
        "/api/settings/llm/tasks/interpretation",
        json={"provider_id": provider_id, "model": "deepseek/deepseek-chat"},
        headers=auth,
    )
    calls = _patch_send(monkeypatch)
    resp = client.post("/api/settings/llm/test", json={"provider_id": provider_id}, headers=auth)
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert body["model"] == "deepseek/deepseek-chat"
    assert body["latency_ms"] is not None
    assert body["error"] == ""
    assert len(calls) == 1
    assert "sk-x" not in str(calls)  # key never appears in the request logging path either


def test_connection_provider_down_returns_ok_false_not_500(client, auth, monkeypatch):
    created = client.post(
        "/api/settings/llm/providers",
        json={"name": "OpenRouter", "base_url": "https://openrouter.ai/api/v1", "api_key": "sk-y", "enabled": True, "acknowledged_external_processing": True},
        headers=auth,
    )
    provider_id = created.json()["id"]
    client.put(
        "/api/settings/llm/tasks/interpretation",
        json={"provider_id": provider_id, "model": "deepseek/deepseek-chat"},
        headers=auth,
    )
    _patch_send(monkeypatch, exc=LLMRequestError("transport failure: ConnectTimeout"))
    resp = client.post("/api/settings/llm/test", json={"provider_id": provider_id}, headers=auth)
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is False
    assert "transport failure" in body["error"]
    assert "sk-y" not in str(body)


def test_connection_without_task_model_is_graceful(client, auth, monkeypatch):
    provider_id = client.post(
        "/api/settings/llm/providers",
        json={"name": "OpenRouter", "base_url": "https://openrouter.ai/api/v1", "api_key": "sk-z", "enabled": True, "acknowledged_external_processing": True},
        headers=auth,
    ).json()["id"]
    _patch_send(monkeypatch)
    resp = client.post("/api/settings/llm/test", json={"provider_id": provider_id}, headers=auth)
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is False
    assert "No task model" in body["error"]


def test_effort_is_persisted_and_defaults_to_empty(client, auth):
    created = client.get("/api/settings/llm", headers=auth).json()
    assert all(config["effort"] == "" for config in created["task_configs"])

    provider_id = client.post(
        "/api/settings/llm/providers",
        json={"name": "OpenRouter", "base_url": "https://openrouter.ai/api/v1", "enabled": True, "acknowledged_external_processing": True},
        headers=auth,
    ).json()["id"]
    resp = client.put(
        "/api/settings/llm/tasks/summary",
        json={"provider_id": provider_id, "model": "google/gemini-4-carbon", "temperature": 0.4, "effort": "HIGH"},
        headers=auth,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["effort"] == "high"
    listed = client.get("/api/settings/llm", headers=auth).json()
    assert next(c for c in listed["task_configs"] if c["task"] == "summary")["effort"] == "high"

    # Omitting the field keeps the stored level (older clients stay compatible).
    resp = client.put(
        "/api/settings/llm/tasks/summary",
        json={"provider_id": provider_id, "model": "google/gemini-4-carbon", "temperature": 0.4},
        headers=auth,
    )
    assert resp.json()["effort"] == "high"

    # Invalid tokens are discarded rather than forwarded to the provider.
    resp = client.put(
        "/api/settings/llm/tasks/summary",
        json={"provider_id": provider_id, "model": "google/gemini-4-carbon", "temperature": 0.4, "effort": "high; drop table"},
        headers=auth,
    )
    assert resp.json()["effort"] == ""


def test_placeholder_key_is_rejected_before_it_is_stored(client, auth):
    """A hand-typed stub must not be stored as a working credential.

    Regression: `sk-or-v1-demo-key` was accepted, so the provider reported
    has_api_key=true and every scan failed with a 401 that looked like an
    outage instead of a configuration mistake.
    """
    resp = client.post(
        "/api/settings/llm/providers",
        json={"name": "OpenRouter", "base_url": "https://openrouter.ai/api/v1", "api_key": "sk-or-v1-demo-key", "enabled": False},
        headers=auth,
    )
    assert resp.status_code == 400, resp.text
    assert "placeholder" in resp.json()["detail"].lower()
    assert "sk-or-v1-demo-key" not in resp.text
    assert client.get("/api/settings/llm", headers=auth).json()["providers"] == []


def test_truncated_prefixed_key_is_rejected(client, auth):
    """Right prefix, wrong length: the shape of a key that was cut off mid-paste."""
    resp = client.post(
        "/api/settings/llm/providers",
        json={"name": "OpenRouter", "base_url": "https://openrouter.ai/api/v1", "api_key": "sk-or-v1-abc", "enabled": False},
        headers=auth,
    )
    assert resp.status_code == 400, resp.text
    assert "too short" in resp.json()["detail"].lower()


def test_update_also_rejects_placeholder_key(client, auth):
    """The guard covers PUT too, so a bad key cannot slip in after creation."""
    created = client.post(
        "/api/settings/llm/providers",
        json={"name": "OpenRouter", "base_url": "https://openrouter.ai/api/v1", "api_key": "sk-or-v1-" + "a" * 64, "enabled": False},
        headers=auth,
    )
    assert created.status_code == 201, created.text
    resp = _put_provider(client, auth, api_key="sk-or-v1-placeholder")
    assert resp.status_code == 400, resp.text


def test_realistic_key_and_empty_local_key_are_accepted(client, auth):
    """The guard must not block a real key, nor the documented no-auth local path."""
    real = client.post(
        "/api/settings/llm/providers",
        json={"name": "OpenRouter", "base_url": "https://openrouter.ai/api/v1", "api_key": "sk-or-v1-" + "b" * 64, "enabled": False},
        headers=auth,
    )
    assert real.status_code == 201, real.text
    assert real.json()["has_api_key"] is True

    local = client.post(
        "/api/settings/llm/providers",
        json={"name": "Ollama", "base_url": "http://127.0.0.1:11434/v1", "api_key": "", "enabled": False},
        headers=auth,
    )
    assert local.status_code == 201, local.text
    assert local.json()["has_api_key"] is False
