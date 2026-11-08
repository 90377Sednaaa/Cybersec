"""OpenAI-compatible LLM client (M2 T2.1).

One chat function for every AI task. Resolves the per-task model config from
the DB (`LLMTaskConfig` -> `LLMProvider`), decrypts the stored API key at call
time, and posts to `POST {base_url}/chat/completions`.

Failure philosophy: a missing/disabled config raises `NoProviderConfigured`
(callers must degrade gracefully - a scan completes without AI); transport and
HTTP failures after one retry raise `LLMRequestError`. The key is never logged.
No stored key means no Authorization header, which is all an Ollama/fallback
profile needs.
"""

from __future__ import annotations

import time
from dataclasses import dataclass

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.llm import LLMProvider, LLMTask, LLMTaskConfig, decrypt_secret

DEFAULT_TIMEOUT_SECONDS = 60.0
DEFAULT_MAX_TOKENS = 2000


class NoProviderConfigured(Exception):
    """The task has no enabled provider + model; AI features are off."""


class LLMRequestError(Exception):
    """The provider call failed after retries (transport, timeout, HTTP status)."""


@dataclass
class ChatResult:
    content: str
    model: str
    latency_ms: int
    reasoning_content: str = ""
    finish_reason: str = ""


def resolve_task_config(db: Session, task: LLMTask) -> LLMTaskConfig:
    cfg = db.scalar(select(LLMTaskConfig).where(LLMTaskConfig.task == task).limit(1))
    if cfg is None or cfg.provider is None or not cfg.provider.enabled or not cfg.model:
        raise NoProviderConfigured(f"No enabled provider/model configured for task '{task.value}'")
    return cfg


def chat(
    db: Session,
    task: LLMTask,
    messages: list[dict],
    *,
    max_tokens: int = DEFAULT_MAX_TOKENS,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
    response_format: dict | None = None,
    transport: httpx.BaseTransport | None = None,
) -> ChatResult:
    """Send one chat completion. `transport` is a test seam (httpx.MockTransport)."""
    cfg = resolve_task_config(db, task)
    provider: LLMProvider = cfg.provider
    body: dict = {
        "model": cfg.model,
        "messages": messages,
        "temperature": cfg.temperature,
        "max_tokens": max_tokens,
        "stream": False,
    }
    if response_format is not None:
        body["response_format"] = response_format

    headers = {"Content-Type": "application/json"}
    if provider.api_key_encrypted:
        headers["Authorization"] = f"Bearer {decrypt_secret(provider.api_key_encrypted)}"

    started = time.monotonic()
    response_json = _send_with_retry(provider.base_url, headers, body, timeout, transport)
    latency_ms = int((time.monotonic() - started) * 1000)

    try:
        choice = response_json["choices"][0]
        message = choice["message"]
        content = message.get("content") or ""
        reasoning = message.get("reasoning_content") or ""
        finish = choice.get("finish_reason") or ""
    except (KeyError, IndexError, TypeError) as exc:
        raise LLMRequestError(f"Unexpected response shape from provider: {exc}") from exc

    return ChatResult(
        content=content,
        model=cfg.model,
        latency_ms=latency_ms,
        reasoning_content=reasoning,
        finish_reason=finish,
    )


def _send_with_retry(
    base_url: str,
    headers: dict,
    body: dict,
    timeout: float,
    transport: httpx.BaseTransport | None,
) -> dict:
    # no api key -> peer-to-peer local profile (Ollama); short backoff, one retry
    last_error = ""
    for attempt in range(2):
        try:
            with httpx.Client(timeout=timeout, transport=transport) as client:
                resp = client.post(f"{base_url.rstrip('/')}/chat/completions", headers=headers, json=body)
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            last_error = f"transport failure: {type(exc).__name__}"
        else:
            if 200 <= resp.status_code < 300:
                try:
                    return resp.json()
                except ValueError:
                    last_error = "provider returned non-JSON body"
            elif resp.status_code in (429, 500, 502, 503, 504):
                last_error = f"HTTP {resp.status_code} from provider"
            else:
                detail = resp.text[:300]
                raise LLMRequestError(f"Provider rejected the request (HTTP {resp.status_code}): {detail}")
        if attempt == 0:
            time.sleep(1.0)
    raise LLMRequestError(f"LLM call failed after retry: {last_error}")
