"""Invitations : création par un admin, consultation et acceptation par le titulaire du lien.

Aucun e-mail n'est envoyé par l'API : le lien (``acceptUrl``) est renvoyé une seule fois à l'admin,
qui le transmet. Seule l'empreinte du jeton est conservée. Une invitation inconnue, expirée ou déjà
utilisée répond ``404`` sans distinction.
"""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated

import structlog
from fastapi import APIRouter, Depends, HTTPException, Path, Response, status
from pydantic import Field
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ass_api.auth.dependencies import CurrentSessionDep, OptionalSessionDep
from ass_api.auth.passwords import MAX_LENGTH, WeakPasswordError, hash_password
from ass_api.auth.permissions import Role, workspace_access
from ass_api.auth.sessions import issue_session, normalize_email, revoke_session
from ass_api.auth.tokens import new_token, token_hash
from ass_api.core.api_model import ApiModel
from ass_api.core.config import Settings, get_settings
from ass_api.db.models import User, Workspace, WorkspaceInvitation, WorkspaceMember
from ass_api.db.session import get_db
from ass_api.routes.auth import SessionOut, UserOut, set_session_cookie
from ass_api.routes.schemas import DisplayName, Email, InvitableRole

router = APIRouter(tags=["invitations"])
logger = structlog.get_logger("ass_api.invitations")
DbDep = Annotated[Session, Depends(get_db)]
SettingsDep = Annotated[Settings, Depends(get_settings)]
TokenPath = Annotated[str, Path(min_length=20, max_length=100)]


class InvitationIn(ApiModel):
    email: Email
    role: InvitableRole


class InvitationOut(ApiModel):
    id: uuid.UUID
    email: str
    role: InvitableRole
    created_at: datetime
    expires_at: datetime


class CreatedInvitationOut(InvitationOut):
    # Renvoyés une seule fois : seule l'empreinte du jeton est conservée.
    token: str
    accept_url: str


class InvitationPreviewOut(ApiModel):
    workspace_name: str
    email: str
    role: InvitableRole
    expires_at: datetime
    account_exists: bool


class AcceptIn(ApiModel):
    """Champs requis seulement pour créer le compte (adresse encore inconnue)."""

    display_name: DisplayName | None = None
    password: str | None = Field(default=None, max_length=MAX_LENGTH)


def _out(invitation: WorkspaceInvitation) -> InvitationOut:
    return InvitationOut.model_validate(invitation)


@router.post(
    "/workspaces/{workspace_id}/invitations",
    response_model=CreatedInvitationOut,
    status_code=status.HTTP_201_CREATED,
)
def create_invitation(
    workspace_id: uuid.UUID,
    body: InvitationIn,
    current: CurrentSessionDep,
    db: DbDep,
    settings: SettingsDep,
) -> CreatedInvitationOut:
    access = workspace_access(db, current.user, workspace_id, Role.ADMIN, lock=True)
    email = normalize_email(body.email)
    already_member = db.execute(
        select(WorkspaceMember)
        .join(User, User.id == WorkspaceMember.user_id)
        .where(WorkspaceMember.workspace_id == workspace_id, User.email == email)
    ).first()
    if already_member is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Cette personne est déjà membre")
    # Une nouvelle invitation remplace celle qui serait encore en attente pour la même adresse.
    db.execute(
        delete(WorkspaceInvitation).where(
            WorkspaceInvitation.workspace_id == workspace_id,
            WorkspaceInvitation.email == email,
            WorkspaceInvitation.accepted_at.is_(None),
        )
    )
    token = new_token()
    invitation = WorkspaceInvitation(
        workspace_id=access.workspace.id,
        email=email,
        role=body.role,
        token_hash=token_hash(token),
        invited_by_id=current.user.id,
        expires_at=datetime.now(UTC) + timedelta(hours=settings.invitation_ttl_hours),
    )
    db.add(invitation)
    db.commit()
    logger.info(
        "invitation_created", workspace_id=str(workspace_id), invitation_id=str(invitation.id)
    )
    return CreatedInvitationOut(
        **_out(invitation).model_dump(),
        token=token,
        accept_url=f"{settings.web_base_url.rstrip('/')}/invitations/{token}",
    )


@router.get("/workspaces/{workspace_id}/invitations", response_model=list[InvitationOut])
def list_invitations(
    workspace_id: uuid.UUID, current: CurrentSessionDep, db: DbDep
) -> list[InvitationOut]:
    workspace_access(db, current.user, workspace_id, Role.ADMIN)
    invitations = db.scalars(
        select(WorkspaceInvitation)
        .where(
            WorkspaceInvitation.workspace_id == workspace_id,
            WorkspaceInvitation.accepted_at.is_(None),
            WorkspaceInvitation.expires_at > datetime.now(UTC),
        )
        .order_by(WorkspaceInvitation.created_at)
    )
    return [_out(invitation) for invitation in invitations]


@router.delete(
    "/workspaces/{workspace_id}/invitations/{invitation_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def revoke_invitation(
    workspace_id: uuid.UUID, invitation_id: uuid.UUID, current: CurrentSessionDep, db: DbDep
) -> Response:
    workspace_access(db, current.user, workspace_id, Role.ADMIN)
    invitation = db.scalars(
        select(WorkspaceInvitation).where(
            WorkspaceInvitation.id == invitation_id,
            WorkspaceInvitation.workspace_id == workspace_id,
        )
    ).one_or_none()
    if invitation is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invitation introuvable")
    db.delete(invitation)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _pending(
    db: Session, token: str, *, lock: bool = False
) -> tuple[WorkspaceInvitation, Workspace]:
    query = (
        select(WorkspaceInvitation, Workspace)
        .join(Workspace, Workspace.id == WorkspaceInvitation.workspace_id)
        .where(
            WorkspaceInvitation.token_hash == token_hash(token),
            WorkspaceInvitation.accepted_at.is_(None),
            WorkspaceInvitation.expires_at > datetime.now(UTC),
        )
    )
    if lock:
        query = query.with_for_update(of=WorkspaceInvitation)
    row = db.execute(query).one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invitation invalide ou expirée")
    invitation, workspace = row
    return invitation, workspace


@router.get("/invitations/{token}", response_model=InvitationPreviewOut)
def preview_invitation(token: TokenPath, db: DbDep) -> InvitationPreviewOut:
    invitation, workspace = _pending(db, token)
    exists = db.scalars(select(User.id).where(User.email == invitation.email)).first() is not None
    return InvitationPreviewOut.model_validate(
        {
            "workspace_name": workspace.name,
            "email": invitation.email,
            "role": invitation.role,
            "expires_at": invitation.expires_at,
            "account_exists": exists,
        }
    )


@router.post("/invitations/{token}/accept", response_model=SessionOut)
def accept_invitation(
    token: TokenPath,
    body: AcceptIn,
    response: Response,
    session: OptionalSessionDep,
    db: DbDep,
    settings: SettingsDep,
) -> SessionOut:
    invitation, _workspace = _pending(db, token, lock=True)
    user = db.scalars(select(User).where(User.email == invitation.email)).one_or_none()

    if user is not None:
        # Compte existant : il faut être connecté avec ce compte précis. Le lien ne permet jamais
        # de définir le mot de passe d'un compte existant (l'admin qui l'a créé le connaît).
        if session is None:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Connectez-vous pour accepter")
        if session.user.id != user.id:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, "Cette invitation est destinée à un autre compte"
            )
        record = session.record
    else:
        if body.display_name is None or body.password is None:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT, "Nom affiché et mot de passe requis"
            )
        try:
            password_hash = hash_password(body.password)
        except WeakPasswordError as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc
        user = User(
            email=invitation.email, display_name=body.display_name, password_hash=password_hash
        )
        db.add(user)
        db.flush()
        # Une autre session ouverte dans ce navigateur est remplacée par celle du nouveau compte.
        if session is not None:
            revoke_session(db, session.record)
        record = None

    db.add(
        WorkspaceMember(workspace_id=invitation.workspace_id, user_id=user.id, role=invitation.role)
    )
    invitation.accepted_at = datetime.now(UTC)
    issued = None
    if record is None:
        issued = issue_session(db, user, timedelta(hours=settings.session_ttl_hours))
        record = issued.record
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Déjà membre de ce workspace") from exc
    if issued is not None:
        set_session_cookie(response, settings, issued.token)
    logger.info("invitation_accepted", invitation_id=str(invitation.id), user_id=str(user.id))
    return SessionOut(
        user=UserOut.model_validate(user),
        csrf_token=record.csrf_token,
        expires_at=record.expires_at,
    )
