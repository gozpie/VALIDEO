"""Outils partagés des tests d'intégration de l'API : base migrée, utilisateurs, clients."""

import uuid
from collections.abc import Iterator
from contextlib import ExitStack
from pathlib import Path
from typing import Any

import httpx
from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

from ass_api.auth.dependencies import CSRF_HEADER, get_rate_limiter
from ass_api.auth.passwords import hash_password
from ass_api.auth.rate_limit import InMemoryRateLimiter
from ass_api.core.config import Settings, get_settings
from ass_api.db.models import User
from ass_api.main import create_app

ROOT = Path(__file__).resolve().parents[3]
ALEMBIC_INI = ROOT / "infrastructure/migrations/alembic.ini"
PASSWORD = "un mot de passe assez long"


def migrate(database_url: str, revision: str = "head") -> Config:
    config = Config(str(ALEMBIC_INI))
    config.attributes["database_url"] = database_url
    command.upgrade(config, revision)
    return config


def integration_settings(database_url: str, **overrides: Any) -> Settings:
    values: dict[str, Any] = {
        "environment": "test",
        "database_url": database_url,
        "session_cookie_secure": False,  # TestClient parle en HTTP
    }
    values.update(overrides)
    return Settings(**values)


def build_app(settings: Settings, limiter: object | None = None) -> FastAPI:
    app = create_app(settings)
    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[get_rate_limiter] = lambda: limiter or InMemoryRateLimiter(60)
    return app


def create_user(
    factory: sessionmaker[Session], display_name: str = "Test", *, password: str | None = PASSWORD
) -> User:
    with factory() as db:
        user = User(
            email=f"{uuid.uuid4().hex[:10]}@example.test",
            display_name=display_name,
            password_hash=hash_password(password) if password else None,
        )
        db.add(user)
        db.commit()
        return user


class ApiClient:
    """Client connecté : ajoute automatiquement le jeton CSRF aux requêtes modifiantes."""

    def __init__(self, client: TestClient, csrf_token: str, user: User) -> None:
        self.http = client
        self.csrf_token = csrf_token
        self.user = user

    def get(self, url: str, **kwargs: Any) -> httpx.Response:
        response: httpx.Response = self.http.get(url, **kwargs)
        return response

    def _send(self, method: str, url: str, **kwargs: Any) -> httpx.Response:
        headers = {CSRF_HEADER: self.csrf_token, **kwargs.pop("headers", {})}
        response: httpx.Response = self.http.request(method, url, headers=headers, **kwargs)
        return response

    def post(self, url: str, **kwargs: Any) -> httpx.Response:
        return self._send("POST", url, **kwargs)

    def patch(self, url: str, **kwargs: Any) -> httpx.Response:
        return self._send("PATCH", url, **kwargs)

    def put(self, url: str, **kwargs: Any) -> httpx.Response:
        return self._send("PUT", url, **kwargs)

    def delete(self, url: str, **kwargs: Any) -> httpx.Response:
        return self._send("DELETE", url, **kwargs)


class ClientPool:
    """Un client HTTP par utilisateur (cookies séparés) sur une même application."""

    def __init__(self, app: FastAPI) -> None:
        self._app = app
        self._stack = ExitStack()

    def anonymous(self) -> TestClient:
        return self._stack.enter_context(TestClient(self._app))

    def login(self, user: User, password: str = PASSWORD) -> ApiClient:
        client = self.anonymous()
        response = client.post("/auth/login", json={"email": user.email, "password": password})
        assert response.status_code == 200, response.text
        return ApiClient(client, response.json()["csrfToken"], user)

    def close(self) -> None:
        self._stack.close()


def client_pool(app: FastAPI) -> Iterator[ClientPool]:
    pool = ClientPool(app)
    try:
        yield pool
    finally:
        pool.close()
