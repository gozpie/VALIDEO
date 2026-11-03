"""Membres d'un workspace : liste, changement de rôle, retrait (ou départ volontaire)."""

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ass_api.auth.dependencies import CurrentSessionDep
from ass_api.auth.permissions import Role, workspace_access
from ass_api.core.api_model import ApiModel
from ass_api.db.models import User, WorkspaceMember
from ass_api.db.session import get_db
from ass_api.routes.schemas import InvitableRole, RoleName

router = APIRouter(prefix="/workspaces/{workspace_id}/members", tags=["members"])
DbDep = Annotated[Session, Depends(get_db)]


class MemberOut(ApiModel):
    user_id: uuid.UUID
    email: str
    display_name: str
    role: RoleName
    created_at: datetime


class MemberRoleIn(ApiModel):
    role: InvitableRole


def _member(
    db: Session, workspace_id: uuid.UUID, user_id: uuid.UUID
) -> tuple[WorkspaceMember, User]:
    row = db.execute(
        select(WorkspaceMember, User)
        .join(User, User.id == WorkspaceMember.user_id)
        .where(WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.user_id == user_id)
        .with_for_update(of=WorkspaceMember)
    ).one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Membre introuvable")
    member, user = row
    return member, user


def _out(member: WorkspaceMember, user: User) -> MemberOut:
    return MemberOut.model_validate(
        {
            "user_id": user.id,
            "email": user.email,
            "display_name": user.display_name,
            "role": member.role,
            "created_at": member.created_at,
        }
    )


@router.get("", response_model=list[MemberOut])
def list_members(workspace_id: uuid.UUID, current: CurrentSessionDep, db: DbDep) -> list[MemberOut]:
    workspace_access(db, current.user, workspace_id, Role.VIEWER)
    rows = db.execute(
        select(WorkspaceMember, User)
        .join(User, User.id == WorkspaceMember.user_id)
        .where(WorkspaceMember.workspace_id == workspace_id)
        .order_by(WorkspaceMember.created_at, User.id)
    ).all()
    return [_out(member, user) for member, user in rows]


@router.patch("/{user_id}", response_model=MemberOut)
def change_role(
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    body: MemberRoleIn,
    current: CurrentSessionDep,
    db: DbDep,
) -> MemberOut:
    workspace_access(db, current.user, workspace_id, Role.ADMIN, lock=True)
    member, user = _member(db, workspace_id, user_id)
    if member.role == "owner":
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Le rôle du propriétaire ne peut pas changer"
        )
    member.role = body.role
    db.commit()
    return _out(member, user)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_member(
    workspace_id: uuid.UUID, user_id: uuid.UUID, current: CurrentSessionDep, db: DbDep
) -> Response:
    # Quitter un workspace est permis à tout membre ; retirer quelqu'un d'autre exige admin.
    leaving = user_id == current.user.id
    workspace_access(
        db, current.user, workspace_id, Role.VIEWER if leaving else Role.ADMIN, lock=True
    )
    member, _user = _member(db, workspace_id, user_id)
    if member.role == "owner":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Le propriétaire ne peut pas être retiré")
    db.delete(member)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
