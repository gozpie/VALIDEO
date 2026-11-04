"""Montage du film (phase 7.2) : le document du moteur de montage, et les médias qu'on y importe.

Le document est produit et validé par le moteur (`@valideo/project-model`) : le serveur le conserve
tel quel, sans l'interpréter. Il vérifie la taille et, à chaque écriture, la révision attendue, pour
qu'un deuxième onglet n'écrase jamais le travail du premier sans le dire.
"""

import hashlib
import json
import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status
from pydantic import Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ass_api.auth.dependencies import CurrentSessionDep
from ass_api.auth.permissions import Role, project_access
from ass_api.core.api_model import ApiModel
from ass_api.core.config import Settings, get_settings
from ass_api.core.storage import ObjectStorage, get_storage
from ass_api.db.models import Asset, ProjectEdit
from ass_api.db.session import get_db
from ass_api.routes.assets import CHUNK, UploadedAssetOut, asset_out

router = APIRouter(tags=["montage"])

DbDep = Annotated[Session, Depends(get_db)]
StorageDep = Annotated[ObjectStorage, Depends(get_storage)]

MAX_DOCUMENT_BYTES = 8 * 1024 * 1024

# Formats importables dans le montage, avec leur signature : le type annoncé par le navigateur ne
# suffit pas, et un contenu actif (SVG, HTML) n'a rien à faire dans le stockage du projet.
MEDIA_TYPES: dict[str, Literal["image", "video", "audio"]] = {
    "image/png": "image",
    "image/jpeg": "image",
    "image/webp": "image",
    "video/mp4": "video",
    "video/quicktime": "video",
    "video/webm": "video",
    "audio/mpeg": "audio",
    "audio/mp3": "audio",
    "audio/wav": "audio",
    "audio/x-wav": "audio",
    "audio/wave": "audio",
    "audio/flac": "audio",
    "audio/x-flac": "audio",
    "audio/aac": "audio",
    "audio/mp4": "audio",
    "audio/x-m4a": "audio",
    "audio/ogg": "audio",
}


def _matches_signature(mime_type: str, head: bytes) -> bool:
    """Vrai si les premiers octets correspondent au format annoncé."""
    if mime_type == "image/png":
        return head.startswith(b"\x89PNG\r\n\x1a\n")
    if mime_type == "image/jpeg":
        return head.startswith(b"\xff\xd8\xff")
    if mime_type == "image/webp":
        return head[:4] == b"RIFF" and head[8:12] == b"WEBP"
    if mime_type in {"video/mp4", "video/quicktime", "audio/mp4", "audio/x-m4a"}:
        return head[4:8] in {b"ftyp", b"moov", b"mdat", b"wide", b"free", b"skip"}
    if mime_type == "video/webm":
        return head.startswith(b"\x1a\x45\xdf\xa3")
    if mime_type in {"audio/mpeg", "audio/mp3"}:
        return head.startswith(b"ID3") or (head[0] == 0xFF and head[1] & 0xE0 == 0xE0)
    if mime_type in {"audio/wav", "audio/x-wav", "audio/wave"}:
        return head[:4] == b"RIFF" and head[8:12] == b"WAVE"
    if mime_type in {"audio/flac", "audio/x-flac"}:
        return head.startswith(b"fLaC")
    if mime_type == "audio/aac":
        return head.startswith(b"ADIF") or (head[0] == 0xFF and head[1] & 0xF0 == 0xF0)
    if mime_type == "audio/ogg":
        return head.startswith(b"OggS")
    return False


class EditOut(ApiModel):
    document: dict[str, Any] | None
    links: dict[str, Any]
    revision: int
    updated_at: datetime | None


class EditIn(ApiModel):
    document: dict[str, Any]
    links: dict[str, Any] = Field(default_factory=dict)
    # Révision sur laquelle ce montage s'appuie ; 0 s'il n'a encore jamais été enregistré.
    expected_revision: int = Field(ge=0)


class EditSavedOut(ApiModel):
    revision: int
    updated_at: datetime


@router.get("/projects/{project_id}/edit", response_model=EditOut)
def get_edit(project_id: uuid.UUID, current: CurrentSessionDep, db: DbDep) -> EditOut:
    project, _access = project_access(db, current.user, project_id, Role.VIEWER)
    edit = db.get(ProjectEdit, project.id)
    if edit is None:
        return EditOut(document=None, links={}, revision=0, updated_at=None)
    return EditOut(
        document=edit.document,
        links=edit.links,
        revision=edit.revision,
        updated_at=edit.updated_at,
    )


@router.put("/projects/{project_id}/edit", response_model=EditSavedOut)
def put_edit(
    project_id: uuid.UUID, body: EditIn, current: CurrentSessionDep, db: DbDep
) -> EditSavedOut:
    project, _access = project_access(db, current.user, project_id, Role.EDITOR)
    if len(json.dumps(body.document)) + len(json.dumps(body.links)) > MAX_DOCUMENT_BYTES:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "Montage trop volumineux")
    edit = db.scalars(
        select(ProjectEdit).where(ProjectEdit.project_id == project.id).with_for_update()
    ).one_or_none()
    current_revision = edit.revision if edit is not None else 0
    if body.expected_revision != current_revision:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Ce montage a été modifié ailleurs entre-temps"
        )
    if edit is None:
        edit = ProjectEdit(
            project_id=project.id,
            document=body.document,
            links=body.links,
            revision=1,
            updated_by_id=current.user.id,
        )
        db.add(edit)
    else:
        edit.document = body.document
        edit.links = body.links
        edit.revision = current_revision + 1
        edit.updated_by_id = current.user.id
    try:
        db.commit()
    except IntegrityError as exc:
        # Premier enregistrement concurrent : l'autre onglet est passé avant.
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Ce montage a été modifié ailleurs entre-temps"
        ) from exc
    db.refresh(edit)
    return EditSavedOut(revision=edit.revision, updated_at=edit.updated_at)


@router.post(
    "/projects/{project_id}/edit/media",
    response_model=UploadedAssetOut,
    status_code=status.HTTP_201_CREATED,
)
def upload_edit_media(
    project_id: uuid.UUID,
    response: Response,
    current: CurrentSessionDep,
    db: DbDep,
    storage: StorageDep,
    settings: Annotated[Settings, Depends(get_settings)],
    file: Annotated[UploadFile, File(description="Image, vidéo ou son à monter")],
    name: Annotated[str | None, Form(max_length=200)] = None,
) -> UploadedAssetOut:
    """Conserve un média importé dans le montage (musique, son, image) : il suit le projet."""
    project, access = project_access(db, current.user, project_id, Role.EDITOR)
    mime_type = (file.content_type or "").split(";")[0].strip().lower()
    kind = MEDIA_TYPES.get(mime_type)
    if kind is None:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Format non pris en charge")
    digest = hashlib.sha256()
    size = 0
    file.file.seek(0)
    head = file.file.read(16)
    file.file.seek(0)
    while chunk := file.file.read(CHUNK):
        size += len(chunk)
        if size > settings.asset_max_bytes:
            raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "Fichier trop volumineux")
        digest.update(chunk)
    if size == 0:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Fichier vide")
    if len(head) < 12 or not _matches_signature(mime_type, head):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Le contenu ne correspond pas au format annoncé"
        )

    workspace_id = access.workspace.id
    sha256 = digest.hexdigest()
    existing = db.scalars(
        select(Asset).where(Asset.workspace_id == workspace_id, Asset.sha256 == sha256)
    ).one_or_none()
    if existing is not None:
        response.status_code = status.HTTP_200_OK
        return UploadedAssetOut(created=False, asset=asset_out(existing))

    label = (name or file.filename or "Média").strip()[:200] or "Média"
    key = f"workspaces/{workspace_id}/assets/{sha256}"
    file.file.seek(0)
    if not storage.exists(key):
        storage.upload_file(key, file.file, mime_type)
    asset = Asset(
        workspace_id=workspace_id,
        name=label,
        type=kind,
        mime_type=mime_type,
        storage_key=key,
        sha256=sha256,
        size_bytes=size,
        metadata_={"source": "montage", "projectId": str(project.id)},
        created_by_id=current.user.id,
    )
    db.add(asset)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        response.status_code = status.HTTP_200_OK
        same = db.scalars(
            select(Asset).where(Asset.workspace_id == workspace_id, Asset.sha256 == sha256)
        ).one()
        return UploadedAssetOut(created=False, asset=asset_out(same))
    db.refresh(asset)
    return UploadedAssetOut(created=True, asset=asset_out(asset))
