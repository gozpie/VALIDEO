"""Middlewares HTTP : identifiant de corrélation, en-têtes de sécurité, journal d'accès."""

import re
import time
import uuid
from collections.abc import Awaitable, Callable

import structlog
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

REQUEST_ID_HEADER = "X-Request-ID"
_VALID_REQUEST_ID = re.compile(r"^[A-Za-z0-9._-]{8,64}$")

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
}

logger = structlog.get_logger("ass_api.access")


class RequestContextMiddleware(BaseHTTPMiddleware):
    """Attribue un identifiant de requête, ajoute les en-têtes de sécurité et journalise l'accès."""

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        incoming = request.headers.get(REQUEST_ID_HEADER, "")
        # Un identifiant client n'est repris que s'il est sûr (anti-injection de logs).
        request_id = incoming if _VALID_REQUEST_ID.match(incoming) else uuid.uuid4().hex
        request.state.request_id = request_id
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(request_id=request_id)

        started = time.perf_counter()
        response = await call_next(request)
        duration_ms = round((time.perf_counter() - started) * 1000, 2)

        response.headers[REQUEST_ID_HEADER] = request_id
        for header, value in SECURITY_HEADERS.items():
            response.headers.setdefault(header, value)
        logger.info(
            "http_request",
            method=request.method,
            path=request.url.path,
            status=response.status_code,
            duration_ms=duration_ms,
        )
        return response
