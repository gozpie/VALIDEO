from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from ass_api.core.config import Settings, get_settings
from ass_api.main import create_app


@pytest.fixture
def settings() -> Settings:
    return Settings(environment="test", log_json=True, health_check_timeout_seconds=0.5)


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    app = create_app(settings)
    app.dependency_overrides[get_settings] = lambda: settings
    with TestClient(app) as test_client:
        yield test_client
