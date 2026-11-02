"""Vérifications de disponibilité des dépendances (PostgreSQL, Redis, stockage S3)."""

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Literal

import boto3
import redis.asyncio as aioredis
from botocore.config import Config
from sqlalchemy import create_engine, text

from ass_api.core.config import Settings

CheckStatus = Literal["ok", "error"]


@dataclass(frozen=True, slots=True)
class CheckResult:
    status: CheckStatus
    detail: str | None = None


HealthCheck = Callable[[Settings], Awaitable[CheckResult]]


async def check_database(settings: Settings) -> CheckResult:
    def _ping() -> None:
        engine = create_engine(
            settings.database_url.get_secret_value(),
            pool_pre_ping=True,
            connect_args={"connect_timeout": int(settings.health_check_timeout_seconds) or 1},
        )
        try:
            with engine.connect() as connection:
                connection.execute(text("SELECT 1"))
        finally:
            engine.dispose()

    await asyncio.to_thread(_ping)
    return CheckResult("ok")


async def check_redis(settings: Settings) -> CheckResult:
    client = aioredis.from_url(
        settings.redis_url.get_secret_value(),
        socket_connect_timeout=settings.health_check_timeout_seconds,
    )
    try:
        await client.ping()
    finally:
        await client.aclose()
    return CheckResult("ok")


async def check_storage(settings: Settings) -> CheckResult:
    def _head_bucket() -> None:
        client = boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint_url,
            region_name=settings.s3_region,
            aws_access_key_id=settings.s3_access_key_id.get_secret_value(),
            aws_secret_access_key=settings.s3_secret_access_key.get_secret_value(),
            config=Config(
                connect_timeout=settings.health_check_timeout_seconds,
                read_timeout=settings.health_check_timeout_seconds,
                retries={"max_attempts": 1},
            ),
        )
        client.head_bucket(Bucket=settings.s3_bucket)

    await asyncio.to_thread(_head_bucket)
    return CheckResult("ok")


DEFAULT_CHECKS: dict[str, HealthCheck] = {
    "database": check_database,
    "redis": check_redis,
    "storage": check_storage,
}


async def run_checks(settings: Settings, checks: dict[str, HealthCheck]) -> dict[str, CheckResult]:
    """Exécute les vérifications en parallèle, chacune bornée par un timeout."""

    async def _guarded(check: HealthCheck) -> CheckResult:
        try:
            return await asyncio.wait_for(check(settings), settings.health_check_timeout_seconds)
        except TimeoutError:
            return CheckResult("error", "timeout")
        except Exception as exc:  # une dépendance indisponible ne doit pas faire planter l'API
            # Seul le type d'erreur est exposé : le message peut contenir une URL avec identifiants.
            return CheckResult("error", type(exc).__name__)

    names = list(checks)
    results = await asyncio.gather(*(_guarded(checks[name]) for name in names))
    return dict(zip(names, results, strict=True))
