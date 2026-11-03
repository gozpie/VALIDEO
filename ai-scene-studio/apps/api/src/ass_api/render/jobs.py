"""Machine à états des jobs (identique à `@ass/shared-types/src/jobs.ts`) et file de rendu Redis.

L'état fait foi en base ; Redis ne transporte que les identifiants à traiter. Un job terminal ne
repart jamais : relancer crée un nouveau job. Un job dont le worker ne donne plus signe de vie
passe en échec.
"""

from datetime import UTC, datetime, timedelta
from typing import Final

import redis
from fastapi import Request
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from ass_api.core.config import Settings
from ass_api.db.models import RenderJob

TRANSITIONS: Final[dict[str, frozenset[str]]] = {
    "queued": frozenset({"preparing", "cancelled", "failed"}),
    "preparing": frozenset({"running", "cancelled", "failed"}),
    "running": frozenset({"processing", "cancelled", "failed"}),
    "processing": frozenset({"completed", "cancelled", "failed"}),
    "completed": frozenset(),
    "failed": frozenset(),
    "cancelled": frozenset(),
}
ACTIVE_STATUSES: Final = ("preparing", "running", "processing")


class InvalidTransitionError(ValueError):
    pass


def transition(job: RenderJob, status: str, message: str | None = None) -> None:
    if status not in TRANSITIONS[job.status]:
        raise InvalidTransitionError(f"Transition interdite : {job.status} → {status}")
    now = datetime.now(UTC)
    job.status = status
    if message is not None:
        job.message = message[:500]
    if status == "preparing":
        job.started_at = now
    if status in ACTIVE_STATUSES:
        job.heartbeat_at = now
    if not TRANSITIONS[status]:
        job.completed_at = now


def fail_stale_jobs(db: Session, timeout: timedelta) -> int:
    """Passe en échec les jobs actifs sans signe de vie depuis `timeout` (worker arrêté)."""
    limit = datetime.now(UTC) - timeout
    stale = list(
        db.scalars(
            select(RenderJob)
            .where(RenderJob.status.in_(ACTIVE_STATUSES), RenderJob.heartbeat_at < limit)
            .with_for_update(skip_locked=True)
        )
    )
    for job in stale:
        transition(job, "failed", "Rendu interrompu : le worker ne répond plus")
        job.error = f"Aucun signe de vie du worker depuis plus de {int(timeout.total_seconds())} s"
    db.commit()
    return len(stale)


def touch(db: Session, job_id: object, progress: float, message: str) -> bool:
    """Signe de vie et progression ; renvoie True si une annulation a été demandée."""
    db.execute(
        update(RenderJob)
        .where(RenderJob.id == job_id)
        .values(
            heartbeat_at=datetime.now(UTC),
            progress=min(max(progress, 0.0), 1.0),
            message=message[:500],
        )
    )
    db.commit()
    return bool(db.scalar(select(RenderJob.cancel_requested).where(RenderJob.id == job_id)))


class RenderQueue:
    """File fiable : un identifiant retiré de la file passe dans la liste « en cours » du worker."""

    def __init__(self, client: "redis.Redis", key: str) -> None:
        self._client = client
        self._key = key

    @classmethod
    def from_settings(cls, settings: Settings) -> "RenderQueue":
        return cls(
            redis.Redis.from_url(
                settings.redis_url.get_secret_value(),
                socket_connect_timeout=settings.health_check_timeout_seconds,
            ),
            settings.render_queue_key,
        )

    def _processing(self, worker_id: str) -> str:
        return f"{self._key}:processing:{worker_id}"

    def push(self, job_id: str) -> None:
        self._client.lpush(self._key, job_id)

    def pop(self, worker_id: str, timeout_seconds: int) -> str | None:
        value = self._client.blmove(
            self._key, self._processing(worker_id), timeout_seconds, "RIGHT", "LEFT"
        )
        return value.decode() if isinstance(value, bytes) else None

    def ack(self, worker_id: str, job_id: str) -> None:
        self._client.lrem(self._processing(worker_id), 0, job_id)

    def pending(self, worker_id: str) -> list[str]:
        """Jobs restés « en cours » pour ce worker (arrêt brutal) : à traiter avant la file."""
        values = self._client.lrange(self._processing(worker_id), 0, -1)
        if not isinstance(values, list):
            return []
        return [value.decode() if isinstance(value, bytes) else str(value) for value in values]

    def close(self) -> None:
        self._client.close()


def get_render_queue(request: Request) -> RenderQueue:
    queue: RenderQueue = request.app.state.render_queue
    return queue
