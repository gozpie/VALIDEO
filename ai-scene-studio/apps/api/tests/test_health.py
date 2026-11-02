import asyncio

from fastapi.testclient import TestClient

from ass_api.core.config import Settings
from ass_api.core.health import CheckResult, HealthCheck
from ass_api.routes.health import get_health_checks


async def _ok(_settings: Settings) -> CheckResult:
    return CheckResult("ok")


async def _boom(_settings: Settings) -> CheckResult:
    raise ConnectionError("postgresql://user:motdepasse@db:5432 refusé")


async def _slow(_settings: Settings) -> CheckResult:
    await asyncio.sleep(5)
    return CheckResult("ok")


def _override(client: TestClient, checks: dict[str, HealthCheck]) -> None:
    client.app.dependency_overrides[get_health_checks] = lambda: checks  # type: ignore[attr-defined]


def test_live_returns_ok(client: TestClient) -> None:
    response = client.get("/health/live")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_ready_ok_when_all_dependencies_respond(client: TestClient) -> None:
    _override(client, {"database": _ok, "redis": _ok})
    response = client.get("/health/ready")
    assert response.status_code == 200
    assert response.json()["checks"] == {
        "database": {"status": "ok", "detail": None},
        "redis": {"status": "ok", "detail": None},
    }


def test_ready_503_without_leaking_secrets(client: TestClient) -> None:
    _override(client, {"database": _boom, "redis": _ok})
    response = client.get("/health/ready")
    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "error"
    assert body["checks"]["database"] == {"status": "error", "detail": "ConnectionError"}
    assert "motdepasse" not in response.text


def test_ready_times_out_slow_dependency(client: TestClient) -> None:
    _override(client, {"storage": _slow})
    response = client.get("/health/ready")
    assert response.status_code == 503
    assert response.json()["checks"]["storage"]["detail"] == "timeout"
