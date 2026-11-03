"""Dépendances FastAPI : utilisateur courant et vérification CSRF des requêtes modifiantes."""

from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from ass_api.auth.rate_limit import RateLimiter
from ass_api.auth.sessions import resolve_session
from ass_api.auth.tokens import same_token
from ass_api.core.config import Settings, get_settings
from ass_api.db.models import User, UserSession
from ass_api.db.session import get_db

CSRF_HEADER = "X-CSRF-Token"
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


@dataclass(frozen=True, slots=True)
class CurrentSession:
    record: UserSession
    user: User


def get_rate_limiter(request: Request) -> RateLimiter:
    limiter: RateLimiter = request.app.state.rate_limiter
    return limiter


def current_session(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> CurrentSession:
    """Exige une session valide ; pour toute méthode modifiante, exige aussi le jeton CSRF."""
    token = request.cookies.get(settings.session_cookie_name)
    resolved = resolve_session(db, token) if token else None
    if resolved is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Authentification requise")
    record, user = resolved
    if request.method not in SAFE_METHODS:
        received = request.headers.get(CSRF_HEADER, "")
        if not received or not same_token(record.csrf_token, received):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Jeton CSRF absent ou invalide")
    return CurrentSession(record=record, user=user)


CurrentSessionDep = Annotated[CurrentSession, Depends(current_session)]
