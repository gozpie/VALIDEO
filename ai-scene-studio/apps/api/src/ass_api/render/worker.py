"""Worker de rendu : `python -m ass_api.render.worker`.

Boucle : échec des jobs abandonnés, attente d'un identifiant dans la file Redis, exécution, accusé
de réception. Un arrêt (SIGTERM) termine le job en cours en échec plutôt que de le laisser bloqué.
"""

import os
import signal
import socket
import sys
import time
import uuid
from datetime import timedelta
from types import FrameType

import structlog
from redis.exceptions import RedisError
from sqlalchemy.exc import SQLAlchemyError

from ass_api.core.config import get_settings
from ass_api.core.logging import configure_logging
from ass_api.core.storage import ObjectStorage
from ass_api.db.session import create_session_factory
from ass_api.render.jobs import RenderQueue, fail_stale_jobs
from ass_api.render.runner import finish, run_job

logger = structlog.get_logger("ass_api.render.worker")


def main() -> int:
    settings = get_settings()
    configure_logging(settings.log_level, json_output=settings.log_json)
    engine, factory = create_session_factory(settings)
    storage = ObjectStorage.from_settings(settings)
    queue = RenderQueue.from_settings(settings)
    worker_id = f"{socket.gethostname()}-{os.getpid()}"
    stopping = False

    def stop(signum: int, _frame: FrameType | None) -> None:
        nonlocal stopping
        stopping = True
        logger.info("worker_stopping", signal=signum)
        raise SystemExit(0)

    signal.signal(signal.SIGTERM, stop)
    logger.info("worker_started", worker_id=worker_id)
    try:
        for job_id in queue.pending(worker_id):
            queue.ack(worker_id, job_id)
        while not stopping:
            try:
                with factory() as db:
                    fail_stale_jobs(db, timedelta(seconds=settings.render_stale_seconds))
                popped = queue.pop(worker_id, 5)
            except (RedisError, SQLAlchemyError) as exc:
                # Dépendance momentanément indisponible : nouvel essai sans perdre le worker.
                logger.warning("worker_dependency_unavailable", error_type=type(exc).__name__)
                time.sleep(5)
                continue
            if popped is None:
                continue
            try:
                run_job(uuid.UUID(popped), settings, factory, storage, worker_id)
            except SystemExit:
                finish(factory, uuid.UUID(popped), "failed", "Worker arrêté pendant le rendu", None)
                raise
            finally:
                queue.ack(worker_id, popped)
    finally:
        queue.close()
        engine.dispose()
    return 0


if __name__ == "__main__":
    sys.exit(main())
