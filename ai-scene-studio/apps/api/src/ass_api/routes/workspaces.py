"""Workspaces de l'utilisateur connecté : création, liste, lecture, renommage, suppression."""

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ass_api.auth.dependencies import CurrentSessionDep
from ass_api.auth.permissions import Role, workspace_access
from ass_api.core.api_model import ApiModel
from ass_api.core.pagination import (
    DEFAULT_LIMIT,
    CursorQuery,
    LimitQuery,
    Page,
    encode_cursor,
    paginate,
)
from ass_api.db.models import Workspace, WorkspaceMember
from ass_api.db.session import get_db
from ass_api.routes.schemas import WorkspaceName

router = APIRouter(prefix="/workspaces", tags=["workspaces"])
DbDep = Annotated[Session, Depends(get_db)]


class WorkspaceIn(ApiModel):
    name: WorkspaceName


class WorkspaceOut(ApiModel):
    id: uuid.UUID
    name: str
    owner_id: uuid.UUID
    role: str
    created_at: datetime
    updated_at: datetime


def _out(workspace: Workspace, role: Role | str) -> WorkspaceOut:
    label = role.label if isinstance(role, Role) else role
    return WorkspaceOut(
        id=workspace.id,
        name=workspace.name,
        owner_id=workspace.owner_id,
        role=label,
        created_at=workspace.created_at,
        updated_at=workspace.updated_at,
    )


@router.post("", response_model=WorkspaceOut, status_code=status.HTTP_201_CREATED)
def create_workspace(body: WorkspaceIn, current: CurrentSessionDep, db: DbDep) -> WorkspaceOut:
    workspace = Workspace(name=body.name, owner_id=current.user.id)
    db.add(workspace)
    db.flush()
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=current.user.id, role="owner"))
    db.commit()
    return _out(workspace, Role.OWNER)


@router.get("", response_model=Page[WorkspaceOut])
def list_workspaces(
    current: CurrentSessionDep,
    db: DbDep,
    cursor: CursorQuery = None,
    limit: LimitQuery = DEFAULT_LIMIT,
) -> Page[WorkspaceOut]:
    query = select(Workspace, WorkspaceMember.role).join(
        WorkspaceMember,
        (WorkspaceMember.workspace_id == Workspace.id)
        & (WorkspaceMember.user_id == current.user.id),
    )
    rows = db.execute(paginate(query, Workspace.created_at, Workspace.id, cursor, limit)).all()
    items = [_out(workspace, role) for workspace, role in rows[:limit]]
    last = rows[limit - 1][0] if len(rows) > limit else None
    return Page(items=items, next_cursor=encode_cursor(last.created_at, last.id) if last else None)


@router.get("/{workspace_id}", response_model=WorkspaceOut)
def get_workspace(workspace_id: uuid.UUID, current: CurrentSessionDep, db: DbDep) -> WorkspaceOut:
    access = workspace_access(db, current.user, workspace_id, Role.VIEWER)
    return _out(access.workspace, access.role)


@router.patch("/{workspace_id}", response_model=WorkspaceOut)
def rename_workspace(
    workspace_id: uuid.UUID, body: WorkspaceIn, current: CurrentSessionDep, db: DbDep
) -> WorkspaceOut:
    access = workspace_access(db, current.user, workspace_id, Role.ADMIN, lock=True)
    access.workspace.name = body.name
    db.commit()
    db.refresh(access.workspace)
    return _out(access.workspace, access.role)


@router.delete("/{workspace_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_workspace(workspace_id: uuid.UUID, current: CurrentSessionDep, db: DbDep) -> Response:
    access = workspace_access(db, current.user, workspace_id, Role.OWNER, lock=True)
    db.delete(access.workspace)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
