"""Point d'entrée ASGI : ``uvicorn ass_api.main:app``."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from ass_api import __version__
from ass_api.core.config import Settings, get_settings
from ass_api.core.errors import register_error_handlers
from ass_api.core.logging import configure_logging
from ass_api.core.middleware import RequestContextMiddleware
from ass_api.routes import health


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level, json_output=settings.log_json)

    is_production = settings.environment == "production"
    app = FastAPI(
        title="AI Scene Studio API",
        version=__version__,
        # La documentation interactive n'est pas exposée en production.
        docs_url=None if is_production else "/docs",
        redoc_url=None,
        openapi_url=None if is_production else "/openapi.json",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_allowed_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Content-Type", "X-Request-ID", "X-CSRF-Token", "Idempotency-Key"],
    )
    app.add_middleware(RequestContextMiddleware)
    register_error_handlers(app)
    app.include_router(health.router)
    return app


app = create_app()
