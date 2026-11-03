"""Rendus hors navigateur d'un plan : lancement, suivi, annulation (le worker fait le travail)."""

import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

import structlog
from fastapi import APIRouter, Depends, Header, HTTPException, Response, status
from pydantic import Field
from redis.exceptions import RedisError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ass_api.auth.dependencies import CurrentSessionDep
from ass_api.auth.permissions import Role, shot_access
from ass_api.core.api_model import ApiModel
from ass_api.core.config import Settings, get_settings
from ass_api.core.storage import ObjectStorage, get_storage
from ass_api.db.models import RenderJob, Scene, SceneRevision
from ass_api.db.session import get_db
from ass_api.render.jobs import RenderQueue, get_render_queue, transition
from ass_api.scenes.validation import parse_snapshot

router = APIRouter(tags=["renders"])
logger = structlog.get_logger("ass_api.renders")
DbDep = Annotated[Session, Depends(get_db)]
Pass = Literal["beauty", "alpha", "depth", "normal", "object_id", "cryptomatte", "motion_vector"]
DEFAULT_PASSES: list[Pass] = ["beauty", "alpha", "depth", "normal", "object_id", "cryptomatte"]
RenderStatus = Literal[
    "queued", "preparing", "running", "processing", "completed", "failed", "cancelled"
]


class RenderIn(ApiModel):
    # Révision à rendre ; la tête de la scène si absente.
    revision_id: uuid.UUID | None = None
    frame_start: Annotated[int, Field(ge=0)] | None = None
    frame_end: Annotated[int, Field(ge=0)] | None = None
    resolution_percent: Annotated[int, Field(ge=1, le=100)] = 100
    samples: Annotated[int, Field(ge=1, le=4096)] | None = None
    passes: list[Pass] = Field(default_factory=lambda: list(DEFAULT_PASSES))


class RenderJobOut(ApiModel):
    id: uuid.UUID
    shot_id: uuid.UUID
    scene_revision_id: uuid.UUID
    status: RenderStatus
    settings: dict[str, Any]
    progress: float
    message: str
    error: str | None
    outputs: dict[str, Any]
    created_by_id: uuid.UUID | None
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None


def job_out(job: RenderJob) -> RenderJobOut:
    return RenderJobOut.model_validate(job)


@router.post(
    "/shots/{shot_id}/renders", response_model=RenderJobOut, status_code=status.HTTP_201_CREATED
)
def create_render(
    shot_id: uuid.UUID,
    body: RenderIn,
    response: Response,
    current: CurrentSessionDep,
    db: DbDep,
    storage: Annotated[ObjectStorage, Depends(get_storage)],
    queue: Annotated[RenderQueue, Depends(get_render_queue)],
    settings: Annotated[Settings, Depends(get_settings)],
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key", max_length=100)] = None,
) -> RenderJobOut:
    shot, _sequence, _project, access = shot_access(db, current.user, shot_id, Role.EDITOR)
    if idempotency_key:
        existing = db.scalars(
            select(RenderJob).where(
                RenderJob.workspace_id == access.workspace.id,
                RenderJob.idempotency_key == idempotency_key,
            )
        ).one_or_none()
        if existing is not None:
            response.status_code = status.HTTP_200_OK
            return job_out(existing)

    scene = db.scalars(select(Scene).where(Scene.shot_id == shot.id)).one_or_none()
    revision_id = body.revision_id or (scene.head_revision_id if scene else None)
    revision = db.get(SceneRevision, revision_id) if revision_id else None
    if revision is None or scene is None or revision.scene_id != scene.id:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Aucune révision enregistrée à rendre pour ce plan"
        )

    snapshot = parse_snapshot(storage.get_bytes(revision.snapshot_key))
    assert isinstance(snapshot, dict)  # noqa: S101 (snapshot validé à l'écriture)
    render = snapshot["renderSettings"]
    frame_start = body.frame_start if body.frame_start is not None else render["frameStart"]
    frame_end = body.frame_end if body.frame_end is not None else render["frameEnd"]
    if not 0 <= frame_start <= frame_end < snapshot["durationFrames"]:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            f"Plage de frames invalide (0 à {snapshot['durationFrames'] - 1})",
        )
    if frame_end - frame_start + 1 > settings.render_max_frames:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            f"Au plus {settings.render_max_frames} frames par rendu",
        )
    passes = sorted(set(body.passes) | {"beauty"})
    if "motion_vector" in passes and render["motionBlur"]:
        # Cycles ne produit pas de vecteurs de mouvement quand le flou de mouvement est actif.
        passes.remove("motion_vector")
    job = RenderJob(
        workspace_id=access.workspace.id,
        shot_id=shot.id,
        scene_revision_id=revision.id,
        settings={
            "frameStart": frame_start,
            "frameEnd": frame_end,
            "resolutionPercent": body.resolution_percent,
            "samples": body.samples or render["samples"],
            "passes": passes,
        },
        message="En attente d'un worker de rendu",
        idempotency_key=idempotency_key,
        created_by_id=current.user.id,
    )
    db.add(job)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Clé d'idempotence déjà utilisée") from exc
    try:
        queue.push(str(job.id))
    except RedisError as exc:
        transition(job, "failed", "File de rendu indisponible")
        db.commit()
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "File de rendu indisponible"
        ) from exc
    db.refresh(job)
    logger.info("render_job_created", job_id=str(job.id), frames=frame_end - frame_start + 1)
    return job_out(job)


@router.get("/shots/{shot_id}/renders", response_model=list[RenderJobOut])
def list_renders(shot_id: uuid.UUID, current: CurrentSessionDep, db: DbDep) -> list[RenderJobOut]:
    """Les 50 rendus les plus récents du plan."""
    shot, _sequence, _project, _access = shot_access(db, current.user, shot_id, Role.VIEWER)
    jobs = db.scalars(
        select(RenderJob)
        .where(RenderJob.shot_id == shot.id)
        .order_by(RenderJob.created_at.desc(), RenderJob.id.desc())
        .limit(50)
    )
    return [job_out(job) for job in jobs]


def _job(db: Session, current: CurrentSessionDep, job_id: uuid.UUID, minimum: Role) -> RenderJob:
    job = db.get(RenderJob, job_id)
    if job is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ressource introuvable")
    shot_access(db, current.user, job.shot_id, minimum)  # 404 hors workspace
    return job


@router.get("/render-jobs/{job_id}", response_model=RenderJobOut)
def get_render(job_id: uuid.UUID, current: CurrentSessionDep, db: DbDep) -> RenderJobOut:
    return job_out(_job(db, current, job_id, Role.VIEWER))


@router.post("/render-jobs/{job_id}/cancel", response_model=RenderJobOut)
def cancel_render(job_id: uuid.UUID, current: CurrentSessionDep, db: DbDep) -> RenderJobOut:
    job = _job(db, current, job_id, Role.EDITOR)
    db.refresh(job, with_for_update=True)
    if job.status in ("completed", "failed", "cancelled"):
        raise HTTPException(status.HTTP_409_CONFLICT, "Ce rendu est déjà terminé")
    if job.status == "queued":
        transition(job, "cancelled", "Annulé avant le démarrage")
    else:
        # Le worker vérifie la demande entre deux frames et arrête Blender.
        job.cancel_requested = True
        job.message = "Annulation demandée"
    db.commit()
    db.refresh(job)
    return job_out(job)
