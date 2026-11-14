"""Authentication endpoints: login, current-user info, change own password.

Change-password (M4 T4.5) is self-service for every role: it requires the
current password so an unattended session cannot lock the owner out, and the
new password must meet the same length floor as account creation.
"""

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.core.security import create_access_token, hash_password, verify_password
from app.database import get_db
from app.models import User
from app.schemas.auth import ChangePasswordIn
from app.schemas.common import TokenOut, UserOut

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenOut)
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)) -> TokenOut:
    user = db.scalar(select(User).where(User.email == form.username))
    if user is None or not verify_password(form.password, user.hashed_password):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Incorrect email or password")
    token = create_access_token(subject=str(user.id), role=user.role.value, token_version=user.token_version)
    return TokenOut(access_token=token, role=user.role, full_name=user.full_name)


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)) -> User:
    return user


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(
    payload: ChangePasswordIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    if not verify_password(payload.current_password, user.hashed_password):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Incorrect current password")
    user.hashed_password = hash_password(payload.new_password)
    # F-38: every token issued under the old password stops authenticating. The
    # caller's own token is included, so the client must sign in again after a
    # 204 - the shared 401 handler turns the next request into that redirect.
    user.token_version = (user.token_version or 0) + 1
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
