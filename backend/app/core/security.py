"""Password hashing (bcrypt) and JWT issuing/verification (PyJWT)."""

from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from app.config import settings


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode(), hashed.encode())
    except ValueError:
        return False


def create_access_token(subject: str, role: str, token_version: int) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
    payload = {"sub": subject, "role": role, "tv": token_version, "exp": expire}
    return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict:
    """Raises jwt.InvalidTokenError (or jwt.ExpiredSignatureError) on bad tokens.

    `exp`, `sub` and `tv` are REQUIRED, not merely verified when present: PyJWT
    only checks `exp` if the claim exists, so a correctly signed token without
    one would otherwise be valid forever, and a token without `tv` would survive
    a password change (F-38). `create_access_token` always sets all three.
    """
    return jwt.decode(
        token,
        settings.secret_key,
        algorithms=[settings.jwt_algorithm],
        options={"require": ["exp", "sub", "tv"]},
    )
