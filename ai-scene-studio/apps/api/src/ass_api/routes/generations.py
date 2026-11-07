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

from ass_api.ai.capabilities import (
    MEDIA_MODES,
    PROJECT_MODES,
    SCENE_MODES,
    SCRIPT_MODES,
    GenerationRequest,
)
from ass_api.ai.providers.base import ProviderAdapter, ProviderError
from ass_api.ai.registry import default_providers, queue_key
from ass_api.ai.studio_context import shot_reference_entries
from ass_api.ai.worker import read_availability
from ass_api.auth.dependencies import CurrentSessionDep
from ass_api.auth.permissions import Access, Role, project_access, shot_access
from ass_api.core.api_model import ApiModel
from ass_api.core.config import Settings, get_settings
from ass_api.db.models import (
    Asset,
    BibleEntry,
    GenerationJob,
    Project,
    ProjectScript,
    Scene,
    SceneRevision,
    Sequence,
    Shot,
    ShotVersion,
)
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
    "scene_from_shot",
    "script_breakdown",
    "bible_from_script",
    "shot_prompts",
    "gozcut_project",
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
    # Studio : version dont on repart (arbre des versions), élément de bible illustré, script.
    parent_version_id: uuid.UUID | None = None
    bible_entry_id: uuid.UUID | None = None
    script_id: uuid.UUID | None = None
    # Plan : ajoute en tête des références les images clés des éléments de bible liés au plan.
    bible_references: bool = False
    # Vidéo de mouvement (vidéo grise du plateau) : le modèle reprend sa caméra et ses places.
    motion_video_asset_id: uuid.UUID | None = None


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
    kind: Literal["official", "subscription", "bridge", "simulation", "tool"]
    available: bool
    reason: str
    models: list[ModelOut]


class GenerationJobOut(ApiModel):
    id: uuid.UUID
    project_id: uuid.UUID
    shot_id: uuid.UUID | None
    scene_revision_id: uuid.UUID | None
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


# Quand un moteur ne répond pas : ce qu'il faut relancer, en clair.
STOPPED = {
    "claude": "Le service Claude est arrêté : relancez « docker compose up -d ai-worker »",
    "simulation": "Le service IA est arrêté : relancez « docker compose up -d ai-worker »",
    "higgsfield": "Higgsfield n'est pas lancé : ./scripts/mac-worker.sh gozcut,higgsfield",
    "gozcut": "Le pont gozCut n'est pas lancé : ./scripts/mac-worker.sh sur le Mac",
}


def _availability(client: "redis.Redis", settings: Settings, provider: str) -> tuple[bool, str]:
    try:
        beat = read_availability(client, settings, provider)
    except RedisError:
        return False, "File IA indisponible"
    if beat is None:
        return False, STOPPED.get(provider, "Ce moteur n'est pas lancé")
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
    if body.motion_video_asset_id:
        controls.append("camera_motion")
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


RENDER = {"width": 1920, "height": 1080}


def _check_references(db: Session, access: Access, body: GenerationIn) -> None:
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
    if body.motion_video_asset_id is not None:
        video = db.get(Asset, body.motion_video_asset_id)
        if (
            video is None
            or video.workspace_id != access.workspace.id
            or video.mime_type not in ("video/mp4", "video/webm", "video/quicktime")
        ):
            raise _unprocessable("Vidéo de mouvement inconnue ou qui n'est pas une vidéo")


def _unprocessable(message: str) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, message)


class Target:
    """Ce à quoi une génération est rattachée : un plan (et sa scène) ou le projet seul."""

    def __init__(
        self,
        access: Access,
        project: Project,
        shot_id: uuid.UUID | None,
        revision: SceneRevision | None,
    ) -> None:
        self.access, self.project, self.shot_id, self.revision = access, project, shot_id, revision


def _shot_target(
    db: Session,
    current: CurrentSessionDep,
    shot_id: uuid.UUID,
    body: GenerationIn,
    require_revision: bool = True,
) -> Target:
    shot, _sequence, project, access = shot_access(db, current.user, shot_id, Role.EDITOR)
    if body.mode in PROJECT_MODES:
        raise _unprocessable("Ce mode se lance depuis le studio du projet")
    if body.bible_entry_id is not None or body.script_id is not None:
        raise _unprocessable("Élément de bible ou script : génération du projet uniquement")
    scene = db.scalars(select(Scene).where(Scene.shot_id == shot.id)).one_or_none()
    revision_id = body.revision_id or (scene.head_revision_id if scene else None)
    revision = db.get(SceneRevision, revision_id) if revision_id else None
    valid = revision is not None and scene is not None and revision.scene_id == scene.id
    # La scène 3D n'est indispensable que si elle conditionne la génération. L'estimation reste
    # possible avant le premier enregistrement ; la génération, non.
    needs_scene = body.mode in SCENE_MODES or bool(body.scene_frames)
    if not valid and (body.revision_id is not None or (needs_scene and require_revision)):
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Enregistrez la scène avant de lancer une génération"
        )
    if body.bible_references:
        keys = [e.key_asset_id for e in shot_reference_entries(db, shot) if e.key_asset_id]
        merged = list(dict.fromkeys([*keys, *body.reference_asset_ids]))
        body.reference_asset_ids = merged[:8]
    if body.parent_version_id is not None:
        parent = db.get(ShotVersion, body.parent_version_id)
        if parent is None or parent.shot_id != shot.id:
            raise _unprocessable("Version parente inconnue pour ce plan")
    if body.mode == "scene_from_shot" and body.parent_version_id is None:
        raise _unprocessable("Choisissez la version du plan à transformer en scène 3D")
    _check_references(db, access, body)
    return Target(access, project, shot.id, revision if valid else None)


def _project_target(
    db: Session, current: CurrentSessionDep, project_id: uuid.UUID, body: GenerationIn
) -> Target:
    project, access = project_access(db, current.user, project_id, Role.EDITOR)
    if body.scene_frames or body.revision_id or body.parent_version_id:
        raise _unprocessable("Scène et versions de plan : génération d'un plan uniquement")
    if body.mode == "gozcut_project":
        shots = db.scalar(
            select(Shot.id)
            .join(Sequence, Sequence.id == Shot.sequence_id)
            .where(Sequence.project_id == project.id)
            .limit(1)
        )
        if shots is None:
            raise HTTPException(status.HTTP_409_CONFLICT, "Le storyboard est vide")
    elif body.mode in SCRIPT_MODES:
        query = select(ProjectScript.id).where(ProjectScript.project_id == project.id)
        if body.script_id is not None:
            query = query.where(ProjectScript.id == body.script_id)
        if db.scalar(query.limit(1)) is None:
            raise HTTPException(
                status.HTTP_409_CONFLICT, "Enregistrez d'abord un brief ou un script du projet"
            )
    elif body.mode in MEDIA_MODES and body.bible_entry_id is not None:
        if body.mode not in ("text_to_image", "image_to_image"):
            raise _unprocessable("Un élément de bible s'illustre par une image")
        entry = db.get(BibleEntry, body.bible_entry_id)
        if entry is None or entry.project_id != project.id:
            raise _unprocessable("Élément de bible inconnu dans ce projet")
    else:
        raise _unprocessable(
            "Au niveau du projet : découpage, bible, gozCut ou image d'un élément de bible"
        )
    _check_references(db, access, body)
    return Target(access, project, None, None)


def _estimate(
    provider: ProviderAdapter, body: GenerationIn, request: GenerationRequest
) -> tuple[Any, list[Any]]:
    try:
        mismatches = provider.validate_request(body.model, request)
        cost = provider.estimate_cost(body.model, request)
    except ProviderError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc
    return cost, mismatches


def _estimate_out(
    target: Target,
    body: GenerationIn,
    providers: dict[str, ProviderAdapter],
    client: "redis.Redis",
    settings: Settings,
) -> EstimateOut:
    provider, request = _build(body, providers, RENDER)
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


def _create(
    db: Session,
    target: Target,
    body: GenerationIn,
    response: Response,
    current: CurrentSessionDep,
    providers: dict[str, ProviderAdapter],
    client: "redis.Redis",
    settings: Settings,
    idempotency_key: str | None,
) -> GenerationJobOut:
    workspace_id = target.access.workspace.id
    if idempotency_key:
        existing = db.scalars(
            select(GenerationJob).where(
                GenerationJob.workspace_id == workspace_id,
                GenerationJob.idempotency_key == idempotency_key,
            )
        ).one_or_none()
        if existing is not None:
            response.status_code = status.HTTP_200_OK
            return GenerationJobOut.model_validate(existing)
    provider, request = _build(body, providers, RENDER)
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
        workspace_id=workspace_id,
        project_id=target.project.id,
        shot_id=target.shot_id,
        scene_revision_id=target.revision.id if target.revision else None,
        provider=provider.id,
        model_id=body.model,
        mode=body.mode,
        request={
            "prompt": body.prompt,
            "negativePrompt": body.negative_prompt,
            "controls": request.controls,
            "referenceCount": request.reference_count,
            "referenceAssetIds": [str(i) for i in body.reference_asset_ids],
            "motionVideoAssetId": (
                str(body.motion_video_asset_id) if body.motion_video_asset_id else None
            ),
            "sceneFrames": sorted(set(body.scene_frames)),
            "seed": body.seed,
            "width": request.width,
            "height": request.height,
            "durationSeconds": body.duration_seconds,
            "aspectRatio": body.aspect_ratio,
            "options": body.options,
            "warnings": [m.message for m in mismatches],
            "parentVersionId": str(body.parent_version_id) if body.parent_version_id else None,
            "bibleEntryId": str(body.bible_entry_id) if body.bible_entry_id else None,
            "scriptId": str(body.script_id) if body.script_id else None,
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


IdempotencyKey = Annotated[str | None, Header(alias="Idempotency-Key", max_length=100)]


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
    target = _shot_target(db, current, shot_id, body, require_revision=False)
    return _estimate_out(target, body, providers, client, settings)


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
    idempotency_key: IdempotencyKey = None,
) -> GenerationJobOut:
    target = _shot_target(db, current, shot_id, body)
    return _create(
        db, target, body, response, current, providers, client, settings, idempotency_key
    )


@router.post("/projects/{project_id}/generations/estimate", response_model=EstimateOut)
def estimate_project_generation(
    project_id: uuid.UUID,
    body: GenerationIn,
    current: CurrentSessionDep,
    db: DbDep,
    providers: ProvidersDep,
    client: RedisDep,
    settings: SettingsDep,
) -> EstimateOut:
    target = _project_target(db, current, project_id, body)
    return _estimate_out(target, body, providers, client, settings)


@router.post(
    "/projects/{project_id}/generations",
    response_model=GenerationJobOut,
    status_code=status.HTTP_201_CREATED,
)
def create_project_generation(
    project_id: uuid.UUID,
    body: GenerationIn,
    response: Response,
    current: CurrentSessionDep,
    db: DbDep,
    providers: ProvidersDep,
    client: RedisDep,
    settings: SettingsDep,
    idempotency_key: IdempotencyKey = None,
) -> GenerationJobOut:
    """Découpage, bible ou image d'un élément de bible : rattachés au projet, sans plan."""
    target = _project_target(db, current, project_id, body)
    return _create(
        db, target, body, response, current, providers, client, settings, idempotency_key
    )


@router.get("/projects/{project_id}/generations", response_model=list[GenerationJobOut])
def list_project_generations(
    project_id: uuid.UUID, current: CurrentSessionDep, db: DbDep
) -> list[GenerationJobOut]:
    project, _access = project_access(db, current.user, project_id, Role.VIEWER)
    jobs = db.scalars(
        select(GenerationJob)
        .where(GenerationJob.project_id == project.id, GenerationJob.shot_id.is_(None))
        .order_by(GenerationJob.created_at.desc(), GenerationJob.id.desc())
        .limit(50)
    )
    return [GenerationJobOut.model_validate(job) for job in jobs]


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
    project_access(db, current.user, job.project_id, minimum)
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
