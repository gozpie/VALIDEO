"""Séquences d'un projet (ordonnées) : création, liste, lecture, renommage, ordre, suppression."""

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ass_api.auth.dependencies import CurrentSessionDep
from ass_api.auth.permissions import Role, project_access, sequence_access
from ass_api.core.api_model import ApiModel
from ass_api.db.models import Sequence
from ass_api.db.session import get_db
from ass_api.routes.ordering import Position, apply_order, close_gap, open_slot
from ass_api.routes.schemas import Name

router = APIRouter(tags=["sequences"])
DbDep = Annotated[Session, Depends(get_db)]


class SequenceIn(ApiModel):
    name: Name
    # Position d'insertion (0 = en tête) ; à la fin si absente ou au-delà.
    position: Position | None = None


class SequencePatch(ApiModel):
    name: Name


class SequenceOrderIn(ApiModel):
    sequence_ids: list[uuid.UUID]


class SequenceOut(ApiModel):
    id: uuid.UUID
    project_id: uuid.UUID
    name: str
    order_index: int
    created_at: datetime
    updated_at: datetime


def _ordered(db: Session, project_id: uuid.UUID) -> list[SequenceOut]:
    sequences = db.scalars(
        select(Sequence).where(Sequence.project_id == project_id).order_by(Sequence.order_index)
    )
    return [SequenceOut.model_validate(sequence) for sequence in sequences]


@router.get("/projects/{project_id}/sequences", response_model=list[SequenceOut])
def list_sequences(
    project_id: uuid.UUID, current: CurrentSessionDep, db: DbDep
) -> list[SequenceOut]:
    project_access(db, current.user, project_id, Role.VIEWER)
    return _ordered(db, project_id)


@router.post(
    "/projects/{project_id}/sequences",
    response_model=SequenceOut,
    status_code=status.HTTP_201_CREATED,
)
def create_sequence(
    project_id: uuid.UUID, body: SequenceIn, current: CurrentSessionDep, db: DbDep
) -> SequenceOut:
    # Le verrou du projet sérialise les modifications d'ordre concurrentes.
    project, _access = project_access(db, current.user, project_id, Role.EDITOR, lock=True)
    index = open_slot(db, Sequence, project.id, body.position)
    sequence = Sequence(project_id=project.id, name=body.name, order_index=index)
    db.add(sequence)
    db.commit()
    db.refresh(sequence)
    return SequenceOut.model_validate(sequence)


@router.put("/projects/{project_id}/sequences/order", response_model=list[SequenceOut])
def reorder_sequences(
    project_id: uuid.UUID, body: SequenceOrderIn, current: CurrentSessionDep, db: DbDep
) -> list[SequenceOut]:
    project, _access = project_access(db, current.user, project_id, Role.EDITOR, lock=True)
    apply_order(db, Sequence, project.id, body.sequence_ids)
    db.commit()
    return _ordered(db, project.id)


@router.get("/sequences/{sequence_id}", response_model=SequenceOut)
def get_sequence(sequence_id: uuid.UUID, current: CurrentSessionDep, db: DbDep) -> SequenceOut:
    sequence, _project, _access = sequence_access(db, current.user, sequence_id, Role.VIEWER)
    return SequenceOut.model_validate(sequence)


@router.patch("/sequences/{sequence_id}", response_model=SequenceOut)
def rename_sequence(
    sequence_id: uuid.UUID, body: SequencePatch, current: CurrentSessionDep, db: DbDep
) -> SequenceOut:
    sequence, _project, _access = sequence_access(
        db, current.user, sequence_id, Role.EDITOR, lock=True
    )
    sequence.name = body.name
    db.commit()
    db.refresh(sequence)
    return SequenceOut.model_validate(sequence)


@router.delete("/sequences/{sequence_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_sequence(sequence_id: uuid.UUID, current: CurrentSessionDep, db: DbDep) -> Response:
    sequence, project, _access = sequence_access(db, current.user, sequence_id, Role.EDITOR)
    project_access(db, current.user, project.id, Role.EDITOR, lock=True)
    db.refresh(sequence)  # position relue sous verrou : un réordonnancement a pu la changer
    db.delete(sequence)
    db.flush()
    close_gap(db, Sequence, project.id, sequence.order_index)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
