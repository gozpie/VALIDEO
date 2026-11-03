"""Enregistrement d'un fichier produit par le serveur (rendu, archive) comme asset du workspace."""

import hashlib
import uuid
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ass_api.core.storage import ObjectStorage
from ass_api.db.models import Asset

CHUNK = 1024 * 1024


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(CHUNK):
            digest.update(chunk)
    return digest.hexdigest()


def store_file(
    db: Session,
    storage: ObjectStorage,
    *,
    workspace_id: uuid.UUID,
    path: Path,
    name: str,
    asset_type: str,
    mime_type: str,
    metadata: dict[str, Any],
    created_by_id: uuid.UUID | None,
) -> Asset:
    """Stocke le fichier (adressé par son SHA-256) et renvoie l'asset, existant ou créé."""
    sha256 = sha256_file(path)
    existing = db.scalars(
        select(Asset).where(Asset.workspace_id == workspace_id, Asset.sha256 == sha256)
    ).one_or_none()
    if existing is not None:
        return existing
    key = f"workspaces/{workspace_id}/assets/{sha256}"
    if not storage.exists(key):
        with path.open("rb") as handle:
            storage.upload_file(key, handle, mime_type)
    asset = Asset(
        workspace_id=workspace_id,
        name=name[:200],
        type=asset_type,
        mime_type=mime_type,
        storage_key=key,
        sha256=sha256,
        size_bytes=path.stat().st_size,
        metadata_=metadata,
        created_by_id=created_by_id,
    )
    db.add(asset)
    db.flush()
    return asset
