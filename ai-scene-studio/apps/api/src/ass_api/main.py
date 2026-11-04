"""Point d'entrée ASGI : ``uvicorn ass_api.main:app``."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import redis
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from ass_api import __version__
from ass_api.auth.rate_limit import RedisRateLimiter
from ass_api.core.body_limit import BodySizeLimitMiddleware
from ass_api.core.config import Settings, get_settings
from ass_api.core.errors import ERROR_RESPONSES, register_error_handlers
from ass_api.core.logging import configure_logging
from ass_api.core.middleware import RequestContextMiddleware
from ass_api.core.storage import ObjectStorage
from ass_api.db.session import create_session_factory
from ass_api.render.jobs import RenderQueue
from ass_api.routes import (
    assets,
    auth,
    generations,
    health,
    invitations,
    members,
    montage,
    projects,
    renders,
    scenes,
    sequences,
    shots,
    studio,
    workspaces,
)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level, json_output=settings.log_json)

    is_production = settings.environment == "production"

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        # Connexions ouvertes à la demande : l'API démarre même si une dépendance est absente.
        engine, app.state.session_factory = create_session_factory(settings)
        limiter = RedisRateLimiter.from_settings(settings)
        app.state.rate_limiter = limiter
        app.state.storage = ObjectStorage.from_settings(settings)
        render_queue = RenderQueue.from_settings(settings)
        app.state.render_queue = render_queue
        app.state.redis = redis.Redis.from_url(
            settings.redis_url.get_secret_value(),
            socket_connect_timeout=settings.health_check_timeout_seconds,
            socket_timeout=settings.health_check_timeout_seconds,
        )
        try:
            yield
        finally:
            limiter.close()
            render_queue.close()
            app.state.redis.close()
            engine.dispose()

    app = FastAPI(
        lifespan=lifespan,
        responses=ERROR_RESPONSES,
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
    # Plafond global des corps de requête (le plus gros envoi autorisé : un asset).
    app.add_middleware(BodySizeLimitMiddleware, max_bytes=settings.asset_max_bytes + 1024 * 1024)
    register_error_handlers(app)
    app.include_router(health.router)
    app.include_router(auth.router)
    app.include_router(workspaces.router)
    app.include_router(members.router)
    app.include_router(invitations.router)
    for router in (
        projects.router,
        sequences.router,
        shots.router,
        scenes.router,
        assets.router,
        renders.router,
        generations.router,
        studio.router,
        montage.router,
    ):
        app.include_router(router)
    return app


app = create_app()
