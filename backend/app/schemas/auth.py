"""Auth request schemas (M4 T4.5).

Kept out of schemas/common.py (frozen Wave-1 contract file) — new shapes in
new files, per the M4 file-placement convention.
"""

from pydantic import BaseModel, Field

class ChangePasswordIn(BaseModel):
    """POST /api/auth/change-password body.

    The current password is required so a stolen unattended session cannot
    lock the real owner out by changing their password.
    """
    current_password: str = Field(min_length=1)
    new_password: str = Field(min_length=8)  # same floor as UserCreate
