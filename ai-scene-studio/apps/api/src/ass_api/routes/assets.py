"""Assets d'un workspace : envoi (GLB en phase 2), liste, métadonnées, contenu.

Le fichier transite par l'API, qui le valide avant de l'écrire dans le stockage objet sous une clé
qu'elle construit (préfixe du workspace + SHA-256). Le contenu est servi par l'API après contrôle
des droits : le stockage n'est jamais exposé au navigateur.
"""

import hashlib
import uuid
from collections.abc import Iterator
from datetime import datetime
from typing import Annotated, Any, Literal

import structlog
from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Response,
    UploadFile,
    status,
)
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ass_api.assets.glb import InvalidModelError, inspect_glb
from ass_api.auth.dependencies import CurrentSessionDep
from ass_api.auth.permissions import Role, workspace_access
from ass_api.core.api_model import ApiModel
from ass_api.core.config import Settings, get_settings
from ass_api.core.pagination import (
    DEFAULT_LIMIT,
    CursorQuery,
    LimitQuery,
    Page,
    encode_cursor,
    paginate,
)
from ass_api.core.storage import ObjectStorage, get_storage
from ass_api.db.models import Asset, User, WorkspaceMember
from ass_api.db.session import get_db

router = APIRouter(tags=["assets"])
logger = structlog.get_logger("ass_api.assets")
DbDep = Annotated[Session, Depends(get_db)]
StorageDep = Annotated[ObjectStorage, Depends(get_storage)]
GLB_MIME = "model/gltf-binary"
CHUNK = 1024 * 1024


AssetType = Literal[
    "model", "texture", "hdri", "image", "video", "audio", "reference", "render", "render_pass"
]


class AssetOut(ApiModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    name: str
    type: AssetType
    mime_type: str
    sha256: str
    size_bytes: int
    metadata: dict[str, Any]
    created_by_id: uuid.UUID | None
    created_at: datetime


class UploadedAssetOut(ApiModel):
    created: bool
    asset: AssetOut


def asset_out(asset: Asset) -> AssetOut:
    return AssetOut.model_validate(
        {
            "id": asset.id,
            "workspace_id": asset.workspace_id,
            "name": asset.name,
            "type": asset.type,
            "mime_type": asset.mime_type,
            "sha256": asset.sha256,
            "size_bytes": asset.size_bytes,
            "metadata": asset.metadata_,
            "created_by_id": asset.created_by_id,
            "created_at": asset.created_at,
        }
    )


def asset_access(db: Session, user: User, asset_id: uuid.UUID, minimum: Role) -> Asset:
    row = db.execute(
        select(Asset, WorkspaceMember.role)
        .join(
            WorkspaceMember,
            (WorkspaceMember.workspace_id == Asset.workspace_id)
            & (WorkspaceMember.user_id == user.id),
        )
        .where(Asset.id == asset_id)
    ).one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ressource introuvable")
    asset, role = row
    if Role.parse(role) < minimum:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Droits insuffisants dans ce workspace")
    return asset


@router.post(
    "/workspaces/{workspace_id}/assets",
    response_model=UploadedAssetOut,
    status_code=status.HTTP_201_CREATED,
)
def upload_asset(
    workspace_id: uuid.UUID,
    response: Response,
    current: CurrentSessionDep,
    db: DbDep,
    storage: StorageDep,
    settings: Annotated[Settings, Depends(get_settings)],
    file: Annotated[UploadFile, File(description="Fichier GLB (glTF 2.0 binaire)")],
    name: Annotated[str | None, Form(max_length=200)] = None,
) -> UploadedAssetOut:
    access = workspace_access(db, current.user, workspace_id, Role.EDITOR)
    digest = hashlib.sha256()
    size = 0
    file.file.seek(0)
    while chunk := file.file.read(CHUNK):
        size += len(chunk)
        if size > settings.asset_max_bytes:
            raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "Fichier trop volumineux")
        digest.update(chunk)
    if size == 0:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Fichier vide")
    try:
        metadata = inspect_glb(file.file, size)
    except InvalidModelError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc

    sha256 = digest.hexdigest()
    existing = db.scalars(
        select(Asset).where(Asset.workspace_id == workspace_id, Asset.sha256 == sha256)
    ).one_or_none()
    if existing is not None:
        response.status_code = status.HTTP_200_OK
        return UploadedAssetOut(created=False, asset=asset_out(existing))

    # Le nom d'origine n'est qu'un libellé : il n'entre jamais dans la clé de stockage.
    label = (name or file.filename or "Modèle").strip()[:200] or "Modèle"
    key = f"workspaces/{access.workspace.id}/assets/{sha256}"
    file.file.seek(0)
    if not storage.exists(key):
        storage.upload_file(key, file.file, GLB_MIME)
    asset = Asset(
        workspace_id=access.workspace.id,
        name=label,
        type="model",
        mime_type=GLB_MIME,
        storage_key=key,
        sha256=sha256,
        size_bytes=size,
        metadata_=metadata,
        created_by_id=current.user.id,
    )
    db.add(asset)
    try:
        db.commit()
    except IntegrityError:
        # Envoi concurrent du même contenu : l'asset existe désormais.
        db.rollback()
        response.status_code = status.HTTP_200_OK
        same = db.scalars(
            select(Asset).where(Asset.workspace_id == workspace_id, Asset.sha256 == sha256)
        ).one()
        return UploadedAssetOut(created=False, asset=asset_out(same))
    db.refresh(asset)
    logger.info("asset_uploaded", asset_id=str(asset.id), size_bytes=size)
    return UploadedAssetOut(created=True, asset=asset_out(asset))


@router.get("/workspaces/{workspace_id}/assets", response_model=Page[AssetOut])
def list_assets(
    workspace_id: uuid.UUID,
    current: CurrentSessionDep,
    db: DbDep,
    cursor: CursorQuery = None,
    limit: LimitQuery = DEFAULT_LIMIT,
    asset_type: Annotated[str | None, Query(alias="type", max_length=16)] = None,
) -> Page[AssetOut]:
    workspace_access(db, current.user, workspace_id, Role.VIEWER)
    query = select(Asset).where(Asset.workspace_id == workspace_id)
    if asset_type is not None:
        query = query.where(Asset.type == asset_type)
    assets = db.scalars(paginate(query, Asset.created_at, Asset.id, cursor, limit)).all()
    last = assets[limit - 1] if len(assets) > limit else None
    return Page(
        items=[asset_out(asset) for asset in assets[:limit]],
        next_cursor=encode_cursor(last.created_at, last.id) if last else None,
    )


@router.get("/assets/{asset_id}", response_model=AssetOut)
def get_asset(asset_id: uuid.UUID, current: CurrentSessionDep, db: DbDep) -> AssetOut:
    return asset_out(asset_access(db, current.user, asset_id, Role.VIEWER))


@router.get(
    "/assets/{asset_id}/content",
    response_class=StreamingResponse,
    responses={200: {"content": {GLB_MIME: {}}, "description": "Contenu binaire de l'asset"}},
)
def get_asset_content(
    asset_id: uuid.UUID, current: CurrentSessionDep, db: DbDep, storage: StorageDep
) -> StreamingResponse:
    asset = asset_access(db, current.user, asset_id, Role.VIEWER)
    body = storage.open_stream(asset.storage_key)

    def chunks() -> Iterator[bytes]:
        try:
            yield from body.iter_chunks(CHUNK)
        finally:
            body.close()

    return StreamingResponse(
        chunks(),
        media_type=asset.mime_type,
        headers={
            "Content-Length": str(asset.size_bytes),
            # Contenu immuable (adressé par empreinte) mais privé : jamais dans un cache partagé.
            "Cache-Control": "private, max-age=31536000, immutable",
            "ETag": f'"{asset.sha256}"',
            "Content-Disposition": "attachment",
        },
    )
