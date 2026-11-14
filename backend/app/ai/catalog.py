"""Live model catalog discovery for configured LLM providers (M2 enhancement).

One GET to a provider's OpenAI-compatible `/models` endpoint, normalized into a
single shape for the Settings UI. This is metadata only: no scan data is sent,
and the API key is used server-side for the request and is never returned,
logged, or included in any error text.

Best-effort by design. Any failure returns `source="unavailable"` with an empty
list so the UI can fall back to its offline presets, which keeps the offline /
local Ollama demo working. A short in-memory TTL avoids hammering the provider
while an admin browses hundreds of models.
"""

from __future__ import annotations

import threading
import time
from typing import Any

import httpx

from app.models.llm import LLMProvider, SecretUnreadable, decrypt_secret
from app.schemas.common import LLMModelOut

CATALOG_TTL_SECONDS = 600.0
CATALOG_TIMEOUT_SECONDS = 8.0
MAX_MODELS = 1000

CHAT_ENDPOINT_PATHS = {"/api/v1/chat/completions", "/v1/chat/completions", "/chat/completions"}
NON_CHAT_ID_PARTS = (
    "embedding",
    "embed-",
    "tts",
    "whisper",
    "dall-e",
    "image-generation",
    "moderation",
    "rerank",
    "transcribe",
    "speech",
    "guard",
)
REASONING_HINTS = ("reasoner", "reasoning", "thinking", "qwq", "-r1", "/r1", "o1-", "o3-", "o4-")


class CatalogError(Exception):
    """A provider's model list could not be used. Message is safe to show."""


_cache: dict[tuple[int, bool], tuple[float, list[LLMModelOut]]] = {}
# Bumped on every invalidate(). A fetch that started before an invalidation must
# not repopulate the cache it was just cleared from, or a base_url/key change
# keeps serving the OLD provider's models for the whole TTL.
_generation: dict[int, int] = {}
_cache_lock = threading.Lock()


def invalidate(provider_id: int) -> None:
    """Drop cached catalogs after a provider's URL or key changes."""
    with _cache_lock:
        for key in [k for k in _cache if k[0] == provider_id]:
            del _cache[key]
        _generation[provider_id] = _generation.get(provider_id, 0) + 1


def clear_cache() -> None:
    """Test seam: forget every cached catalog."""
    with _cache_lock:
        _cache.clear()
        _generation.clear()


def supports_zdr(base_url: str) -> bool:
    """Only OpenRouter documents the `zdr=true` zero-data-retention filter."""
    return "openrouter.ai" in base_url.lower()


def fetch_catalog(
    base_url: str,
    headers: dict[str, str],
    *,
    zdr: bool = False,
    transport: httpx.BaseTransport | None = None,
) -> dict[str, Any]:
    params = {"zdr": "true"} if zdr else None
    with httpx.Client(timeout=CATALOG_TIMEOUT_SECONDS, transport=transport) as client:
        resp = client.get(f"{base_url.rstrip('/')}/models", headers=headers, params=params)
    if not 200 <= resp.status_code < 300:
        raise CatalogError(f"Provider returned HTTP {resp.status_code} for its model list")
    try:
        payload = resp.json()
    except ValueError as exc:
        raise CatalogError("Provider returned a non-JSON model list") from exc
    if not isinstance(payload, dict):
        raise CatalogError("Provider returned an unexpected model list")
    return payload


def _headers(provider: LLMProvider) -> dict[str, str]:
    headers = {"Accept": "application/json"}
    if provider.api_key_encrypted:
        try:
            headers["Authorization"] = f"Bearer {decrypt_secret(provider.api_key_encrypted)}"
        except SecretUnreadable as exc:
            # get_catalog turns CatalogError into source="unavailable", so the
            # endpoint answers 200 with a readable notice instead of a 500.
            raise CatalogError(str(exc)) from exc
    return headers


def get_catalog(
    provider: LLMProvider,
    *,
    zdr: bool = False,
    transport: httpx.BaseTransport | None = None,
) -> tuple[str, list[LLMModelOut], str]:
    """Return (source, models, notice). Never raises for upstream failures."""
    key = (provider.id, zdr)
    now = time.monotonic()
    with _cache_lock:
        hit = _cache.get(key)
        generation = _generation.get(provider.id, 0)
    if hit and now - hit[0] < CATALOG_TTL_SECONDS:
        return "live", hit[1], ""

    try:
        payload = fetch_catalog(provider.base_url, _headers(provider), zdr=zdr, transport=transport)
        models = _normalize(payload, zdr=zdr)
    except (CatalogError, httpx.HTTPError, OSError, ValueError, TypeError) as exc:
        with _cache_lock:
            _cache.pop(key, None)
        notice = str(exc) if isinstance(exc, CatalogError) else "Could not reach the provider model list."
        return "unavailable", [], notice

    if not models:
        return "unavailable", [], "This provider did not list any chat models."
    with _cache_lock:
        # The result is still valid for this caller, but if invalidate() ran
        # while the request was in flight it belongs to the previous endpoint -
        # caching it would serve stale metadata for a whole TTL.
        if _generation.get(provider.id, 0) == generation:
            _cache[key] = (now, models)
    return "live", models, ""


def _normalize(payload: dict[str, Any], *, zdr: bool) -> list[LLMModelOut]:
    rows = payload.get("data")
    if not isinstance(rows, list):
        raise CatalogError("Provider returned an unexpected model list")
    models: list[LLMModelOut] = []
    seen: set[str] = set()
    for row in rows[:MAX_MODELS]:
        if not isinstance(row, dict):
            continue
        model_id = str(row.get("id") or "").strip()
        if not model_id or model_id in seen or not _is_chat_model(row, model_id):
            continue
        seen.add(model_id)

        pricing = row.get("pricing") if isinstance(row.get("pricing"), dict) else {}
        prompt_price = _price_per_million(pricing.get("prompt"))
        completion_price = _price_per_million(pricing.get("completion"))
        params = row.get("supported_parameters")
        params = [str(p) for p in params] if isinstance(params, list) else []
        context = _positive_int(row.get("context_length"))
        reasoning_meta = _reasoning_meta(row)
        efforts = _efforts(reasoning_meta)
        default_effort = str(reasoning_meta.get("default_effort") or "").strip().lower() or None

        models.append(
            LLMModelOut(
                id=model_id,
                name=str(row.get("name") or model_id),
                free=prompt_price == 0 and completion_price == 0 and bool(pricing),
                prompt_price=prompt_price,
                completion_price=completion_price,
                context_length=context,
                reasoning=_looks_reasoning(model_id, params, row),
                structured_outputs="structured_outputs" in params or "response_format" in params,
                zero_data_retention=zdr or bool(row.get("zdr")),
                supported_efforts=efforts,
                default_effort=default_effort if default_effort in efforts else None,
                source="live",
            )
        )
    return models


def _reasoning_meta(row: dict[str, Any]) -> dict[str, Any]:
    """OpenRouter exposes `reasoning` as an object with per-model effort levels."""
    value = row.get("reasoning")
    return value if isinstance(value, dict) else {}


def _efforts(meta: dict[str, Any]) -> list[str]:
    raw = meta.get("supported_efforts")
    if not isinstance(raw, list):
        return []
    levels: list[str] = []
    for item in raw[:16]:
        level = str(item).strip().lower()
        if level and all(char.isalnum() or char in "_-" for char in level) and level not in levels:
            levels.append(level)
    return levels


def _is_chat_model(row: dict[str, Any], model_id: str) -> bool:
    lower = model_id.lower()
    if any(part in lower for part in NON_CHAT_ID_PARTS):
        return False
    arch = row.get("architecture")
    if isinstance(arch, dict):
        outputs = arch.get("output_modalities")
        if isinstance(outputs, list) and outputs and "text" not in outputs:
            return False
        modality = str(arch.get("modality") or "")
        if modality and not modality.split("->")[0].startswith("text"):
            return False
    endpoints = row.get("endpoints")
    if isinstance(endpoints, list) and endpoints:
        paths = {str(e.get("path")) if isinstance(e, dict) else str(e) for e in endpoints}
        if not paths & CHAT_ENDPOINT_PATHS:
            return False
    return True


def _price_per_million(raw: Any) -> float | None:
    """OpenRouter quotes USD per token; other providers omit pricing entirely."""
    if raw is None or raw == "":
        return None
    try:
        return round(float(raw) * 1_000_000, 4)
    except (TypeError, ValueError):
        return None


def _positive_int(raw: Any) -> int | None:
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return None
    return value if value > 0 else None


def _looks_reasoning(model_id: str, params: list[str], row: dict[str, Any]) -> bool:
    if (
        row.get("reasoning") is True
        or bool(_reasoning_meta(row))
        or "reasoning" in params
        or "reasoning_effort" in params
    ):
        return True
    slug = model_id.split("/")[-1].lower()
    return any(hint in slug for hint in REASONING_HINTS)
