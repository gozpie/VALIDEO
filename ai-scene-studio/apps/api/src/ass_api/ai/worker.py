"""Worker IA : `python -m ass_api.ai.worker --providers simulation,claude`.

Chaque fournisseur a sa file. Un worker ne sert que les fournisseurs qu'on lui confie et publie
leur disponibilité (signe de vie Redis, 30 s) : l'API n'accepte une génération que si un worker
disponible peut la traiter. Le signe de vie part d'un fil dédié : un worker occupé par une longue
génération reste disponible (les suivantes attendent dans la file). La passerelle Higgsfield et le
pont gozCut tournent sur le Mac.
"""

import argparse
import json
import os
import signal
import socket
import sys
import threading
import time
import uuid
from datetime import UTC, datetime, timedelta
from types import FrameType

import redis
import structlog
from redis.exceptions import RedisError
from sqlalchemy import update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

from ass_api.ai.providers.base import ProviderAdapter
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
HEARTBEAT_INTERVAL = 10


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


class Heartbeat(threading.Thread):
    """Signe de vie indépendant des générations : disponibilité, job en cours, jobs abandonnés."""

    def __init__(
        self,
        client: "redis.Redis",
        settings: Settings,
        providers: dict[str, ProviderAdapter],
        factory: sessionmaker[Session],
        worker_id: str,
        interval: float = HEARTBEAT_INTERVAL,
        ttl: int = HEARTBEAT_TTL,
    ) -> None:
        super().__init__(name="ai-heartbeat", daemon=True)
        self._client, self._settings, self._providers = client, settings, providers
        self._factory, self._worker_id = factory, worker_id
        self._interval, self._ttl = interval, ttl
        self._halt = threading.Event()
        self.current_job: str | None = None

    def beat(self) -> None:
        for name, provider in self._providers.items():
            available, reason = provider.availability()
            self._client.set(
                availability_key(self._settings, name),
                json.dumps(
                    {
                        "available": available,
                        "reason": reason,
                        "workerId": self._worker_id,
                        "at": datetime.now(UTC).isoformat(),
                    }
                ),
                ex=self._ttl,
            )
        with self._factory() as db:
            job_id = self.current_job
            if job_id is not None:
                # Une génération longue et silencieuse n'est pas une génération abandonnée.
                db.execute(
                    update(GenerationJob)
                    .where(GenerationJob.id == uuid.UUID(job_id))
                    .values(heartbeat_at=datetime.now(UTC))
                )
                db.commit()
            fail_stale_jobs(
                db, timedelta(seconds=self._settings.render_stale_seconds), GenerationJob
            )

    def run(self) -> None:
        while not self._halt.is_set():
            try:
                self.beat()
            except (RedisError, SQLAlchemyError) as exc:
                logger.warning("ai_heartbeat_unavailable", error_type=type(exc).__name__)
            self._halt.wait(self._interval)

    def stop(self) -> None:
        self._halt.set()
        self.join(timeout=5)


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
    heartbeat = Heartbeat(client, settings, providers, factory, worker_id)
    heartbeat.start()
    try:
        while True:
            try:
                popped = None
                for name, queue in queues.items():
                    popped = queue.pop(worker_id, 1)
                    if popped is not None:
                        current[:] = [name, popped]
                        break
            except RedisError as exc:
                logger.warning("ai_worker_dependency_unavailable", error_type=type(exc).__name__)
                time.sleep(5)
                continue
            if popped is None:
                continue
            heartbeat.current_job = popped
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
                heartbeat.current_job = None
                queues[current[0]].ack(worker_id, popped)
                current.clear()
    finally:
        heartbeat.stop()
        for name in providers:
            client.delete(availability_key(settings, name))
        client.close()
        render_queue.close()
        engine.dispose()


if __name__ == "__main__":
    sys.exit(main())
