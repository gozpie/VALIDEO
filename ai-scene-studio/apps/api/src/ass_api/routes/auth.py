"""Connexion, déconnexion et session courante (cookie HttpOnly + jeton CSRF)."""

import uuid
from datetime import datetime, timedelta
from typing import Annotated

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import Field
from redis.exceptions import RedisError
from sqlalchemy import select
from sqlalchemy.orm import Session

from ass_api.auth.dependencies import CurrentSessionDep, get_rate_limiter
from ass_api.auth.passwords import MAX_LENGTH, hash_password, needs_rehash, verify_password
from ass_api.auth.rate_limit import RateLimiter, email_key, ip_key
from ass_api.auth.sessions import issue_session, normalize_email, resolve_session, revoke_session
from ass_api.core.api_model import ApiModel
from ass_api.core.config import Settings, get_settings
from ass_api.db.models import User
from ass_api.db.session import get_db

router = APIRouter(prefix="/auth", tags=["auth"])
logger = structlog.get_logger("ass_api.auth")


class LoginIn(ApiModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=1, max_length=MAX_LENGTH)


class UserOut(ApiModel):
    id: uuid.UUID
    email: str
    display_name: str
    created_at: datetime


class SessionOut(ApiModel):
    user: UserOut
    csrf_token: str
    expires_at: datetime


def _set_session_cookie(response: Response, settings: Settings, token: str) -> None:
    response.set_cookie(
        settings.session_cookie_name,
        token,
        max_age=settings.session_ttl_hours * 3600,
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite="lax",
        path="/",
    )


def _authenticate(
    db: Session, limiter: RateLimiter, settings: Settings, email: str, password: str, ip: str
) -> tuple[User, str]:
    """Utilisateur et empreinte de son mot de passe si les identifiants sont valides."""
    if (
        limiter.failures(email_key(email)) >= settings.login_max_failures_per_email
        or limiter.failures(ip_key(ip)) >= settings.login_max_failures_per_ip
    ):
        logger.warning("login_rate_limited")
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Trop de tentatives de connexion, réessayer plus tard",
            headers={"Retry-After": str(settings.login_failure_window_seconds)},
        )
    user = db.scalars(select(User).where(User.email == email)).one_or_none()
    password_hash = user.password_hash if user else None
    # verify_password est appelé même sans compte : temps de réponse comparable.
    if not verify_password(password_hash, password) or user is None or password_hash is None:
        limiter.record_failure(email_key(email))
        limiter.record_failure(ip_key(ip))
        logger.info("login_failed")
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "E-mail ou mot de passe incorrect")
    limiter.reset(email_key(email))
    return user, password_hash


@router.post("/login", response_model=SessionOut)
def login(
    body: LoginIn,
    request: Request,
    response: Response,
    db: Annotated[Session, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings)],
    limiter: Annotated[RateLimiter, Depends(get_rate_limiter)],
) -> SessionOut:
    ip = request.client.host if request.client else "unknown"
    try:
        user, password_hash = _authenticate(
            db, limiter, settings, normalize_email(body.email), body.password, ip
        )
    except RedisError as exc:
        logger.error("login_rate_limiter_unavailable", error_type=type(exc).__name__)
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Connexion momentanément indisponible"
        ) from exc

    # Nouvelle session à chaque connexion (anti-fixation) ; l'éventuelle précédente est révoquée.
    previous = request.cookies.get(settings.session_cookie_name)
    resolved = resolve_session(db, previous) if previous else None
    if resolved is not None:
        revoke_session(db, resolved[0])
    if needs_rehash(password_hash):
        user.password_hash = hash_password(body.password)
    issued = issue_session(db, user, timedelta(hours=settings.session_ttl_hours))
    db.commit()

    _set_session_cookie(response, settings, issued.token)
    logger.info("login_succeeded", user_id=str(user.id))
    return SessionOut(
        user=UserOut.model_validate(user),
        csrf_token=issued.record.csrf_token,
        expires_at=issued.record.expires_at,
    )


@router.get("/session", response_model=SessionOut)
def get_session(current: CurrentSessionDep) -> SessionOut:
    return SessionOut(
        user=UserOut.model_validate(current.user),
        csrf_token=current.record.csrf_token,
        expires_at=current.record.expires_at,
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    current: CurrentSessionDep,
    db: Annotated[Session, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Response:
    revoke_session(db, current.record)
    db.commit()
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    response.delete_cookie(
        settings.session_cookie_name,
        path="/",
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite="lax",
    )
    logger.info("logout", user_id=str(current.user.id))
    return response
