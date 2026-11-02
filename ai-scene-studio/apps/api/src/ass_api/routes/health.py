"""Endpoints de santé : liveness (processus vivant) et readiness (dépendances joignables)."""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Response, status
from pydantic import BaseModel

from ass_api import __version__
from ass_api.core.config import Settings, get_settings
from ass_api.core.health import DEFAULT_CHECKS, HealthCheck, run_checks

router = APIRouter(prefix="/health", tags=["health"])


class CheckOut(BaseModel):
    status: Literal["ok", "error"]
    detail: str | None = None


class HealthOut(BaseModel):
    status: Literal["ok", "degraded", "error"]
    version: str
    checks: dict[str, CheckOut]


def get_health_checks() -> dict[str, HealthCheck]:
    """Dépendance surchargeable en test."""
    return DEFAULT_CHECKS


@router.get("/live", response_model=HealthOut)
async def live() -> HealthOut:
    return HealthOut(status="ok", version=__version__, checks={})


@router.get(
    "/ready",
    response_model=HealthOut,
    responses={status.HTTP_503_SERVICE_UNAVAILABLE: {"model": HealthOut}},
)
async def ready(
    response: Response,
    settings: Annotated[Settings, Depends(get_settings)],
    checks: Annotated[dict[str, HealthCheck], Depends(get_health_checks)],
) -> HealthOut:
    results = await run_checks(settings, checks)
    failed = [name for name, result in results.items() if result.status == "error"]
    overall: Literal["ok", "error"] = "error" if failed else "ok"
    if failed:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return HealthOut(
        status=overall,
        version=__version__,
        checks={
            name: CheckOut(status=result.status, detail=result.detail)
            for name, result in results.items()
        },
    )
