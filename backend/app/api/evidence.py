"""Evidence API (M4 T4.2): list per finding, manual upload, safe download.

Upload rules (acceptance: "uploaded files are not executable from the app
origin"):
- multipart, hard 5 MB cap (read-checked, not header-trusted) -> 413;
- extension allow-list (screenshots, documents, logs, capture formats) -> 415;
- stored under backend/evidence/ under a random UUID name - the original
  filename survives only as the evidence `label`, never as a path;
- downloads are served as application/octet-stream with an attachment
  Content-Disposition, resolved strictly inside the evidence directory, so a
  tampered row can never serve a file from outside it;
- file paths are never exposed in responses (EvidenceOut has no file_path).

Mutations require assessor/admin (viewer -> 403); reads need any login.
"""

import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, require_role
from app.database import get_db
from app.models import Evidence, EvidenceKind, Finding, Role, User
from app.schemas.findings import EvidenceOut

router = APIRouter(tags=["evidence"])

MAX_UPLOAD_BYTES = 5 * 1024 * 1024  # 5 MB, per the T4.2 acceptance criteria
ALLOWED_EXTENSIONS = {
    ".png", ".jpg", ".jpeg", ".gif", ".webp",  # screenshots
    ".pdf", ".txt", ".log", ".csv", ".json", ".xml",  # documents & captures
    ".zip",  # bundled raw output
}
EVIDENCE_DIR = Path(__file__).resolve().parents[1] / "evidence"  # backend/evidence

def _get_finding_or_404(db: Session, finding_id: int) -> Finding:
    finding = db.get(Finding, finding_id)
    if finding is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Finding not found")
    return finding

def _get_evidence_or_404(db: Session, evidence_id: int) -> Evidence:
    evidence = db.get(Evidence, evidence_id)
    if evidence is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Evidence not found")
    return evidence

@router.get("/findings/{finding_id}/evidence", response_model=list[EvidenceOut])
def list_evidence(
    finding_id: int,
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[Evidence]:
    _get_finding_or_404(db, finding_id)
    return list(
        db.scalars(select(Evidence).where(Evidence.finding_id == finding_id).order_by(Evidence.id))
    )

@router.post("/findings/{finding_id}/evidence", response_model=EvidenceOut, status_code=status.HTTP_201_CREATED)
async def upload_evidence(
    finding_id: int,
    file: UploadFile,
    _: User = Depends(require_role(Role.assessor, Role.admin)),
    db: Session = Depends(get_db),
) -> Evidence:
    _get_finding_or_404(db, finding_id)

    original_name = Path(file.filename or "").name
    suffix = Path(original_name).suffix.lower()
    if not original_name or suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            f"Unsupported file type. Allowed extensions: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )

    # Read one byte past the cap so an exactly-5MB file is accepted and
    # anything bigger is rejected regardless of what Content-Length claimed.
    payload = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(payload) > MAX_UPLOAD_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "File exceeds the 5 MB evidence cap")

    stored_name = uuid.uuid4().hex + suffix
    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    (EVIDENCE_DIR / stored_name).write_bytes(payload)

    evidence = Evidence(
        finding_id=finding_id,
        kind=EvidenceKind.upload,
        label=original_name,
        content="",
        file_path=stored_name,
    )
    db.add(evidence)
    db.commit()
    db.refresh(evidence)
    return evidence

@router.get("/evidence/{evidence_id}/download")
def download_evidence(
    evidence_id: int,
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FileResponse:
    evidence = _get_evidence_or_404(db, evidence_id)
    if not evidence.file_path:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Evidence has no attached file (inline content only)")

    base = EVIDENCE_DIR.resolve()
    resolved = (base / evidence.file_path).resolve()
    if not resolved.is_relative_to(base):  # a tampered row must not escape the dir
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Evidence file not available")
    if not resolved.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Evidence file not available")

    return FileResponse(
        resolved,
        media_type="application/octet-stream",
        filename=evidence.label or resolved.name,
        headers={"X-Content-Type-Options": "nosniff"},
    )
