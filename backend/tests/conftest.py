"""Test configuration. Environment must be set BEFORE any app import because
pydantic-settings reads env at import time."""

import os

os.environ["DATABASE_URL"] = "sqlite:///./test_platform.db"
os.environ["SECRET_KEY"] = "test-secret-key-0123456789abcdef0123456789abcdef"
os.environ["ADMIN_EMAIL"] = "admin@example.com"
os.environ["ADMIN_PASSWORD"] = "admin123"

import pathlib

import pytest
from fastapi.testclient import TestClient

_db_file = pathlib.Path("test_platform.db")
if _db_file.exists():
    _db_file.unlink()

from app.main import app  # noqa: E402
from app.database import SessionLocal  # noqa: E402
from app.models import ScanIntensity, Target  # noqa: E402


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def auth(client):
    token = (
        client.post("/api/auth/login", data={"username": "admin@example.com", "password": "admin123"})
        .json()["access_token"]
    )
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture()
def passive_target(client, auth):
    """A registered passive_safe target pointing at the API server itself."""
    resp = client.post(
        "/api/targets",
        json={
            "name": "Self",
            "base_url": "http://127.0.0.1:8000",
            "authorization_ref": "TEST-AUTH-001",
            "allowed_intensity": "passive_safe",
            "in_scope_assets": ["http://127.0.0.1:8000"],
        },
        headers=auth,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def make_target_row(intensity: ScanIntensity = ScanIntensity.passive_safe, url: str = "http://127.0.0.1:8000") -> Target:
    with SessionLocal() as db:
        target = Target(
            name="row-target",
            base_url=url,
            authorization_ref="TEST-AUTH-ROW",
            in_scope_assets=[url],
            allowed_intensity=intensity,
        )
        db.add(target)
        db.commit()
        db.refresh(target)
        return target
