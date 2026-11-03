"""Format d'erreur unique (« problem details », RFC 9457 simplifiée)."""

from collections.abc import Mapping
from typing import Any

import structlog
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = structlog.get_logger("ass_api.errors")


def _problem(
    request: Request,
    status: int,
    title: str,
    detail: str,
    errors: list[dict[str, str]] | None,
    headers: Mapping[str, str] | None = None,
) -> JSONResponse:
    body: dict[str, Any] = {
        "type": "about:blank",
        "title": title,
        "status": status,
        "detail": detail,
        "requestId": getattr(request.state, "request_id", ""),
    }
    if errors is not None:
        body["errors"] = errors
    return JSONResponse(
        body, status_code=status, media_type="application/problem+json", headers=headers
    )


def register_error_handlers(app: FastAPI) -> None:
    """Enregistre les gestionnaires d'erreurs ; aucune trace interne n'est renvoyée au client."""

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        # Les en-têtes portés par l'exception (Retry-After, WWW-Authenticate…) sont conservés.
        return _problem(request, exc.status_code, "Erreur HTTP", str(exc.detail), None, exc.headers)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        errors = [
            {"path": ".".join(str(p) for p in err["loc"]), "message": err["msg"]}
            for err in exc.errors()
        ]
        return _problem(request, 422, "Requête invalide", "Validation échouée", errors)

    @app.exception_handler(Exception)
    async def _unexpected_error(request: Request, exc: Exception) -> JSONResponse:
        logger.exception("unhandled_error", error_type=type(exc).__name__)
        return _problem(request, 500, "Erreur interne", "Une erreur inattendue est survenue", None)
