"""Ordre des séquences d'un projet et des plans d'une séquence (``order_index`` contigu 0..n-1).

L'unicité de l'ordre est contrôlée en fin de transaction (contrainte différée) : les décalages se
font en une transaction, après verrouillage de la ligne parente par l'appelant.
"""

import uuid
from typing import Annotated

from fastapi import HTTPException, status
from pydantic import Field
from sqlalchemy import func, select, update
from sqlalchemy.orm import InstrumentedAttribute, Session

from ass_api.db.models import Sequence, Shot

Position = Annotated[int, Field(ge=0)]
OrderedModel = type[Sequence] | type[Shot]


def _parent_column(model: OrderedModel) -> InstrumentedAttribute[uuid.UUID]:
    return Sequence.project_id if model is Sequence else Shot.sequence_id


def count_children(db: Session, model: OrderedModel, parent_id: uuid.UUID) -> int:
    parent = _parent_column(model)
    return int(db.scalar(select(func.count()).select_from(model).where(parent == parent_id)) or 0)


def open_slot(db: Session, model: OrderedModel, parent_id: uuid.UUID, position: int | None) -> int:
    """Index d'insertion (fin par défaut) ; décale les éléments suivants d'un cran."""
    size = count_children(db, model, parent_id)
    index = size if position is None else min(position, size)
    if index < size:
        db.execute(
            update(model)
            .where(_parent_column(model) == parent_id, model.order_index >= index)
            .values(order_index=model.order_index + 1)
        )
    return index


def close_gap(db: Session, model: OrderedModel, parent_id: uuid.UUID, removed_index: int) -> None:
    db.execute(
        update(model)
        .where(_parent_column(model) == parent_id, model.order_index > removed_index)
        .values(order_index=model.order_index - 1)
    )


def apply_order(
    db: Session, model: OrderedModel, parent_id: uuid.UUID, ordered_ids: list[uuid.UUID]
) -> None:
    """Applique un ordre complet ; la liste doit contenir exactement les éléments du parent."""
    current = set(db.scalars(select(model.id).where(_parent_column(model) == parent_id)))
    if len(ordered_ids) != len(set(ordered_ids)) or set(ordered_ids) != current:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "L'ordre doit lister chaque élément du parent exactement une fois",
        )
    for index, identifier in enumerate(ordered_ids):
        db.execute(update(model).where(model.id == identifier).values(order_index=index))
