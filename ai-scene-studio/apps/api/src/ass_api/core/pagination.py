"""Pagination par curseur (keyset) sur ``(created_at, id)``, stable si des lignes s'ajoutent."""

import base64
import binascii
import json
import uuid
from datetime import datetime
from typing import Annotated, Any

from fastapi import HTTPException, Query, status
from sqlalchemy import Select, and_, or_
from sqlalchemy.orm import InstrumentedAttribute

from ass_api.core.api_model import ApiModel

DEFAULT_LIMIT = 50
MAX_LIMIT = 200

LimitQuery = Annotated[int, Query(ge=1, le=MAX_LIMIT)]
CursorQuery = Annotated[str | None, Query(max_length=200)]


class Page[T](ApiModel):
    items: list[T]
    next_cursor: str | None


def encode_cursor(created_at: datetime, identifier: uuid.UUID) -> str:
    raw = json.dumps([created_at.isoformat(), str(identifier)]).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        created_at, identifier = json.loads(base64.urlsafe_b64decode(padded))
        return datetime.fromisoformat(created_at), uuid.UUID(identifier)
    except (ValueError, TypeError, binascii.Error) as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Curseur invalide") from exc


def paginate[Q: Select[*tuple[Any, ...]]](
    query: Q,
    created_at: InstrumentedAttribute[datetime],
    identifier: InstrumentedAttribute[uuid.UUID],
    cursor: str | None,
    limit: int,
) -> Q:
    """Ordonne par ``(created_at, id)``, reprend après le curseur et lit ``limit + 1`` lignes."""
    if cursor is not None:
        after_created, after_id = decode_cursor(cursor)
        query = query.where(
            or_(
                created_at > after_created, and_(created_at == after_created, identifier > after_id)
            )
        )
    return query.order_by(created_at, identifier).limit(limit + 1)
