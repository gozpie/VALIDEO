"""Préparation et exécution d'une génération IA (partagé par l'API et le worker)."""

import json
import tempfile
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import structlog
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from ass_api.ai.capabilities import MEDIA_MODES, GenerationRequest
from ass_api.ai.providers.base import ProviderAdapter, ProviderError, RunContext
from ass_api.ai.scene_summary import describe_scene
from ass_api.assets.store import store_file
from ass_api.core.config import Settings
from ass_api.core.storage import ObjectStorage
from ass_api.db.models import Asset, GenerationJob, RenderJob, SceneRevision, Shot
from ass_api.render.jobs import RenderQueue, transition
from ass_api.scenes.validation import parse_snapshot

logger = structlog.get_logger("ass_api.ai")
TERMINAL = ("completed", "failed", "cancelled")


def request_from(job: GenerationJob) -> GenerationRequest:
    data = job.request
    return GenerationRequest(
        mode=job.mode,
        prompt=data.get("prompt", ""),
        negative_prompt=data.get("negativePrompt", ""),
        controls=list(data.get("controls", [])),
        reference_count=int(data.get("referenceCount", 0)),
        seed=data.get("seed"),
        width=int(data.get("width") or 0),
        height=int(data.get("height") or 0),
        duration_seconds=data.get("durationSeconds"),
        aspect_ratio=data.get("aspectRatio"),
        options=dict(data.get("options", {})),
    )


def _touch(
    db_factory: sessionmaker[Session], job_id: uuid.UUID, progress: float, message: str
) -> bool:
    with db_factory() as db:
        job = db.get(GenerationJob, job_id)
        if job is None:
            return True
        job.heartbeat_at = datetime.now(UTC)
        job.progress = min(max(progress, 0.0), 1.0)
        job.message = message[:500]
        db.commit()
        return job.cancel_requested


def _prepare_render(
    db_factory: sessionmaker[Session],
    render_queue: RenderQueue,
    job_id: uuid.UUID,
    settings: Settings,
) -> dict[str, Any] | None:
    """Rendu Blender de préparation (images de la caméra, profondeur, normales), puis attente."""
    with db_factory() as db:
        job = db.get(GenerationJob, job_id)
        assert job is not None  # noqa: S101
        frames = job.request.get("sceneFrames")
        if not frames:
            return None
        render = RenderJob(
            workspace_id=job.workspace_id,
            shot_id=job.shot_id,
            scene_revision_id=job.scene_revision_id,
            settings={
                "frameStart": min(frames),
                "frameEnd": max(frames),
                "frames": sorted(set(frames)),
                "conditioningMaps": True,
                "resolutionPercent": int(job.request.get("prepPercent", 50)),
                "samples": 16,
                "passes": ["beauty", "alpha", "depth", "normal"],
            },
            message="Préparation IA : en attente du worker de rendu",
            created_by_id=job.created_by_id,
        )
        db.add(render)
        db.flush()
        job.render_job_id = render.id
        db.commit()
        render_id = render.id
    render_queue.push(str(render_id))
    started = time.monotonic()
    while True:
        with db_factory() as db:
            polled = db.get(RenderJob, render_id)
            assert polled is not None  # noqa: S101
            if polled.status == "completed":
                return dict(polled.outputs)
            if polled.status in ("failed", "cancelled"):
                raise ProviderError("unknown", f"Rendu de préparation : {polled.message}")
        if _touch(db_factory, job_id, 0.05, "Préparation : rendu Blender de la caméra active"):
            raise ProviderError("cancelled", "Génération annulée")
        if time.monotonic() - started > settings.render_timeout_seconds:
            raise ProviderError("timeout", "Rendu de préparation trop long")
        time.sleep(2)


def _download(db: Session, storage: ObjectStorage, asset_id: str, folder: Path, name: str) -> Path:
    asset = db.get(Asset, uuid.UUID(asset_id))
    if asset is None:
        raise ProviderError("invalid_request", "Référence introuvable")
    suffix = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}.get(
        asset.mime_type, ".bin"
    )
    target = folder / f"{name}{suffix}"
    body = storage.open_stream(asset.storage_key)
    with target.open("wb") as handle:
        for chunk in body.iter_chunks(1024 * 1024):
            handle.write(chunk)
    return target


def run_generation(
    job_id: uuid.UUID,
    providers: dict[str, ProviderAdapter],
    settings: Settings,
    db_factory: sessionmaker[Session],
    storage: ObjectStorage,
    render_queue: RenderQueue,
    worker_id: str,
) -> None:
    with db_factory() as db:
        job = db.get(GenerationJob, job_id, with_for_update=True)
        if job is None or job.status != "queued":
            return
        transition(job, "preparing", "Préparation des entrées")
        job.worker_id = worker_id
        db.commit()
    try:
        _execute(job_id, providers, settings, db_factory, storage, render_queue)
    except ProviderError as exc:
        status = "cancelled" if exc.code == "cancelled" else "failed"
        _finish(db_factory, job_id, status, str(exc), f"{exc.code}: {exc.detail}"[:2000])
    except Exception as exc:
        logger.exception("generation_crashed", job_id=str(job_id))
        _finish(db_factory, job_id, "failed", "Erreur interne du worker IA", type(exc).__name__)


def _execute(
    job_id: uuid.UUID,
    providers: dict[str, ProviderAdapter],
    settings: Settings,
    db_factory: sessionmaker[Session],
    storage: ObjectStorage,
    render_queue: RenderQueue,
) -> None:
    prepared = _prepare_render(db_factory, render_queue, job_id, settings)
    with tempfile.TemporaryDirectory(prefix="ass-ai-") as directory:
        work = Path(directory)
        with db_factory() as db:
            job = db.get(GenerationJob, job_id)
            assert job is not None  # noqa: S101
            provider = providers[job.provider]
            revision = db.get(SceneRevision, job.scene_revision_id)
            shot = db.get(Shot, job.shot_id)
            assert revision is not None and shot is not None  # noqa: S101
            scene = parse_snapshot(storage.get_bytes(revision.snapshot_key))
            assert isinstance(scene, dict)  # noqa: S101
            frames = job.request.get("sceneFrames") or [scene["renderSettings"]["frameStart"]]
            summary = describe_scene(scene, min(frames), max(frames))
            caps = provider.capabilities_for(job.model_id)
            references: list[Path] = []
            used: list[dict[str, Any]] = []
            # Conversion des données 3D selon ce que le modèle accepte réellement.
            for frame, entry in sorted(
                (prepared or {}).get("frames", {}).items(), key=lambda e: int(e[0])
            ):
                references.append(
                    _download(db, storage, entry["beauty"], work, f"camera_frame_{frame}")
                )
                used.append(
                    {"role": "camera_view", "frame": int(frame), "assetId": entry["beauty"]}
                )
                if "depth" in caps.controls and "depth" in entry:
                    references.append(
                        _download(db, storage, entry["depth"], work, f"depth_frame_{frame}")
                    )
                    used.append({"role": "depth", "frame": int(frame), "assetId": entry["depth"]})
            for index, asset_id in enumerate(job.request.get("referenceAssetIds", [])):
                references.append(_download(db, storage, asset_id, work, f"reference_{index + 1}"))
                used.append({"role": "reference", "assetId": asset_id})
            references = references[: max(caps.max_reference_images, 0) or len(references)]
            request = request_from(job)
            manifest = {
                "format": "ai-scene-studio/generation-input@1",
                "provider": job.provider,
                "model": job.model_id,
                "mode": job.mode,
                "sceneRevisionId": str(job.scene_revision_id),
                "frames": frames,
                "prompt": request.prompt,
                "negativePrompt": request.negative_prompt,
                "references": used[: len(references)],
                "controls": request.controls,
                "warnings": job.request.get("warnings", []),
                "sceneSummary": summary,
                "renderJobId": str(job.render_job_id) if job.render_job_id else None,
            }
            key = f"workspaces/{job.workspace_id}/generations/{job.id}/input.json"
            storage.put_bytes(
                key, json.dumps(manifest, ensure_ascii=False).encode(), "application/json"
            )
            job.input_manifest_key = key
            transition(job, "running", f"{provider.label} : génération en cours")
            job.heartbeat_at = datetime.now(UTC)
            db.commit()
            shot_name, workspace_id, created_by = shot.name, job.workspace_id, job.created_by_id
            model_label = caps.label
        context = RunContext(
            work=work,
            references=references,
            scene_summary=summary,
            progress=lambda value, message: _touch(db_factory, job_id, value, message),
            timeout_seconds=settings.ai_timeout_seconds,
        )
        external_id, outputs = provider.run(job.model_id, request, context)
        with db_factory() as db:
            job = db.get(GenerationJob, job_id, with_for_update=True)
            assert job is not None  # noqa: S101
            if job.cancel_requested:
                raise ProviderError("cancelled", "Génération annulée")
            transition(job, "processing", "Publication des résultats")
            result: dict[str, Any] = {"assets": []}
            actual = None
            for index, output in enumerate(outputs):
                if output.kind == "json":
                    result["result"] = output.data
                elif output.path is not None:
                    asset = store_file(
                        db,
                        storage,
                        workspace_id=workspace_id,
                        path=output.path,
                        name=f"{shot_name} ({model_label}) {index + 1}{output.path.suffix}",
                        asset_type="image" if output.kind == "image" else "video",
                        mime_type=output.mime_type,
                        metadata={
                            "generationJobId": str(job.id),
                            "provider": job.provider,
                            "model": job.model_id,
                            "aiGenerated": True,
                            "simulated": bool(output.metadata.get("simulated")),
                        },
                        created_by_id=created_by,
                    )
                    result["assets"].append({"assetId": str(asset.id), "kind": output.kind})
                actual = output.metadata.get("actualCost", actual)
            job.outputs = result
            job.external_id = external_id
            job.actual_cost = actual if actual is not None else job.estimated_cost
            key = f"workspaces/{job.workspace_id}/generations/{job.id}/output.json"
            storage.put_bytes(
                key, json.dumps(result, ensure_ascii=False).encode(), "application/json"
            )
            job.output_manifest_key = key
            job.progress = 1.0
            transition(job, "completed", "Génération terminée")
            db.commit()


def _finish(
    db_factory: sessionmaker[Session], job_id: uuid.UUID, status: str, message: str, error: str
) -> None:
    with db_factory() as db:
        job = db.get(GenerationJob, job_id, with_for_update=True)
        if job is None or job.status in TERMINAL:
            return
        transition(job, status, message)
        job.error_details = error
        db.commit()


def media_mode(mode: str) -> bool:
    return mode in MEDIA_MODES


def pending_ids(db: Session, provider: str) -> list[str]:
    jobs = db.scalars(
        select(GenerationJob.id).where(
            GenerationJob.provider == provider, GenerationJob.status == "queued"
        )
    )
    return [str(job_id) for job_id in jobs]
