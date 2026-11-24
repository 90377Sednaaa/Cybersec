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

from app.ai.redaction import redact_messages, redact_text
from app.models.llm import LLMProvider, LLMTask, LLMTaskConfig, SecretUnreadable, decrypt_secret

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
    deny_list: list[str] | None = None,
    transport: httpx.BaseTransport | None = None,
) -> ChatResult:
    """Send one chat completion. `transport` is a test seam (httpx.MockTransport)."""
    cfg = resolve_task_config(db, task)
    provider: LLMProvider = cfg.provider
    # hard gate: nothing reaches a provider without passing the redaction layer
    messages = redact_messages(messages, deny_list)

    # o1/o3/o4 style models reject `temperature` and take `reasoning_effort`.
    # Compare the slug, not the whole id, so OpenRouter ids like "openai/o3-mini"
    # are handled the same way as direct OpenAI ids. Other reasoning models (R1,
    # QwQ, thinking variants) still accept temperature on their own endpoints.
    model_slug = cfg.model.lower().rsplit("/", 1)[-1]
    needs_reasoning_effort = model_slug.startswith(("o1", "o3", "o4"))

    body: dict = {
        "model": cfg.model,
        "messages": messages,
        "max_tokens": max_tokens,
        "stream": False,
    }
    # A model-specific level chosen from the live catalog always wins. Levels are
    # not uniform: Gemini offers low/medium/high, Claude adds xhigh/max, and many
    # models offer none at all. Fall back to the temperature mapping only for
    # OpenAI o1/o3/o4 style models saved before effort levels existed.
    selected_effort = (getattr(cfg, "effort", "") or "").strip()
    if selected_effort:
        body["reasoning_effort"] = selected_effort
    elif needs_reasoning_effort:
        effort = "medium"
        if cfg.temperature <= 0.2:
            effort = "low"
        elif cfg.temperature > 0.7:
            effort = "high"
        body["reasoning_effort"] = effort
    else:
        body["temperature"] = cfg.temperature
    if response_format is not None:
        body["response_format"] = response_format

    headers = {"Content-Type": "application/json"}
    if provider.api_key_encrypted:
        try:
            headers["Authorization"] = f"Bearer {decrypt_secret(provider.api_key_encrypted)}"
        except SecretUnreadable as exc:
            # A key we cannot read is a configuration problem, not a provider
            # failure: surface it as a normal LLMRequestError so scans degrade.
            raise LLMRequestError(str(exc)) from exc

    started = time.monotonic()
    response_json = _send_with_retry(provider.base_url, headers, body, timeout, transport)
    latency_ms = int((time.monotonic() - started) * 1000)

    try:
        choice = response_json["choices"][0]
        message = choice["message"]
        content = message.get("content") or ""
        # Direct DeepSeek/vLLM use `reasoning_content`; OpenRouter returns
        # thinking traces under `reasoning` for Gemini, Claude, and DeepSeek.
        reasoning = message.get("reasoning_content") or message.get("reasoning") or ""
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


MAX_RETRY_AFTER_SECONDS = 15.0
RATE_LIMIT_BACKOFF_SECONDS = (2.0, 5.0)


def _parse_retry_after(value: str | None) -> float | None:
    """Parse a numeric Retry-After header (seconds), clamped to a safe cap."""
    if not value:
        return None
    try:
        seconds = float(value.strip())
    except ValueError:
        return None
    if seconds <= 0:
        return None
    return min(seconds, MAX_RETRY_AFTER_SECONDS)


def _send_with_retry(
    base_url: str,
    headers: dict,
    body: dict,
    timeout: float,
    transport: httpx.BaseTransport | None,
) -> dict:
    # Transient transport / 5xx errors get 1 retry (2 attempts, 1s sleep).
    # HTTP 429 rate limits get up to 2 retries (3 attempts), honoring Retry-After
    # when provided or backing off 2s -> 5s so provider rate windows can clear.
    last_error = ""
    rate_limit_retries = 0
    transient_retries = 0

    while True:
        try:
            with httpx.Client(timeout=timeout, transport=transport) as client:
                resp = client.post(f"{base_url.rstrip('/')}/chat/completions", headers=headers, json=body)
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            last_error = f"transport failure: {type(exc).__name__}"
            if transient_retries < 1:
                transient_retries += 1
                time.sleep(1.0)
                continue
            break

        if 200 <= resp.status_code < 300:
            try:
                return resp.json()
            except ValueError:
                last_error = "provider returned non-JSON body"
                if transient_retries < 1:
                    transient_retries += 1
                    time.sleep(1.0)
                    continue
                break

        if resp.status_code == 429:
            last_error = "HTTP 429 from provider (rate limited)"
            if rate_limit_retries < len(RATE_LIMIT_BACKOFF_SECONDS):
                delay = _parse_retry_after(resp.headers.get("Retry-After"))
                if delay is None:
                    delay = RATE_LIMIT_BACKOFF_SECONDS[rate_limit_retries]
                rate_limit_retries += 1
                time.sleep(delay)
                continue
            break

        if resp.status_code in (500, 502, 503, 504):
            last_error = f"HTTP {resp.status_code} from provider"
            if transient_retries < 1:
                transient_retries += 1
                time.sleep(1.0)
                continue
            break

        # A gateway can echo the request - Authorization header included -
        # back in its error body. This string ends up in
        # assessment.notes, SSE logs and the /test response, so scrub it
        # before it leaves the process.
        detail = redact_text(resp.text)[:300]
        raise LLMRequestError(f"Provider rejected the request (HTTP {resp.status_code}): {detail}")

    raise LLMRequestError(f"LLM call failed after retry: {last_error}")
