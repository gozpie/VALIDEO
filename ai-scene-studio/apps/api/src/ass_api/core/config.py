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

    s3_endpoint_url: str = "http://localhost:8333"
    s3_region: str = "us-east-1"
    s3_bucket: str = "ass-media"
    s3_access_key_id: SecretStr = SecretStr("dev-access-key")
    s3_secret_access_key: SecretStr = SecretStr("dev-secret-key-change-me")

    cors_allowed_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["http://localhost:3000"]
    )
    health_check_timeout_seconds: float = Field(default=2.0, gt=0, le=30)

    # Sessions : cookie opaque HttpOnly, jeton haché en base, durée de vie absolue.
    session_cookie_name: str = Field(default="ass_session", pattern=r"^[A-Za-z0-9_-]{1,64}$")
    session_cookie_secure: bool = True
    session_ttl_hours: int = Field(default=24 * 14, ge=1, le=24 * 90)

    # Invitations : lien à usage unique vers le front (ASS_WEB_BASE_URL/invitations/<jeton>).
    invitation_ttl_hours: int = Field(default=24 * 7, ge=1, le=24 * 30)
    web_base_url: str = Field(
        default="http://localhost:3000", pattern=r"^https?://[^\s/]+(/[^\s]*)?$"
    )

    # Taille maximale d'un asset envoyé à l'API (100 Mo par défaut).
    asset_max_bytes: int = Field(default=100 * 1024 * 1024, ge=1024, le=2 * 1024**3)

    # Rendu : frames maximales par job, délai sans signe de vie avant échec, exécutables.
    render_max_frames: int = Field(default=2000, ge=1)
    render_queue_key: str = Field(default="ass:render:queue", pattern=r"^[a-z0-9:_-]{1,100}$")
    render_stale_seconds: int = Field(default=300, ge=10)
    render_timeout_seconds: int = Field(default=6 * 3600, ge=10)
    blender_path: str = "blender"
    ffmpeg_path: str = "ffmpeg"

    # Limitation des échecs de connexion (fenêtre glissante simple, comptée dans Redis).
    login_max_failures_per_email: int = Field(default=10, ge=1)
    login_max_failures_per_ip: int = Field(default=50, ge=1)
    login_failure_window_seconds: int = Field(default=15 * 60, ge=1)

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
            "s3_access_key_id": self.s3_access_key_id.get_secret_value() == "dev-access-key",
            "s3_secret_access_key": "change-me" in self.s3_secret_access_key.get_secret_value(),
        }
        if not self.session_cookie_secure:
            raise ValueError("ASS_SESSION_COOKIE_SECURE doit rester actif en production")
        if any(insecure.values()):
            fields = ", ".join(name for name, bad in insecure.items() if bad)
            raise ValueError(f"Identifiants de développement interdits en production : {fields}")
        return self


@lru_cache
def get_settings() -> Settings:
    """Retourne la configuration (mise en cache pour la durée du processus)."""
    return Settings()
