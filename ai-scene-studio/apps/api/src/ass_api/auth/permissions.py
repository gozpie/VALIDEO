"""Autorisation par workspace, vérifiée côté serveur à chaque requête.

Le workspace d'une ressource est toujours retrouvé en base à partir de la ressource elle-même :
un ``workspace_id`` fourni par le client n'est jamais cru. Une ressource d'un workspace dont
l'utilisateur n'est pas membre répond ``404`` (son existence n'est pas révélée) ; un membre dont
le rôle est insuffisant reçoit ``403``.
"""

import uuid
from dataclasses import dataclass
from enum import IntEnum

from fastapi import HTTPException, status
from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from ass_api.db.models import Project, Sequence, Shot, User, Workspace, WorkspaceMember


class Role(IntEnum):
    """Rôles ordonnés : chaque rôle inclut les droits des précédents."""

    VIEWER = 1  # lecture
    EDITOR = 2  # création et modification du contenu (projets, séquences, plans)
    ADMIN = 3  # gestion des membres, des invitations et suppression de projets
    OWNER = 4  # suppression du workspace

    @classmethod
    def parse(cls, value: str) -> "Role":
        return cls[value.upper()]

    @property
    def label(self) -> str:
        return self.name.lower()


@dataclass(frozen=True, slots=True)
class Access:
    workspace: Workspace
    role: Role


def _not_found() -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, "Ressource introuvable")


def _check(role_value: str, minimum: Role) -> Role:
    role = Role.parse(role_value)
    if role < minimum:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Droits insuffisants dans ce workspace")
    return role


def _membership_query(user: User) -> Select[Workspace, str]:
    return select(Workspace, WorkspaceMember.role).join(
        WorkspaceMember,
        (WorkspaceMember.workspace_id == Workspace.id) & (WorkspaceMember.user_id == user.id),
    )


def workspace_access(
    db: Session, user: User, workspace_id: uuid.UUID, minimum: Role, *, lock: bool = False
) -> Access:
    query = _membership_query(user).where(Workspace.id == workspace_id)
    if lock:
        query = query.with_for_update(of=Workspace)
    row = db.execute(query).one_or_none()
    if row is None:
        raise _not_found()
    workspace, role = row
    return Access(workspace, _check(role, minimum))


def project_access(
    db: Session, user: User, project_id: uuid.UUID, minimum: Role, *, lock: bool = False
) -> tuple[Project, Access]:
    query = (
        _membership_query(user)
        .add_columns(Project)
        .join(Project, Project.workspace_id == Workspace.id)
        .where(Project.id == project_id)
    )
    if lock:
        query = query.with_for_update(of=Project)
    row = db.execute(query).one_or_none()
    if row is None:
        raise _not_found()
    workspace, role, project = row
    return project, Access(workspace, _check(role, minimum))


def sequence_access(
    db: Session, user: User, sequence_id: uuid.UUID, minimum: Role, *, lock: bool = False
) -> tuple[Sequence, Project, Access]:
    query = (
        _membership_query(user)
        .add_columns(Project, Sequence)
        .join(Project, Project.workspace_id == Workspace.id)
        .join(Sequence, Sequence.project_id == Project.id)
        .where(Sequence.id == sequence_id)
    )
    if lock:
        query = query.with_for_update(of=Sequence)
    row = db.execute(query).one_or_none()
    if row is None:
        raise _not_found()
    workspace, role, project, sequence = row
    return sequence, project, Access(workspace, _check(role, minimum))


def shot_access(
    db: Session, user: User, shot_id: uuid.UUID, minimum: Role
) -> tuple[Shot, Sequence, Project, Access]:
    row = db.execute(
        _membership_query(user)
        .add_columns(Project, Sequence, Shot)
        .join(Project, Project.workspace_id == Workspace.id)
        .join(Sequence, Sequence.project_id == Project.id)
        .join(Shot, Shot.sequence_id == Sequence.id)
        .where(Shot.id == shot_id)
    ).one_or_none()
    if row is None:
        raise _not_found()
    workspace, role, project, sequence, shot = row
    return shot, sequence, project, Access(workspace, _check(role, minimum))
