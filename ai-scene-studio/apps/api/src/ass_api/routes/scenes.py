"""Scène d'un plan : lecture de la tête, enregistrement de révisions immuables, historique.

Concurrence optimiste : l'enregistrement indique la révision de départ (``baseRevisionId``) ; si
la tête a changé entre-temps, la requête est refusée (``409``) au lieu d'écraser le travail d'un
autre. Un snapshot identique à la tête ne crée pas de nouvelle révision.
"""

import hashlib
import uuid
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.exceptions import RequestValidationError
from pydantic import Field, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from ass_api.auth.dependencies import CurrentSessionDep
from ass_api.auth.permissions import Role, shot_access
from ass_api.core.api_model import ApiModel
from ass_api.core.storage import ObjectStorage, get_storage
from ass_api.db.models import Scene, SceneRevision, Shot
from ass_api.db.session import get_db
from ass_api.scenes.validation import (
    MAX_SNAPSHOT_BYTES,
    SceneIssue,
    SceneValidationError,
    canonical_json,
    parse_snapshot,
    validate_scene,
)

router = APIRouter(tags=["scenes"])
DbDep = Annotated[Session, Depends(get_db)]
StorageDep = Annotated[ObjectStorage, Depends(get_storage)]
HISTORY_LIMIT = 100


class RevisionOut(ApiModel):
    id: uuid.UUID
    scene_id: uuid.UUID
    parent_revision_id: uuid.UUID | None
    schema_version: int
    snapshot_hash: str
    size_bytes: int
    message: str
    created_by_id: uuid.UUID | None
    created_at: datetime


class SceneStateOut(ApiModel):
    shot_id: uuid.UUID
    scene_id: uuid.UUID | None
    head_revision: RevisionOut | None
    # Document de scène canonique (SCENE_SCHEMA.md) ; null tant que rien n'est enregistré.
    snapshot: dict[str, Any] | None


class RevisionWithSnapshotOut(RevisionOut):
    snapshot: dict[str, Any]


class SaveRevisionIn(ApiModel):
    base_revision_id: uuid.UUID | None
    message: Annotated[str, Field(max_length=500)] = ""
    snapshot: dict[str, Any]


class SaveRevisionOut(ApiModel):
    created: bool
    revision: RevisionOut


async def _save_body(request: Request) -> SaveRevisionIn:
    """Corps lu et décodé par le serveur : taille bornée, NaN/Infinity refusés avant Pydantic."""
    declared = request.headers.get("content-length")
    if declared is not None and declared.isdigit() and int(declared) > MAX_SNAPSHOT_BYTES + 4096:
        raise HTTPException(
            status.HTTP_413_CONTENT_TOO_LARGE, "Scène trop volumineuse (5 Mo maximum)"
        )
    raw = await request.body()
    if len(raw) > MAX_SNAPSHOT_BYTES + 4096:
        raise HTTPException(
            status.HTTP_413_CONTENT_TOO_LARGE, "Scène trop volumineuse (5 Mo maximum)"
        )
    try:
        return SaveRevisionIn.model_validate(parse_snapshot(raw))
    except ValidationError as exc:
        raise RequestValidationError(exc.errors(include_url=False)) from exc


def _snapshot_key(workspace_id: uuid.UUID, digest: str) -> str:
    return f"workspaces/{workspace_id}/scenes/{digest}.json"


def _load_snapshot(storage: ObjectStorage, revision: SceneRevision) -> dict[str, Any]:
    data = parse_snapshot(storage.get_bytes(revision.snapshot_key))
    assert isinstance(data, dict)  # noqa: S101 (snapshot validé à l'écriture)
    return data


def _scene_of(db: Session, shot: Shot, *, lock: bool = False) -> Scene | None:
    query = select(Scene).where(Scene.shot_id == shot.id)
    if lock:
        query = query.with_for_update()
    return db.scalars(query).one_or_none()


@router.get("/shots/{shot_id}/scene", response_model=SceneStateOut)
def get_scene(
    shot_id: uuid.UUID, current: CurrentSessionDep, db: DbDep, storage: StorageDep
) -> SceneStateOut:
    shot, _sequence, _project, _access = shot_access(db, current.user, shot_id, Role.VIEWER)
    scene = _scene_of(db, shot)
    head = (
        db.get(SceneRevision, scene.head_revision_id) if scene and scene.head_revision_id else None
    )
    return SceneStateOut(
        shot_id=shot.id,
        scene_id=scene.id if scene else None,
        head_revision=RevisionOut.model_validate(head) if head else None,
        snapshot=_load_snapshot(storage, head) if head else None,
    )


@router.post(
    "/shots/{shot_id}/scene/revisions",
    response_model=SaveRevisionOut,
    status_code=status.HTTP_201_CREATED,
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {
                "application/json": {"schema": SaveRevisionIn.model_json_schema(by_alias=True)}
            },
        }
    },
)
def save_revision(
    shot_id: uuid.UUID,
    response: Response,
    current: CurrentSessionDep,
    db: DbDep,
    storage: StorageDep,
    body: Annotated[SaveRevisionIn, Depends(_save_body)],
) -> SaveRevisionOut:
    shot, _sequence, _project, access = shot_access(db, current.user, shot_id, Role.EDITOR)
    try:
        snapshot = validate_scene(body.snapshot)
    except SceneValidationError as exc:
        raise SceneValidationError(
            [
                SceneIssue(f"snapshot.{issue.path}".rstrip("."), issue.message)
                for issue in exc.issues
            ]
        ) from exc
    scene_id = uuid.UUID(snapshot["sceneId"])

    # Verrou de la scène (ou du plan s'il n'a pas encore de scène) : enregistrements sérialisés.
    db.execute(select(Shot.id).where(Shot.id == shot.id).with_for_update())
    scene = _scene_of(db, shot, lock=True)
    head_id = scene.head_revision_id if scene else None
    if body.base_revision_id != head_id:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "La scène a été modifiée entre-temps : rechargez-la avant d'enregistrer",
        )
    if scene is not None and scene.id != scene_id:
        raise SceneValidationError([SceneIssue("snapshot.sceneId", "sceneId ne peut pas changer")])
    if scene is None and db.get(Scene, scene_id) is not None:
        raise SceneValidationError([SceneIssue("snapshot.sceneId", "sceneId déjà utilisé")])

    data = canonical_json(snapshot)
    digest = hashlib.sha256(data).hexdigest()
    head = db.get(SceneRevision, head_id) if head_id else None
    if head is not None and head.snapshot_hash == digest:
        response.status_code = status.HTTP_200_OK
        return SaveRevisionOut(created=False, revision=RevisionOut.model_validate(head))

    key = _snapshot_key(access.workspace.id, digest)
    # Écriture adressée par contenu : idempotente, et jamais d'écrasement d'un snapshot existant.
    storage.put_if_absent(key, data, "application/json")
    if scene is None:
        scene = Scene(id=scene_id, shot_id=shot.id, schema_version=snapshot["schemaVersion"])
        db.add(scene)
        db.flush()
    revision = SceneRevision(
        scene_id=scene.id,
        parent_revision_id=head_id,
        schema_version=snapshot["schemaVersion"],
        snapshot_key=key,
        snapshot_hash=digest,
        size_bytes=len(data),
        message=body.message,
        created_by_id=current.user.id,
    )
    db.add(revision)
    db.flush()
    scene.head_revision_id = revision.id
    scene.schema_version = snapshot["schemaVersion"]
    db.commit()
    db.refresh(revision)
    return SaveRevisionOut(created=True, revision=RevisionOut.model_validate(revision))


@router.get("/shots/{shot_id}/scene/revisions", response_model=list[RevisionOut])
def list_revisions(shot_id: uuid.UUID, current: CurrentSessionDep, db: DbDep) -> list[RevisionOut]:
    """Les 100 révisions les plus récentes, de la plus récente à la plus ancienne."""
    shot, _sequence, _project, _access = shot_access(db, current.user, shot_id, Role.VIEWER)
    scene = _scene_of(db, shot)
    if scene is None:
        return []
    revisions = db.scalars(
        select(SceneRevision)
        .where(SceneRevision.scene_id == scene.id)
        .order_by(SceneRevision.created_at.desc(), SceneRevision.id.desc())
        .limit(HISTORY_LIMIT)
    )
    return [RevisionOut.model_validate(revision) for revision in revisions]


@router.get("/scene-revisions/{revision_id}", response_model=RevisionWithSnapshotOut)
def get_revision(
    revision_id: uuid.UUID, current: CurrentSessionDep, db: DbDep, storage: StorageDep
) -> RevisionWithSnapshotOut:
    row = db.execute(
        select(SceneRevision, Scene.shot_id)
        .join(Scene, Scene.id == SceneRevision.scene_id)
        .where(SceneRevision.id == revision_id)
    ).one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ressource introuvable")
    revision, shot_id = row
    shot_access(db, current.user, shot_id, Role.VIEWER)  # 404 hors workspace
    return RevisionWithSnapshotOut(
        **RevisionOut.model_validate(revision).model_dump(),
        snapshot=_load_snapshot(storage, revision),
    )
