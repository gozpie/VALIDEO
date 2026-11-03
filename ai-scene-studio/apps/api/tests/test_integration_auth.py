"""Parcours d'authentification complet contre un vrai PostgreSQL (ASS_RUN_INTEGRATION=1).

Le limiteur est remplacé par sa version en mémoire, sauf dans les tests Redis dédiés.
"""

import os
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pytest
import redis
from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select, update
from sqlalchemy.orm import Session, sessionmaker

from ass_api.auth.dependencies import CSRF_HEADER, get_rate_limiter
from ass_api.auth.passwords import hash_password
from ass_api.auth.rate_limit import InMemoryRateLimiter, RedisRateLimiter
from ass_api.auth.tokens import token_hash
from ass_api.core.config import Settings, get_settings
from ass_api.db.models import User, UserSession
from ass_api.db.session import create_session_factory
from ass_api.main import create_app

from .test_integration_database import ALEMBIC_INI

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        os.environ.get("ASS_RUN_INTEGRATION") != "1", reason="ASS_RUN_INTEGRATION != 1"
    ),
]

PASSWORD = "un mot de passe assez long"
COOKIE = "ass_session"


@pytest.fixture(scope="module")
def auth_settings(database_url: str) -> Settings:
    config = Config(str(ALEMBIC_INI))
    config.attributes["database_url"] = database_url
    command.upgrade(config, "head")
    return Settings(
        environment="test",
        database_url=database_url,
        session_cookie_secure=False,  # TestClient parle en HTTP
        login_max_failures_per_email=3,
        login_max_failures_per_ip=100,
    )


@pytest.fixture(scope="module")
def db_factory(auth_settings: Settings) -> Iterator[sessionmaker[Session]]:
    engine, factory = create_session_factory(auth_settings)
    yield factory
    engine.dispose()


@pytest.fixture
def limiter() -> InMemoryRateLimiter:
    return InMemoryRateLimiter(window_seconds=60)


def _app(settings: Settings, limiter: object) -> FastAPI:
    app = create_app(settings)
    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[get_rate_limiter] = lambda: limiter
    return app


@pytest.fixture
def client(auth_settings: Settings, limiter: InMemoryRateLimiter) -> Iterator[TestClient]:
    with TestClient(_app(auth_settings, limiter)) as test_client:
        yield test_client


@pytest.fixture
def user(db_factory: sessionmaker[Session]) -> User:
    with db_factory() as db:
        account = User(
            email=f"{uuid.uuid4().hex[:8]}@example.test",
            display_name="Pierre",
            password_hash=hash_password(PASSWORD),
        )
        db.add(account)
        db.commit()
        return account


def _login(client: TestClient, email: str, password: str = PASSWORD) -> dict[str, object]:
    response = client.post("/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    body: dict[str, object] = response.json()
    return body


def test_login_sets_protected_cookie_and_returns_camel_case(client: TestClient, user: User) -> None:
    response = client.post("/auth/login", json={"email": user.email, "password": PASSWORD})
    assert response.status_code == 200
    cookie = response.headers["set-cookie"].lower()
    assert f"{COOKIE}=" in cookie
    assert "httponly" in cookie
    assert "samesite=lax" in cookie
    assert "path=/" in cookie
    body = response.json()
    assert body["user"] == {
        "id": str(user.id),
        "email": user.email,
        "displayName": "Pierre",
        "createdAt": body["user"]["createdAt"],
    }
    assert len(body["csrfToken"]) >= 43
    assert "passwordHash" not in response.text


def test_session_is_stored_hashed(
    client: TestClient, user: User, db_factory: sessionmaker[Session]
) -> None:
    _login(client, user.email)
    token = client.cookies[COOKIE]
    with db_factory() as db:
        stored = db.scalars(select(UserSession).where(UserSession.user_id == user.id)).one()
    assert stored.token_hash == token_hash(token)
    assert stored.token_hash != token


def test_session_endpoint(client: TestClient, user: User) -> None:
    login = _login(client, user.email)
    response = client.get("/auth/session")
    assert response.status_code == 200
    assert response.json()["csrfToken"] == login["csrfToken"]
    assert response.json()["user"]["email"] == user.email


def test_session_requires_cookie(client: TestClient) -> None:
    response = client.get("/auth/session")
    assert response.status_code == 401
    assert response.headers["content-type"].startswith("application/problem+json")


def test_email_is_case_insensitive(client: TestClient, user: User) -> None:
    _login(client, user.email.upper())


@pytest.mark.parametrize("wrong", ["password", "email"])
def test_bad_credentials_share_one_message(client: TestClient, user: User, wrong: str) -> None:
    email = "inconnu@example.test" if wrong == "email" else user.email
    password = "mauvais mot de passe" if wrong == "password" else PASSWORD
    response = client.post("/auth/login", json={"email": email, "password": password})
    assert response.status_code == 401
    assert response.json()["detail"] == "E-mail ou mot de passe incorrect"
    assert COOKIE not in client.cookies


def test_account_without_password_cannot_log_in(
    client: TestClient, db_factory: sessionmaker[Session]
) -> None:
    with db_factory() as db:
        invited = User(email=f"{uuid.uuid4().hex[:8]}@example.test", display_name="Invitée")
        db.add(invited)
        db.commit()
    response = client.post("/auth/login", json={"email": invited.email, "password": PASSWORD})
    assert response.status_code == 401


def test_login_rejects_non_json_body(client: TestClient, user: User) -> None:
    # Un formulaire intersite ne peut envoyer que des types « simples » : la connexion les refuse.
    response = client.post(
        "/auth/login",
        content=f'{{"email": "{user.email}", "password": "{PASSWORD}"}}',
        headers={"Content-Type": "text/plain"},
    )
    assert response.status_code == 422


def test_logout_requires_csrf_then_revokes(client: TestClient, user: User) -> None:
    login = _login(client, user.email)
    token = client.cookies[COOKIE]

    assert client.post("/auth/logout").status_code == 403
    assert client.post("/auth/logout", headers={CSRF_HEADER: "faux"}).status_code == 403

    response = client.post("/auth/logout", headers={CSRF_HEADER: str(login["csrfToken"])})
    assert response.status_code == 204
    assert COOKIE not in client.cookies

    # Le jeton révoqué ne vaut plus rien, même renvoyé manuellement.
    client.cookies.set(COOKIE, token)
    assert client.get("/auth/session").status_code == 401


def test_new_login_revokes_previous_session(client: TestClient, user: User) -> None:
    _login(client, user.email)
    first = client.cookies[COOKIE]
    _login(client, user.email)
    second = client.cookies[COOKIE]
    assert first != second
    client.cookies.set(COOKIE, first)
    assert client.get("/auth/session").status_code == 401


def test_expired_session_is_rejected_and_deleted(
    client: TestClient, user: User, db_factory: sessionmaker[Session]
) -> None:
    _login(client, user.email)
    hashed = token_hash(client.cookies[COOKIE])
    with db_factory() as db:
        db.execute(
            update(UserSession)
            .where(UserSession.token_hash == hashed)
            .values(expires_at=datetime.now(UTC) - timedelta(seconds=1))
        )
        db.commit()
    assert client.get("/auth/session").status_code == 401
    with db_factory() as db:
        assert (
            db.scalars(select(UserSession).where(UserSession.token_hash == hashed)).first() is None
        )


def test_failures_are_rate_limited(client: TestClient, user: User) -> None:
    for _ in range(3):
        bad = client.post("/auth/login", json={"email": user.email, "password": "mauvais !!!!!"})
        assert bad.status_code == 401
    # Même le bon mot de passe est refusé pendant la fenêtre.
    response = client.post("/auth/login", json={"email": user.email, "password": PASSWORD})
    assert response.status_code == 429
    assert response.headers["retry-after"] == "900"


def test_success_resets_email_counter(client: TestClient, user: User) -> None:
    for _ in range(2):
        client.post("/auth/login", json={"email": user.email, "password": "mauvais !!!!!"})
    _login(client, user.email)
    for _ in range(2):
        client.post("/auth/login", json={"email": user.email, "password": "mauvais !!!!!"})
    _login(client, user.email)


def test_unavailable_redis_fails_closed(auth_settings: Settings, user: User) -> None:
    unreachable = Settings(redis_url="redis://127.0.0.1:1/0", health_check_timeout_seconds=0.2)
    limiter = RedisRateLimiter.from_settings(unreachable)
    with TestClient(_app(auth_settings, limiter)) as test_client:
        response = test_client.post("/auth/login", json={"email": user.email, "password": PASSWORD})
    limiter.close()
    assert response.status_code == 503


@pytest.fixture
def redis_limiter() -> Iterator[RedisRateLimiter]:
    limiter = RedisRateLimiter.from_settings(Settings(login_failure_window_seconds=60))
    try:
        limiter.failures("login:test:ping")
    except redis.RedisError:
        pytest.skip("Redis indisponible")
    yield limiter
    limiter.close()


def test_redis_limiter_counts_with_expiry(redis_limiter: RedisRateLimiter) -> None:
    key = f"login:test:{uuid.uuid4().hex}"
    client = redis.Redis.from_url(Settings().redis_url.get_secret_value())
    try:
        redis_limiter.record_failure(key)
        redis_limiter.record_failure(key)
        assert redis_limiter.failures(key) == 2
        ttl = client.ttl(key)
        assert isinstance(ttl, int)
        assert 0 < ttl <= 60
        redis_limiter.reset(key)
        assert redis_limiter.failures(key) == 0
    finally:
        client.delete(key)
        client.close()
