"""Plans d'une séquence (ordonnés) : création, liste, lecture, modification, ordre, suppression.

Depuis la phase 6, un plan porte aussi son découpage (description, intention, dialogue, valeur,
caméra), son mode de fabrication, son statut, ses prompts, ses liens à la bible et sa version
retenue.
"""

import uuid
from collections.abc import Iterable
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ass_api.auth.dependencies import CurrentSessionDep
from ass_api.auth.permissions import Role, sequence_access, shot_access
from ass_api.core.api_model import ApiModel
from ass_api.db.models import BibleEntry, Project, Shot, ShotBibleLink, ShotVersion
from ass_api.db.session import get_db
from ass_api.routes.ordering import Position, apply_order, close_gap, open_slot
from ass_api.routes.projects import Fps
from ass_api.routes.schemas import Name

router = APIRouter(tags=["shots"])
DbDep = Annotated[Session, Depends(get_db)]
DurationFrames = Annotated[int, Field(ge=1, le=10_000_000)]
Approach = Literal["image_to_video", "multishot", "text_to_video", "still", "scene_3d"]
ShotStatus = Literal["todo", "in_progress", "review", "approved"]
LongText = Annotated[str, Field(max_length=20_000)]
ShortText = Annotated[str, Field(max_length=80)]


class ShotDetails(ApiModel):
    """Champs du découpage, communs à la création, à la modification et à la lecture."""

    description: LongText | None = None
    intention: LongText | None = None
    dialogue: LongText | None = None
    shot_size: ShortText | None = None
    camera: LongText | None = None
    approach: Approach | None = None
    status: ShotStatus | None = None
    image_prompt: LongText | None = None
    video_prompt: LongText | None = None
    negative_prompt: LongText | None = None


class ShotIn(ShotDetails):
    name: Name
    duration_frames: DurationFrames
    # Cadence propre au plan ; absente = celle du projet.
    fps: Fps | None = None
    position: Position | None = None


class ShotPatch(ShotDetails):
    """Champs absents inchangés ; ``fps: null`` revient à la cadence du projet."""

    name: Name | None = None
    duration_frames: DurationFrames | None = None
    fps: Fps | None = None
    bible_entry_ids: Annotated[list[uuid.UUID], Field(max_length=100)] | None = None
    selected_version_id: uuid.UUID | None = None


class ShotOrderIn(ApiModel):
    shot_ids: list[uuid.UUID]


class ShotOut(ApiModel):
    id: uuid.UUID
    sequence_id: uuid.UUID
    project_id: uuid.UUID
    name: str
    order_index: int
    duration_frames: int
    fps: Fps | None
    effective_fps: Fps
    description: str
    intention: str
    dialogue: str
    shot_size: str
    camera: str
    approach: Approach
    status: ShotStatus
    image_prompt: str
    video_prompt: str
    negative_prompt: str
    bible_entry_ids: list[uuid.UUID]
    selected_version_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime


DETAIL_FIELDS = tuple(ShotDetails.model_fields)


def bible_links(db: Session, shot_ids: Iterable[uuid.UUID]) -> dict[uuid.UUID, list[uuid.UUID]]:
    links: dict[uuid.UUID, list[uuid.UUID]] = {}
    ids = list(shot_ids)
    if not ids:
        return links
    for shot_id, entry_id in db.execute(
        select(ShotBibleLink.shot_id, ShotBibleLink.entry_id)
        .join(BibleEntry, BibleEntry.id == ShotBibleLink.entry_id)
        .where(ShotBibleLink.shot_id.in_(ids))
        .order_by(BibleEntry.kind, BibleEntry.order_index, BibleEntry.name)
    ):
        links.setdefault(shot_id, []).append(entry_id)
    return links


def apply_details(shot: Shot, body: ShotDetails) -> None:
    for field in DETAIL_FIELDS:
        value = getattr(body, field)
        if value is not None:
            setattr(shot, field, value)


def set_bible_links(
    db: Session, shot: Shot, project_id: uuid.UUID, entry_ids: list[uuid.UUID]
) -> None:
    wanted = set(entry_ids)
    known = set(
        db.scalars(
            select(BibleEntry.id).where(
                BibleEntry.project_id == project_id, BibleEntry.id.in_(wanted)
            )
        )
    )
    if known != wanted:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Élément de bible inconnu dans ce projet"
        )
    db.execute(delete(ShotBibleLink).where(ShotBibleLink.shot_id == shot.id))
    for entry_id in wanted:
        db.add(ShotBibleLink(shot_id=shot.id, entry_id=entry_id))


def shot_out(shot: Shot, project: Project, links: list[uuid.UUID] | None = None) -> ShotOut:
    return _out(shot, project, links or [])


def _out(shot: Shot, project: Project, links: list[uuid.UUID] | None = None) -> ShotOut:
    override = (
        Fps(numerator=shot.fps_numerator, denominator=shot.fps_denominator)
        if shot.fps_numerator is not None and shot.fps_denominator is not None
        else None
    )
    return ShotOut(
        id=shot.id,
        sequence_id=shot.sequence_id,
        project_id=project.id,
        name=shot.name,
        order_index=shot.order_index,
        duration_frames=shot.duration_frames,
        fps=override,
        effective_fps=override
        or Fps(numerator=project.fps_numerator, denominator=project.fps_denominator),
        description=shot.description,
        intention=shot.intention,
        dialogue=shot.dialogue,
        shot_size=shot.shot_size,
        camera=shot.camera,
        approach=shot.approach,
        status=shot.status,
        image_prompt=shot.image_prompt,
        video_prompt=shot.video_prompt,
        negative_prompt=shot.negative_prompt,
        bible_entry_ids=links or [],
        selected_version_id=shot.selected_version_id,
        created_at=shot.created_at,
        updated_at=shot.updated_at,
    )


def _ordered(db: Session, sequence_id: uuid.UUID, project: Project) -> list[ShotOut]:
    shots = list(
        db.scalars(select(Shot).where(Shot.sequence_id == sequence_id).order_by(Shot.order_index))
    )
    links = bible_links(db, (shot.id for shot in shots))
    return [_out(shot, project, links.get(shot.id)) for shot in shots]


@router.get("/sequences/{sequence_id}/shots", response_model=list[ShotOut])
def list_shots(sequence_id: uuid.UUID, current: CurrentSessionDep, db: DbDep) -> list[ShotOut]:
    sequence, project, _access = sequence_access(db, current.user, sequence_id, Role.VIEWER)
    return _ordered(db, sequence.id, project)


@router.post(
    "/sequences/{sequence_id}/shots",
    response_model=ShotOut,
    status_code=status.HTTP_201_CREATED,
)
def create_shot(
    sequence_id: uuid.UUID, body: ShotIn, current: CurrentSessionDep, db: DbDep
) -> ShotOut:
    sequence, project, _access = sequence_access(
        db, current.user, sequence_id, Role.EDITOR, lock=True
    )
    shot = Shot(
        sequence_id=sequence.id,
        name=body.name,
        order_index=open_slot(db, Shot, sequence.id, body.position),
        duration_frames=body.duration_frames,
        fps_numerator=body.fps.numerator if body.fps else None,
        fps_denominator=body.fps.denominator if body.fps else None,
    )
    apply_details(shot, body)
    db.add(shot)
    db.commit()
    db.refresh(shot)
    return _out(shot, project)


@router.put("/sequences/{sequence_id}/shots/order", response_model=list[ShotOut])
def reorder_shots(
    sequence_id: uuid.UUID, body: ShotOrderIn, current: CurrentSessionDep, db: DbDep
) -> list[ShotOut]:
    sequence, project, _access = sequence_access(
        db, current.user, sequence_id, Role.EDITOR, lock=True
    )
    apply_order(db, Shot, sequence.id, body.shot_ids)
    db.commit()
    return _ordered(db, sequence.id, project)


@router.get("/shots/{shot_id}", response_model=ShotOut)
def get_shot(shot_id: uuid.UUID, current: CurrentSessionDep, db: DbDep) -> ShotOut:
    shot, _sequence, project, _access = shot_access(db, current.user, shot_id, Role.VIEWER)
    return _out(shot, project, bible_links(db, [shot.id]).get(shot.id))


@router.patch("/shots/{shot_id}", response_model=ShotOut)
def update_shot(
    shot_id: uuid.UUID, body: ShotPatch, current: CurrentSessionDep, db: DbDep
) -> ShotOut:
    shot, _sequence, project, _access = shot_access(db, current.user, shot_id, Role.EDITOR)
    if body.name is not None:
        shot.name = body.name
    if body.duration_frames is not None:
        shot.duration_frames = body.duration_frames
    if "fps" in body.model_fields_set:
        shot.fps_numerator = body.fps.numerator if body.fps else None
        shot.fps_denominator = body.fps.denominator if body.fps else None
    apply_details(shot, body)
    if body.bible_entry_ids is not None:
        set_bible_links(db, shot, project.id, body.bible_entry_ids)
    if "selected_version_id" in body.model_fields_set:
        version_id = body.selected_version_id
        if version_id is not None:
            version = db.get(ShotVersion, version_id)
            if version is None or version.shot_id != shot.id:
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_CONTENT, "Version inconnue pour ce plan"
                )
        shot.selected_version_id = version_id
    db.commit()
    db.refresh(shot)
    return _out(shot, project, bible_links(db, [shot.id]).get(shot.id))


@router.delete("/shots/{shot_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_shot(shot_id: uuid.UUID, current: CurrentSessionDep, db: DbDep) -> Response:
    shot, sequence, _project, _access = shot_access(db, current.user, shot_id, Role.EDITOR)
    sequence_access(db, current.user, sequence.id, Role.EDITOR, lock=True)
    db.refresh(shot)  # position relue sous verrou : un réordonnancement a pu la changer
    db.delete(shot)
    db.flush()
    close_gap(db, Shot, sequence.id, shot.order_index)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
