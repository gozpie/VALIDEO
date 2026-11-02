"""Configuration de l'API, lue exclusivement depuis l'environnement (préfixe ``ASS_``)."""

from functools import lru_cache
from typing import Annotated, Literal, Self

from pydantic import Field, PostgresDsn, RedisDsn, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    """Paramètres d'exécution. Les secrets sont typés ``SecretStr`` pour ne jamais être loggés."""

    model_config = SettingsConfigDict(env_prefix="ASS_", env_file=None, extra="ignore")

    environment: Literal["development", "test", "production"] = "development"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    log_json: bool = True

    database_url: SecretStr = SecretStr(
        "postgresql+psycopg://ass:ass@localhost:5432/ass"  # identifiants de développement local
    )
    redis_url: SecretStr = SecretStr("redis://localhost:6379/0")

    s3_endpoint_url: str = "http://localhost:9000"
    s3_region: str = "us-east-1"
    s3_bucket: str = "ass-media"
    s3_access_key_id: SecretStr = SecretStr("minioadmin")
    s3_secret_access_key: SecretStr = SecretStr("minioadmin")

    cors_allowed_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["http://localhost:3000"]
    )
    health_check_timeout_seconds: float = Field(default=2.0, gt=0, le=30)

    @field_validator("cors_allowed_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @field_validator("cors_allowed_origins")
    @classmethod
    def _reject_wildcard(cls, value: list[str]) -> list[str]:
        if "*" in value:
            raise ValueError("CORS : l'origine '*' est interdite, lister les origines explicites")
        return value

    @field_validator("database_url")
    @classmethod
    def _check_database_url(cls, value: SecretStr) -> SecretStr:
        PostgresDsn(value.get_secret_value())
        return value

    @field_validator("redis_url")
    @classmethod
    def _check_redis_url(cls, value: SecretStr) -> SecretStr:
        RedisDsn(value.get_secret_value())
        return value

    @model_validator(mode="after")
    def _forbid_dev_credentials_in_production(self) -> Self:
        if self.environment != "production":
            return self
        insecure = {
            "database_url": ":ass@" in self.database_url.get_secret_value(),
            "s3_access_key_id": self.s3_access_key_id.get_secret_value() == "minioadmin",
            "s3_secret_access_key": self.s3_secret_access_key.get_secret_value() == "minioadmin",
        }
        if any(insecure.values()):
            fields = ", ".join(name for name, bad in insecure.items() if bad)
            raise ValueError(f"Identifiants de développement interdits en production : {fields}")
        return self


@lru_cache
def get_settings() -> Settings:
    """Retourne la configuration (mise en cache pour la durée du processus)."""
    return Settings()
