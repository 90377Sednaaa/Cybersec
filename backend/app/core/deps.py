"""FastAPI dependencies: current user resolution and role guards."""

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

import jwt

from app.core.security import decode_access_token
from app.database import get_db
from app.models import Role, User

bearer_scheme = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    try:
        payload = decode_access_token(credentials.credentials)
        # A validly signed token can still carry a missing or non-numeric sub
        # (or tv). Keep the conversions inside the guarded block so they become
        # a 401 instead of an unhandled KeyError/ValueError -> 500.
        subject = int(payload["sub"])
        token_version = int(payload["tv"])
    except jwt.InvalidTokenError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"Invalid token: {exc}") from exc
    except (KeyError, ValueError, TypeError) as exc:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, "Invalid token: missing or malformed subject"
        ) from exc

    user = db.get(User, subject)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User no longer exists")
    if token_version != user.token_version:
        # F-38: a password change bumps the row, so every token issued before
        # it stops authenticating. Stateless otherwise, but not stale-proof.
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Session revoked: the password changed. Sign in again.",
        )
    return user


def require_role(*roles: Role):
    def guard(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"Requires role: {', '.join(r.value for r in roles)}")
        return user

    return guard
