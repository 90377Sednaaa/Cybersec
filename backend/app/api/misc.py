"""Misc routes: health check only."""

from fastapi import APIRouter

router = APIRouter(tags=["misc"])


@router.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "security-platform-api"}
