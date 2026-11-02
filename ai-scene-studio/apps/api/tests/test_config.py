import pytest
from pydantic import ValidationError

from ass_api.core.config import Settings


def test_cors_origins_parsed_from_comma_separated_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ASS_CORS_ALLOWED_ORIGINS", "https://a.example, https://b.example")
    assert Settings().cors_allowed_origins == ["https://a.example", "https://b.example"]


def test_cors_wildcard_rejected() -> None:
    with pytest.raises(ValidationError, match="interdite"):
        Settings(cors_allowed_origins=["*"])


def test_invalid_database_url_rejected() -> None:
    with pytest.raises(ValidationError):
        Settings(database_url="mysql://x")


def test_secrets_are_masked_in_repr() -> None:
    settings = Settings(s3_secret_access_key="super-secret")
    assert "super-secret" not in repr(settings)


def test_dev_credentials_forbidden_in_production() -> None:
    with pytest.raises(ValidationError, match="production"):
        Settings(environment="production")
