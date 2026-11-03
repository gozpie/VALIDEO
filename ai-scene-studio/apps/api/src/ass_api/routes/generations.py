"""Générations IA d'un plan : fournisseurs disponibles, estimation, lancement confirmé, suivi.

Une génération payante n'est acceptée que si `confirmedCost` reprend exactement l'estimation du
serveur (l'utilisateur a vu et validé le montant). Les contraintes que le modèle ne sait pas
respecter sont signalées (« ignorées » : contrôle seulement indicatif ; « bloquantes » : refus).
"""

import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

import redis
import structlog
from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response, status
from pydantic import Field
from redis.exceptions import RedisError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ass_api.ai.capabilities import GenerationRequest
from ass_api.ai.providers.base import ProviderAdapter, ProviderError
from ass_api.ai.registry import default_providers, queue_key
from ass_api.ai.worker import read_availability
from ass_api.auth.dependencies import CurrentSessionDep
from ass_api.auth.permissions import Role, shot_access
from ass_api.core.api_model import ApiModel
from ass_api.core.config import Settings, get_settings
from ass_api.db.models import Asset, GenerationJob, Scene, SceneRevision
from ass_api.db.session import get_db
from ass_api.render.jobs import RenderQueue, transition

router = APIRouter(tags=["generations"])
logger = structlog.get_logger("ass_api.generations")
DbDep = Annotated[Session, Depends(get_db)]
SettingsDep = Annotated[Settings, Depends(get_settings)]
Mode = Literal[
    "text_to_image",
    "image_to_image",
    "text_to_video",
    "image_to_video",
    "prompt_from_scene",
    "scene_from_text",
    "image_analysis",
]
JobStatus = Literal[
    "queued", "preparing", "running", "processing", "completed", "failed", "cancelled"
]


def get_providers() -> dict[str, ProviderAdapter]:
    return default_providers()


def get_redis(request: Request) -> "redis.Redis":
    client: redis.Redis = request.app.state.redis
    return client


ProvidersDep = Annotated[dict[str, ProviderAdapter], Depends(get_providers)]
RedisDep = Annotated["redis.Redis", Depends(get_redis)]


class GenerationIn(ApiModel):
    provider: Annotated[str, Field(max_length=50)]
    model: Annotated[str, Field(max_length=100)]
    mode: Mode
    prompt: Annotated[str, Field(max_length=4000)] = ""
    negative_prompt: Annotated[str, Field(max_length=2000)] = ""
    revision_id: uuid.UUID | None = None
    # Frames de la caméra active rendues par Blender pour conditionner (première, dernière).
    scene_frames: Annotated[list[Annotated[int, Field(ge=0)]], Field(max_length=2)] = Field(
        default_factory=list
    )
    reference_asset_ids: Annotated[list[uuid.UUID], Field(max_length=8)] = Field(
        default_factory=list
    )
    aspect_ratio: Annotated[str, Field(max_length=10)] | None = None
    duration_seconds: Annotated[int, Field(ge=1, le=60)] | None = None
    seed: int | None = None
    options: dict[str, bool | int | str] = Field(default_factory=dict)
    confirmed_cost: float | None = None


class MismatchOut(ApiModel):
    field: str
    severity: Literal["blocking", "ignored"]
    message: str


class EstimateOut(ApiModel):
    amount: float
    unit: str
    basis: str
    paid: bool
    mismatches: list[MismatchOut]
    available: bool
    reason: str


class ModelOut(ApiModel):
    model: str
    label: str
    modes: list[str]
    controls: list[str]
    max_reference_images: int
    durations_seconds: list[int]
    aspect_ratios: list[str]
    notes: str


class ProviderOut(ApiModel):
    id: str
    label: str
    kind: Literal["official", "subscription", "bridge", "simulation"]
    available: bool
    reason: str
    models: list[ModelOut]


class GenerationJobOut(ApiModel):
    id: uuid.UUID
    shot_id: uuid.UUID
    scene_revision_id: uuid.UUID
    render_job_id: uuid.UUID | None
    provider: str
    model_id: str
    mode: str
    status: JobStatus
    request: dict[str, Any]
    progress: float
    message: str
    outputs: dict[str, Any]
    estimated_cost: float | None
    actual_cost: float | None
    cost_unit: str
    error_details: str | None
    created_by_id: uuid.UUID | None
    created_at: datetime
    completed_at: datetime | None


def _availability(client: "redis.Redis", settings: Settings, provider: str) -> tuple[bool, str]:
    try:
        beat = read_availability(client, settings, provider)
    except RedisError:
        return False, "File IA indisponible"
    if beat is None:
        return False, "Aucun worker IA actif pour ce fournisseur"
    return bool(beat.get("available")), str(beat.get("reason") or "")


@router.get("/ai/providers", response_model=list[ProviderOut])
def list_providers(
    current: CurrentSessionDep, providers: ProvidersDep, client: RedisDep, settings: SettingsDep
) -> list[ProviderOut]:
    result = []
    for provider in providers.values():
        available, reason = _availability(client, settings, provider.id)
        result.append(
            ProviderOut(
                id=provider.id,
                label=provider.label,
                kind=provider.kind,
                available=available,
                reason=reason,
                models=[
                    ModelOut(
                        model=c.model,
                        label=c.label,
                        modes=list(c.modes),
                        controls=list(c.controls),
                        max_reference_images=c.max_reference_images,
                        durations_seconds=list(c.durations_seconds),
                        aspect_ratios=list(c.aspect_ratios),
                        notes=c.notes,
                    )
                    for c in provider.get_capabilities()
                ],
            )
        )
    return result


def _build(
    body: GenerationIn, providers: dict[str, ProviderAdapter], render: dict[str, Any]
) -> tuple[ProviderAdapter, GenerationRequest]:
    provider = providers.get(body.provider)
    if provider is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Fournisseur inconnu")
    controls: list[str] = []
    if body.scene_frames:
        controls += ["first_frame", "depth", "normals"]
        if len(set(body.scene_frames)) > 1:
            controls.append("last_frame")
    if body.reference_asset_ids:
        controls.append("reference_images")
    aspect = body.aspect_ratio
    width, height = render["width"], render["height"]
    request = GenerationRequest(
        mode=body.mode,
        prompt=body.prompt,
        negative_prompt=body.negative_prompt,
        controls=controls,
        reference_count=len(body.reference_asset_ids),
        seed=body.seed,
        width=width,
        height=height,
        duration_seconds=body.duration_seconds,
        aspect_ratio=aspect,
        options=dict(body.options),
    )
    return provider, request


def _context(
    db: Session, current: CurrentSessionDep, shot_id: uuid.UUID, body: GenerationIn
) -> tuple[Any, SceneRevision, dict[str, Any]]:
    shot, _sequence, _project, access = shot_access(db, current.user, shot_id, Role.EDITOR)
    scene = db.scalars(select(Scene).where(Scene.shot_id == shot.id)).one_or_none()
    revision_id = body.revision_id or (scene.head_revision_id if scene else None)
    revision = db.get(SceneRevision, revision_id) if revision_id else None
    if revision is None or scene is None or revision.scene_id != scene.id:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Enregistrez la scène avant de lancer une génération"
        )
    known = set(
        db.scalars(
            select(Asset.id).where(
                Asset.workspace_id == access.workspace.id,
                Asset.id.in_(body.reference_asset_ids),
                Asset.mime_type.in_(("image/png", "image/jpeg", "image/webp")),
            )
        )
    )
    if len(known) != len(set(body.reference_asset_ids)):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Référence inconnue ou qui n'est pas une image"
        )
    return access, revision, {"width": 1920, "height": 1080}


def _estimate(
    provider: ProviderAdapter, body: GenerationIn, request: GenerationRequest
) -> tuple[Any, list[Any]]:
    try:
        mismatches = provider.validate_request(body.model, request)
        cost = provider.estimate_cost(body.model, request)
    except ProviderError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc
    return cost, mismatches


@router.post("/shots/{shot_id}/generations/estimate", response_model=EstimateOut)
def estimate_generation(
    shot_id: uuid.UUID,
    body: GenerationIn,
    current: CurrentSessionDep,
    db: DbDep,
    providers: ProvidersDep,
    client: RedisDep,
    settings: SettingsDep,
) -> EstimateOut:
    _access, _revision, render = _context(db, current, shot_id, body)
    provider, request = _build(body, providers, render)
    cost, mismatches = _estimate(provider, body, request)
    available, reason = _availability(client, settings, provider.id)
    return EstimateOut(
        amount=cost.amount,
        unit=cost.unit,
        basis=cost.basis,
        paid=cost.paid,
        mismatches=[
            MismatchOut(field=m.field, severity=m.severity, message=m.message) for m in mismatches
        ],
        available=available,
        reason=reason,
    )


@router.post(
    "/shots/{shot_id}/generations",
    response_model=GenerationJobOut,
    status_code=status.HTTP_201_CREATED,
)
def create_generation(
    shot_id: uuid.UUID,
    body: GenerationIn,
    response: Response,
    current: CurrentSessionDep,
    db: DbDep,
    providers: ProvidersDep,
    client: RedisDep,
    settings: SettingsDep,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key", max_length=100)] = None,
) -> GenerationJobOut:
    access, revision, render = _context(db, current, shot_id, body)
    if idempotency_key:
        existing = db.scalars(
            select(GenerationJob).where(
                GenerationJob.workspace_id == access.workspace.id,
                GenerationJob.idempotency_key == idempotency_key,
            )
        ).one_or_none()
        if existing is not None:
            response.status_code = status.HTTP_200_OK
            return GenerationJobOut.model_validate(existing)
    provider, request = _build(body, providers, render)
    cost, mismatches = _estimate(provider, body, request)
    blocking = [m for m in mismatches if m.severity == "blocking"]
    if blocking:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, blocking[0].message)
    available, reason = _availability(client, settings, provider.id)
    if not available:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, reason or "Fournisseur indisponible"
        )
    if cost.paid and body.confirmed_cost != cost.amount:
        # Aucune dépense sans confirmation explicite du montant estimé.
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Confirmation du coût requise : {cost.amount:g} {cost.unit} ({cost.basis})",
        )
    job = GenerationJob(
        workspace_id=access.workspace.id,
        shot_id=shot_id,
        scene_revision_id=revision.id,
        provider=provider.id,
        model_id=body.model,
        mode=body.mode,
        request={
            "prompt": body.prompt,
            "negativePrompt": body.negative_prompt,
            "controls": request.controls,
            "referenceCount": request.reference_count,
            "referenceAssetIds": [str(i) for i in body.reference_asset_ids],
            "sceneFrames": sorted(set(body.scene_frames)),
            "seed": body.seed,
            "width": request.width,
            "height": request.height,
            "durationSeconds": body.duration_seconds,
            "aspectRatio": body.aspect_ratio,
            "options": body.options,
            "warnings": [m.message for m in mismatches],
        },
        estimated_cost=cost.amount,
        cost_unit=cost.unit,
        message="En attente du worker IA",
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
        RenderQueue(client, queue_key(settings, provider.id)).push(str(job.id))
    except RedisError as exc:
        transition(job, "failed", "File IA indisponible")
        db.commit()
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "File IA indisponible") from exc
    db.refresh(job)
    logger.info("generation_created", job_id=str(job.id), provider=provider.id, model=body.model)
    return GenerationJobOut.model_validate(job)


@router.get("/shots/{shot_id}/generations", response_model=list[GenerationJobOut])
def list_generations(
    shot_id: uuid.UUID, current: CurrentSessionDep, db: DbDep
) -> list[GenerationJobOut]:
    shot, _sequence, _project, _access = shot_access(db, current.user, shot_id, Role.VIEWER)
    jobs = db.scalars(
        select(GenerationJob)
        .where(GenerationJob.shot_id == shot.id)
        .order_by(GenerationJob.created_at.desc(), GenerationJob.id.desc())
        .limit(50)
    )
    return [GenerationJobOut.model_validate(job) for job in jobs]


def _job(
    db: Session, current: CurrentSessionDep, job_id: uuid.UUID, minimum: Role
) -> GenerationJob:
    job = db.get(GenerationJob, job_id)
    if job is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ressource introuvable")
    shot_access(db, current.user, job.shot_id, minimum)
    return job


@router.get("/generation-jobs/{job_id}", response_model=GenerationJobOut)
def get_generation(job_id: uuid.UUID, current: CurrentSessionDep, db: DbDep) -> GenerationJobOut:
    return GenerationJobOut.model_validate(_job(db, current, job_id, Role.VIEWER))


@router.post("/generation-jobs/{job_id}/cancel", response_model=GenerationJobOut)
def cancel_generation(job_id: uuid.UUID, current: CurrentSessionDep, db: DbDep) -> GenerationJobOut:
    job = _job(db, current, job_id, Role.EDITOR)
    db.refresh(job, with_for_update=True)
    if job.status in ("completed", "failed", "cancelled"):
        raise HTTPException(status.HTTP_409_CONFLICT, "Cette génération est déjà terminée")
    if job.status == "queued":
        transition(job, "cancelled", "Annulée avant le démarrage")
    else:
        job.cancel_requested = True
        job.message = "Annulation demandée"
    db.commit()
    db.refresh(job)
    return GenerationJobOut.model_validate(job)
