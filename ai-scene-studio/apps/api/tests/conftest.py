import uuid
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, sessionmaker

from ass_api.core.config import Settings, get_settings
from ass_api.db.session import create_session_factory
from ass_api.main import create_app

from .support import ClientPool, build_app, client_pool, integration_settings, migrate


@pytest.fixture
def settings() -> Settings:
    return Settings(environment="test", log_json=True, health_check_timeout_seconds=0.5)


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    app = create_app(settings)
    app.dependency_overrides[get_settings] = lambda: settings
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(scope="module")
def database_url() -> Iterator[str]:
    """Base PostgreSQL temporaire, créée puis supprimée pour chaque module d'intégration.

    La base configurée (ASS_DATABASE_URL) ne sert qu'à joindre le serveur : ses données ne sont
    jamais touchées.
    """
    server_url = make_url(Settings().database_url.get_secret_value())
    name = f"ass_test_{uuid.uuid4().hex[:12]}"
    admin = create_engine(server_url, isolation_level="AUTOCOMMIT")
    with admin.connect() as connection:
        connection.execute(text(f'CREATE DATABASE "{name}"'))
    try:
        yield server_url.set(database=name).render_as_string(hide_password=False)
    finally:
        with admin.connect() as connection:
            connection.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        admin.dispose()


@pytest.fixture(scope="module")
def api_settings(database_url: str) -> Settings:
    """API branchée sur la base temporaire du module, migrée à la dernière version."""
    migrate(database_url)
    return integration_settings(database_url)


@pytest.fixture(scope="module")
def db_factory(api_settings: Settings) -> Iterator[sessionmaker[Session]]:
    engine, factory = create_session_factory(api_settings)
    yield factory
    engine.dispose()


@pytest.fixture
def clients(api_settings: Settings) -> Iterator[ClientPool]:
    yield from client_pool(build_app(api_settings))
