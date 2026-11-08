"""Adversarial redaction tests (M2 T2.3).

Claim under test: no secret survives into a prompt. Every case here is a
credential shape that must be fully replaced before text reaches a provider.
The client-level test proves the layer is wired into every real call.
"""

import json

import httpx
import pytest
from sqlalchemy import delete

from app.ai.client import chat
from app.ai.redaction import REDACTED, redact_messages, redact_payload, redact_text
from app.database import SessionLocal
from app.models.llm import LLMProvider, LLMTask, LLMTaskConfig, encrypt_secret
from tests.test_llm_client import _transport, completion_body


# (name, adversarial input, forbidden substring that must not survive)
ADVERSARIAL_CASES = [
    ("auth_header_bearer", "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.sig_abc123", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"),
    ("auth_header_basic", "Authorization: Basic dXNlcjpwYXNzd29yZA==", "dXNlcjpwYXNzd29yZA=="),
    ("api_key_header", "X-Api-Key: super-secret-123456", "super-secret-123456"),
    ("cookie_header", "Cookie: session=abc123def456; consent=yes", "abc123def456"),
    ("set_cookie", "Set-Cookie: SESSIONID=9f86d081884c7d65; HttpOnly", "9f86d081884c7d65"),
    ("plain_bearer", "Bearer atokenvalue1234567890", "atokenvalue1234567890"),
    ("jwt", "token eyJhbGciOiJub25lIn0.eyJ1c2VyIjoiYW1pIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQw", "eyJhbGciOiJub25lIn0"),
    ("password_json", '{"password": "hunter2secret"}', "hunter2secret"),
    ("token_yaml", "auth_token: gh9Tq_5ecr3t2345678", "gh9Tq_5ecr3t2345678"),
    ("api_key_env", "API_KEY=sk-proj-abcdef1234567890abcdef", "sk-proj-abcdef1234567890abcdef"),
    ("db_password_env", 'DATABASE_PASSWORD="p@ssword-prod-2026"', "p@ssword-prod-2026"),
    ("client_secret", "client_secret: verysecretvalue2026", "verysecretvalue2026"),
    ("private_key_block", "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA123456\nabc\n-----END RSA PRIVATE KEY-----", "MIIEpAIBAAKCAQEA123456"),
    ("openai_key", "sk-abc123def456ghi789jkl012", "sk-abc123def456ghi789jkl012"),
    ("github_token", "ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789", "ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789"),
    ("aws_key", "aws creds AKIAIOSFODNN7EXAMPLE", "AKIAIOSFODNN7EXAMPLE"),
    ("url_credential", "https://admin:.supersecret@juice.example.com/admin", ".supersecret"),
    ("high_entropy_hex", "leak: 5f4dcc3b5aa765d61d8327deb882cf9927deb882cf99", "5f4dcc3b5aa765d61d8327deb882cf99"),
    ("password_in_url_query", "https://site.com/?password=my-secret-pass", "my-secret-pass"),
]


@pytest.mark.parametrize("name, text, forbidden", ADVERSARIAL_CASES, ids=[c[0] for c in ADVERSARIAL_CASES])
def test_secret_never_survives(name, text, forbidden):
    out = redact_text(text)
    assert REDACTED in out
    assert forbidden not in out


def test_deny_list_terms_redacted_case_insensitive():
    out = redact_text("Contact admin at juicedrop.local and see /admin/config.php", deny_list=["Juicedrop.local", "/admin/config.php"])
    assert "juicedrop.local" not in out.lower()
    assert "config.php" not in out.lower()


def test_deny_list_short_terms_ignored():
    out = redact_text("a.b c.d", deny_list=["a."])
    assert out == "a.b c.d"


def test_redact_payload_walks_structures():
    payload = {
        "headers": {"Authorization": "Bearer real-token-value-here"},
        "alerts": [{"title": "ok", "evidence": "password=hunter2secret"}],
        "count": 3,
    }
    out = redact_payload(payload)
    assert out["count"] == 3
    assert "must-not-pass" not in json.dumps(out)
    assert "hunter2secret" not in json.dumps(out)
    assert "real-token-value-here" not in json.dumps(out)


def test_redact_messages_touches_every_content_field():
    messages = [
        {"role": "system", "content": "system secret_token: abcdef123456"},
        {"role": "user", "content": "user password=hunter2secret"},
        {"role": "assistant", "content": "clean"},
        {"role": "user", "content": 12345},  # non-string content: passed through
    ]
    out = redact_messages(messages)
    assert "abcdef123456" not in out[0]["content"]
    assert "hunter2secret" not in out[1]["content"]
    assert out[2]["content"] == "clean"
    assert out[3]["content"] == 12345


def test_client_applies_redaction_to_every_outgoing_call():
    """The integration proof: chat() redacts before anything reaches the wire,
    even though caller code passed raw secrets in."""
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json=completion_body(content="ack"))

    with SessionLocal() as db:
        db.execute(delete(LLMTaskConfig))
        db.execute(delete(LLMProvider))
        from tests.test_llm_client import OPENROUTER_BASE, MODEL

        provider = LLMProvider(
            name="OpenRouter",
            base_url=OPENROUTER_BASE,
            api_key_encrypted=encrypt_secret("sk-test-secret-key"),
            enabled=True,
        )
        db.add(provider)
        db.flush()
        db.add(LLMTaskConfig(task=LLMTask.interpretation, provider_id=provider.id, model=MODEL))
        db.commit()

        chat(
            db,
            LLMTask.interpretation,
            [{"role": "user", "content": "analyze: password=real-hunter2 and key AKIAIOSFODNN7EXAMPLE"}],
            deny_list=["juice.local"],
            transport=_transport(handler),
        )

    sent = json.dumps(seen["body"])
    assert "real-hunter2" not in sent
    assert "AKIAIOSFODNN7EXAMPLE" not in sent
    assert "juice.local" not in sent
    assert REDACTED in sent
