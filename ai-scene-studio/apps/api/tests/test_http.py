from fastapi.testclient import TestClient

from ass_api.core.config import Settings
from ass_api.main import create_app


def test_request_id_generated_and_security_headers(client: TestClient) -> None:
    response = client.get("/health/live")
    assert len(response.headers["X-Request-ID"]) == 32
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["X-Frame-Options"] == "DENY"


def test_valid_request_id_is_propagated(client: TestClient) -> None:
    response = client.get("/health/live", headers={"X-Request-ID": "trace-12345678"})
    assert response.headers["X-Request-ID"] == "trace-12345678"


def test_unsafe_request_id_is_replaced(client: TestClient) -> None:
    response = client.get("/health/live", headers={"X-Request-ID": "x\n injected"})
    assert response.headers["X-Request-ID"] != "x\n injected"


def test_not_found_uses_problem_details(client: TestClient) -> None:
    response = client.get("/inexistant")
    assert response.status_code == 404
    assert response.headers["content-type"].startswith("application/problem+json")
    body = response.json()
    assert body["status"] == 404
    assert body["requestId"] == response.headers["X-Request-ID"]


def test_cors_only_allows_configured_origins(client: TestClient) -> None:
    allowed = client.options(
        "/health/live",
        headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "GET"},
    )
    assert allowed.headers.get("access-control-allow-origin") == "http://localhost:3000"
    denied = client.options(
        "/health/live",
        headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"},
    )
    assert "access-control-allow-origin" not in denied.headers


def test_openapi_hidden_in_production() -> None:
    app = create_app(
        Settings(
            environment="production",
            database_url="postgresql+psycopg://prod:prod-pass@db:5432/ass",
            s3_access_key_id="prod-key",
            s3_secret_access_key="prod-secret",
        )
    )
    paths = {getattr(route, "path", "") for route in app.routes}
    assert "/openapi.json" not in paths
    assert "/docs" not in paths
