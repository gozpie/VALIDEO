"""Création, résolution et révocation des sessions de connexion."""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ass_api.auth.tokens import new_token, token_hash
from ass_api.db.models import User, UserSession


@dataclass(frozen=True, slots=True)
class IssuedSession:
    token: str
    record: UserSession


def normalize_email(email: str) -> str:
    return email.strip().lower()


def issue_session(db: Session, user: User, ttl: timedelta) -> IssuedSession:
    token = new_token()
    record = UserSession(
        token_hash=token_hash(token),
        user_id=user.id,
        csrf_token=new_token(),
        expires_at=datetime.now(UTC) + ttl,
    )
    db.add(record)
    db.flush()
    return IssuedSession(token=token, record=record)


def resolve_session(db: Session, token: str) -> tuple[UserSession, User] | None:
    """Session valide et son utilisateur, ou ``None`` (jeton inconnu ou expiré)."""
    row = db.execute(
        select(UserSession, User)
        .join(User, User.id == UserSession.user_id)
        .where(UserSession.token_hash == token_hash(token))
    ).one_or_none()
    if row is None:
        return None
    record, user = row
    if record.expires_at <= datetime.now(UTC):
        db.delete(record)
        db.commit()
        return None
    return record, user


def revoke_session(db: Session, record: UserSession) -> None:
    db.execute(delete(UserSession).where(UserSession.id == record.id))
