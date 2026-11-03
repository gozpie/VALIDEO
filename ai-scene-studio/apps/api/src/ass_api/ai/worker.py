"""Worker IA : `python -m ass_api.ai.worker --providers simulation,claude`.

Chaque fournisseur a sa file. Un worker ne sert que les fournisseurs qu'on lui confie et publie
leur disponibilité (signe de vie Redis, 30 s) : l'API n'accepte une génération que si un worker
disponible peut la traiter. La passerelle Higgsfield tourne sur le Mac où Chrome est ouvert.
"""

import argparse
import json
import os
import signal
import socket
import sys
import time
import uuid
from datetime import UTC, datetime, timedelta
from types import FrameType

import redis
import structlog
from redis.exceptions import RedisError
from sqlalchemy.exc import SQLAlchemyError

from ass_api.ai.registry import build_providers, queue_key
from ass_api.ai.service import run_generation
from ass_api.core.config import Settings, get_settings
from ass_api.core.logging import configure_logging
from ass_api.core.storage import ObjectStorage
from ass_api.db.models import GenerationJob
from ass_api.db.session import create_session_factory
from ass_api.render.jobs import RenderQueue, fail_stale_jobs

logger = structlog.get_logger("ass_api.ai.worker")
HEARTBEAT_TTL = 30


def availability_key(settings: Settings, provider: str) -> str:
    return f"{settings.ai_queue_prefix}:workers:{provider}"


def read_availability(
    client: "redis.Redis", settings: Settings, provider: str
) -> dict[str, object] | None:
    value = client.get(availability_key(settings, provider))
    if not isinstance(value, bytes | str):
        return None
    data = json.loads(value)
    return data if isinstance(data, dict) else None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="ass_api.ai.worker")
    parser.add_argument(
        "--providers", default=os.environ.get("ASS_AI_PROVIDERS", "simulation,claude")
    )
    args = parser.parse_args(argv)
    settings = get_settings()
    configure_logging(settings.log_level, json_output=settings.log_json)
    all_providers = build_providers(settings)
    names = [name.strip() for name in args.providers.split(",") if name.strip() in all_providers]
    providers = {name: all_providers[name] for name in names}
    engine, factory = create_session_factory(settings)
    storage = ObjectStorage.from_settings(settings)
    client = redis.Redis.from_url(settings.redis_url.get_secret_value(), socket_timeout=60)
    queues = {name: RenderQueue(client, queue_key(settings, name)) for name in providers}
    render_queue = RenderQueue.from_settings(settings)
    worker_id = f"{socket.gethostname()}-{os.getpid()}"
    current: list[str] = []

    def stop(_signum: int, _frame: FrameType | None) -> None:
        raise SystemExit(0)

    signal.signal(signal.SIGTERM, stop)
    logger.info("ai_worker_started", worker_id=worker_id, providers=names)
    last_beat = 0.0
    try:
        while True:
            try:
                if time.monotonic() - last_beat > 10:
                    for name, provider in providers.items():
                        available, reason = provider.availability()
                        client.set(
                            availability_key(settings, name),
                            json.dumps(
                                {
                                    "available": available,
                                    "reason": reason,
                                    "workerId": worker_id,
                                    "at": datetime.now(UTC).isoformat(),
                                }
                            ),
                            ex=HEARTBEAT_TTL,
                        )
                    with factory() as db:
                        fail_stale_jobs(
                            db, timedelta(seconds=settings.render_stale_seconds), GenerationJob
                        )
                    last_beat = time.monotonic()
                popped = None
                for name, queue in queues.items():
                    popped = queue.pop(worker_id, 1)
                    if popped is not None:
                        current[:] = [name, popped]
                        break
            except (RedisError, SQLAlchemyError) as exc:
                logger.warning("ai_worker_dependency_unavailable", error_type=type(exc).__name__)
                time.sleep(5)
                continue
            if popped is None:
                continue
            try:
                run_generation(
                    uuid.UUID(popped),
                    providers,
                    settings,
                    factory,
                    storage,
                    render_queue,
                    worker_id,
                )
            finally:
                queues[current[0]].ack(worker_id, popped)
                current.clear()
    finally:
        for name in providers:
            client.delete(availability_key(settings, name))
        client.close()
        render_queue.close()
        engine.dispose()


if __name__ == "__main__":
    sys.exit(main())
