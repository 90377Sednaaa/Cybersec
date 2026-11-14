"""M4 T4.5: auth hardening — change-own-password and role-guard spot checks."""

import jwt

from app.config import settings

def _login(client, email: str, password: str) -> dict[str, str]:
    token = client.post(
        "/api/auth/login", data={"username": email, "password": password}
    ).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}

def _create_user(client, auth: dict[str, str], email: str, role: str) -> None:
    resp = client.post(
        "/api/users",
        json={"email": email, "password": "startingpw123", "full_name": email, "role": role},
        headers=auth,
    )
    assert resp.status_code == 201, resp.text

def test_malformed_subject_claim_returns_401_not_500(client):
    """Regression (F-36): a correctly signed token can still be malformed. The
    old code did int(payload["sub"]) outside the try, so these produced an
    unhandled KeyError/TypeError and a 500 instead of a clean 401."""
    from datetime import datetime, timedelta, timezone

    exp = datetime.now(timezone.utc) + timedelta(hours=1)
    for payload in (
        {"role": "admin", "exp": exp},                          # no sub
        {"sub": "not-a-number", "role": "admin", "exp": exp},   # non-numeric sub
        {"sub": None, "role": "admin", "exp": exp},             # wrong type
        {"sub": ["1"], "role": "admin", "exp": exp},            # wrong type
    ):
        token = jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)
        resp = client.get("/api/targets", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 401, resp.text


def test_token_without_exp_is_rejected(client):
    """F-37: PyJWT only verifies `exp` when the claim is present, so a signed
    token with no expiry used to be valid forever."""
    token = jwt.encode({"sub": "1", "role": "admin"}, settings.secret_key, algorithm=settings.jwt_algorithm)
    resp = client.get("/api/targets", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 401, resp.text


def test_token_without_sub_is_rejected(client):
    from datetime import datetime, timedelta, timezone

    exp = datetime.now(timezone.utc) + timedelta(hours=1)
    token = jwt.encode({"role": "admin", "exp": exp}, settings.secret_key, algorithm=settings.jwt_algorithm)
    resp = client.get("/api/targets", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 401, resp.text


def test_a_normally_issued_token_still_works(client):
    """Guard against over-tightening: create_access_token sets exp and sub."""
    from app.core.security import create_access_token

    token = create_access_token("1", "admin")
    assert client.get("/api/targets", headers={"Authorization": f"Bearer {token}"}).status_code == 200

# --- change-own-password -------------------------------------------------------

def test_change_password_success_rotates_credentials(client, auth):
    _create_user(client, auth, "assessor@example.com", "assessor")
    headers = _login(client, "assessor@example.com", "startingpw123")

    resp = client.post(
        "/api/auth/change-password",
        json={"current_password": "startingpw123", "new_password": "rotatedpw456"},
        headers=headers,
    )
    assert resp.status_code == 204

    # old password must stop working immediately
    assert (
        client.post(
            "/api/auth/login",
            data={"username": "assessor@example.com", "password": "startingpw123"},
        ).status_code
        == 401
    )
    # new password works
    assert _login(client, "assessor@example.com", "rotatedpw456") is not None

def test_change_password_wrong_current_401(client, auth):
    _create_user(client, auth, "wrongpw@example.com", "assessor")
    headers = _login(client, "wrongpw@example.com", "startingpw123")
    resp = client.post(
        "/api/auth/change-password",
        json={"current_password": "notmypassword", "new_password": "rotatedpw456"},
        headers=headers,
    )
    assert resp.status_code == 401
    # and the original password still works (nothing changed)
    assert _login(client, "wrongpw@example.com", "startingpw123") is not None

def test_change_password_too_short_422(client, auth):
    resp = client.post(
        "/api/auth/change-password",
        json={"current_password": "admin123", "new_password": "short"},
        headers=auth,
    )
    assert resp.status_code == 422

def test_change_password_requires_auth(client):
    resp = client.post(
        "/api/auth/change-password",
        json={"current_password": "admin123", "new_password": "rotatedpw456"},
    )
    assert resp.status_code == 401

def test_change_password_works_for_viewer(client, auth):
    _create_user(client, auth, "viewer@example.com", "viewer")
    headers = _login(client, "viewer@example.com", "startingpw123")
    resp = client.post(
        "/api/auth/change-password",
        json={"current_password": "startingpw123", "new_password": "viewerpw456"},
        headers=headers,
    )
    assert resp.status_code == 204
    assert _login(client, "viewer@example.com", "viewerpw456") is not None

def test_change_password_wrong_current_does_not_leak_role_info(client, auth):
    # the 401 for a wrong current password must not differ from an
    # unauthenticated attempt's semantics (both are 401 with a detail string)
    headers = _login(client, "admin@example.com", "admin123")
    resp = client.post(
        "/api/auth/change-password",
        json={"current_password": "nope", "new_password": "rotatedpw456"},
        headers=headers,
    )
    body = resp.json()
    assert resp.status_code == 401 and isinstance(body["detail"], str)

# --- role matrix spot checks (the checklist's enforcement claims) --------------

def test_users_api_admin_only(client, auth):
    _create_user(client, auth, "v2@example.com", "viewer")
    viewer = _login(client, "v2@example.com", "startingpw123")
    assert client.get("/api/users", headers=viewer).status_code == 403
    assert client.get("/api/users", headers=auth).status_code == 200

def test_target_delete_admin_only(client, auth, passive_target):
    resp = client.delete(f"/api/targets/{passive_target['id']}", headers=auth)
    assert resp.status_code == 204  # admin may delete
