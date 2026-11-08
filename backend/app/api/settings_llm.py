"""LLM provider settings API (M2 T2.2).

Contract (Wave-1 sketch, additive):
    GET  /api/settings/llm                      -> {providers[], task_configs[]}
    POST /api/settings/llm/providers            -> LLMProviderOut (201)
    PUT  /api/settings/llm/providers/{id}       -> LLMProviderOut
    PUT  /api/settings/llm/tasks/{task}         -> LLMTaskOut
    POST /api/settings/llm/test                 -> {ok, model, latency_ms, error?}

Hard rules encoded here:
- the API key is write-only: accepted in the body, stored Fernet-encrypted,
  never returned (responses expose `has_api_key` only);
- only admins configure providers; viewers/assessors get 403 on mutations;
- discretion: enabling a provider requires `acknowledged_external_processing`
  - the admin's explicit, auditable acknowledgment that redacted scan data
  may be sent to an external AI service (400 without it).
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai import client as ai_client
from app.database import get_db
from app.core.deps import require_role
from app.models import Role, User
from app.models.llm import LLMTask, LLMTaskConfig, LLMProvider, encrypt_secret
from app.models.user import utcnow
from app.schemas.common import (
    LLMProviderIn,
    LLMProviderOut,
    LLMSettingsOut,
    LLMTaskOut,
    LLMTaskUpdate,
    LLMTestConnectionIn,
    LLMTestConnectionOut,
)

router = APIRouter(prefix="/settings/llm", tags=["settings"])

PING_MESSAGES = [
    {"role": "system", "content": "This is a connectivity check from the Aletheia security platform. Reply with the single word: pong."},
    {"role": "user", "content": "ping"},
]


def _ensure_task_configs(db: Session) -> None:
    existing = {row.task for row in db.scalars(select(LLMTaskConfig))}
    for task in LLMTask:
        if task not in existing:
            db.add(LLMTaskConfig(task=task))
    db.commit()


def _get_provider_or_404(db: Session, provider_id: int) -> LLMProvider:
    provider = db.get(LLMProvider, provider_id)
    if provider is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Provider {provider_id} not found")
    return provider


@router.get("", response_model=LLMSettingsOut)
def read_settings(db: Session = Depends(get_db), user: User = Depends(require_role(Role.admin, Role.assessor, Role.viewer))) -> LLMSettingsOut:
    _ensure_task_configs(db)
    providers = list(db.scalars(select(LLMProvider).order_by(LLMProvider.id)))
    configs = list(db.scalars(select(LLMTaskConfig).order_by(LLMTaskConfig.id)))
    return LLMSettingsOut(
        providers=[LLMProviderOut.model_validate(p) for p in providers],
        task_configs=[LLMTaskOut.model_validate(c) for c in configs],
    )


@router.post("/providers", response_model=LLMProviderOut, status_code=status.HTTP_201_CREATED)
def create_provider(
    body: LLMProviderIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_role(Role.admin)),
) -> LLMProvider:
    _require_ack_if_enabling(body)
    provider = LLMProvider(
        name=body.name,
        base_url=body.base_url,
        api_key_encrypted=encrypt_secret(body.api_key) if body.api_key else "",
        enabled=body.enabled,
        acknowledged_external_at=utcnow() if body.acknowledged_external_processing else None,
    )
    db.add(provider)
    db.commit()
    db.refresh(provider)
    return provider


@router.put("/providers/{provider_id}", response_model=LLMProviderOut)
def update_provider(
    provider_id: int,
    body: LLMProviderIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_role(Role.admin)),
) -> LLMProvider:
    provider = _get_provider_or_404(db, provider_id)
    _require_ack_if_enabling(body, provider)
    if body.name:
        provider.name = body.name
    if body.base_url:
        provider.base_url = body.base_url
    if body.api_key:  # write-only: empty string leaves the stored key untouched
        provider.api_key_encrypted = encrypt_secret(body.api_key)
    if body.acknowledged_external_processing is True:
        provider.acknowledged_external_at = utcnow()
    provider.enabled = body.enabled
    db.commit()
    db.refresh(provider)
    return provider


def _require_ack_if_enabling(body: LLMProviderIn, existing: LLMProvider | None = None) -> None:
    """enabling=True requires an explicit or already-recorded acknowledgment."""
    if not body.enabled:
        return
    already_acknowledged = existing is not None and existing.acknowledged_external_at is not None
    if body.acknowledged_external_processing is True or already_acknowledged:
        return
    raise HTTPException(
        status.HTTP_400_BAD_REQUEST,
        "Enabling a provider requires acknowledged_external_processing=true: "
        "redacted scan data may be sent to this external AI service.",
    )


@router.put("/tasks/{task}", response_model=LLMTaskOut)
def update_task(
    task: str,
    body: LLMTaskUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_role(Role.admin)),
) -> LLMTaskConfig:
    _ensure_task_configs(db)
    config = db.scalar(select(LLMTaskConfig).where(LLMTaskConfig.task == task))
    if config is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Unknown task '{task}'")
    if body.provider_id is not None and db.get(LLMProvider, body.provider_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Provider {body.provider_id} not found")
    config.provider_id = body.provider_id
    config.model = body.model
    config.temperature = body.temperature
    db.commit()
    db.refresh(config)
    return config


@router.post("/test", response_model=LLMTestConnectionOut)
def test_connection(
    body: LLMTestConnectionIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_role(Role.admin)),
) -> LLMTestConnectionOut:
    """Provider connectivity probe. Returns ok/model/latency - or ok=true with
    an error message; never a 500, and never any key material."""
    provider = _get_provider_or_404(db, body.provider_id)
    try:
        config = _probe_task_config(db, provider)
        result = ai_client.chat(db, config.task, PING_MESSAGES, max_tokens=10, timeout=30.0)
        return LLMTestConnectionOut(ok=True, model=result.model, latency_ms=result.latency_ms)
    except (ai_client.NoProviderConfigured, ai_client.LLMRequestError) as exc:
        return LLMTestConnectionOut(ok=False, error=str(exc))


def _probe_task_config(db: Session, provider: LLMProvider) -> LLMTaskConfig:
    configs = list(db.scalars(select(LLMTaskConfig).where(LLMTaskConfig.provider_id == provider.id).order_by(LLMTaskConfig.id)))
    for task in (LLMTask.interpretation, LLMTask.summary):
        for config in configs:
            if config.task == task and config.model:
                return config
    if configs:
        return configs[0]
    raise ai_client.NoProviderConfigured(f"No task model is configured for provider '{provider.name}'")
