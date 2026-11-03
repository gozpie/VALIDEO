"""Plans d'une séquence (ordonnés) : création, liste, lecture, modification, ordre, suppression."""

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from pydantic import Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ass_api.auth.dependencies import CurrentSessionDep
from ass_api.auth.permissions import Role, sequence_access, shot_access
from ass_api.core.api_model import ApiModel
from ass_api.db.models import Project, Shot
from ass_api.db.session import get_db
from ass_api.routes.ordering import Position, apply_order, close_gap, open_slot
from ass_api.routes.projects import Fps
from ass_api.routes.schemas import Name

router = APIRouter(tags=["shots"])
DbDep = Annotated[Session, Depends(get_db)]
DurationFrames = Annotated[int, Field(ge=1, le=10_000_000)]


class ShotIn(ApiModel):
    name: Name
    duration_frames: DurationFrames
    # Cadence propre au plan ; absente = celle du projet.
    fps: Fps | None = None
    position: Position | None = None


class ShotPatch(ApiModel):
    """Champs absents inchangés ; ``fps: null`` revient à la cadence du projet."""

    name: Name | None = None
    duration_frames: DurationFrames | None = None
    fps: Fps | None = None


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
    created_at: datetime
    updated_at: datetime


def _out(shot: Shot, project: Project) -> ShotOut:
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
        created_at=shot.created_at,
        updated_at=shot.updated_at,
    )


def _ordered(db: Session, sequence_id: uuid.UUID, project: Project) -> list[ShotOut]:
    shots = db.scalars(
        select(Shot).where(Shot.sequence_id == sequence_id).order_by(Shot.order_index)
    )
    return [_out(shot, project) for shot in shots]


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
    return _out(shot, project)


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
    db.commit()
    db.refresh(shot)
    return _out(shot, project)


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
