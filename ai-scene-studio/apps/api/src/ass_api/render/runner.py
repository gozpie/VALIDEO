"""Exécution d'un job de rendu : préparation, Blender, encodage FFmpeg, publication des sorties.

Chaque étape met à jour l'état et la progression en base. Une annulation demandée est prise en
compte entre deux frames (Blender est arrêté). Toute erreur passe le job en échec avec un message
lisible ; le détail technique reste dans les journaux du worker.
"""

import json
import shutil
import subprocess
import tempfile
import time
import uuid
import zipfile
from pathlib import Path
from typing import Any

import structlog
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from ass_api.assets.store import store_file
from ass_api.core.config import Settings
from ass_api.core.storage import ObjectStorage
from ass_api.db.models import Asset, RenderJob, SceneRevision, Shot
from ass_api.render.jobs import touch, transition
from ass_api.render.prepare import build_description
from ass_api.scenes.validation import parse_snapshot

logger = structlog.get_logger("ass_api.render.runner")
BLENDER_SCRIPT = Path("/app/blender/build_scene.py")


class RenderCancelledError(Exception):
    pass


class RenderFailedError(Exception):
    """Erreur dont le message peut être montré à l'utilisateur."""


def _blender_script(settings: Settings) -> Path:
    local = Path(__file__).resolve().parents[5] / "workers/render-worker/blender/build_scene.py"
    return BLENDER_SCRIPT if BLENDER_SCRIPT.exists() else local


def _download_models(
    db: Session, storage: ObjectStorage, job: RenderJob, scene: dict[str, Any], folder: Path
) -> dict[str, str]:
    paths: dict[str, str] = {}
    ids = {uuid.UUID(n["assetId"]) for n in scene["nodes"] if n["assetId"] and n["type"] == "model"}
    for asset in db.scalars(
        select(Asset).where(Asset.id.in_(ids), Asset.workspace_id == job.workspace_id)
    ):
        target = folder / f"{asset.sha256}.glb"
        body = storage.open_stream(asset.storage_key)
        with target.open("wb") as handle:
            for chunk in body.iter_chunks(1024 * 1024):
                handle.write(chunk)
        paths[str(asset.id)] = str(target)
    missing = {str(i) for i in ids} - set(paths)
    if missing:
        raise RenderFailedError(
            "Modèle introuvable dans le workspace : " + ", ".join(sorted(missing))
        )
    return paths


def _run_blender(
    settings: Settings, db_factory: sessionmaker[Session], job_id: uuid.UUID, work: Path, total: int
) -> None:
    command = [
        settings.blender_path,
        "-b",
        "--factory-startup",
        "--python-exit-code",
        "1",
        "--python",
        str(_blender_script(settings)),
        "--",
        "--description",
        str(work / "description.json"),
        "--output",
        str(work / "out"),
        "--blend",
        str(work / "out" / "scene.blend"),
        "--render",
    ]
    process = subprocess.Popen(  # noqa: S603 (commande construite par le serveur, sans shell)
        command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1
    )
    done = 0
    tail: list[str] = []
    started = time.monotonic()
    assert process.stdout is not None  # noqa: S101
    try:
        for line in process.stdout:
            tail = [*tail, line.rstrip()][-40:]
            if line.startswith("ASS_FRAME"):
                done += 1
                with db_factory() as db:
                    cancel = touch(
                        db, job_id, 0.05 + 0.85 * done / total, f"Frame {done}/{total} rendue"
                    )
                if cancel:
                    raise RenderCancelledError
            if time.monotonic() - started > settings.render_timeout_seconds:
                raise RenderFailedError("Durée maximale de rendu dépassée")
        code = process.wait()
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()
    if code != 0:
        logger.error("blender_failed", code=code, output="\n".join(tail))
        raise RenderFailedError(f"Blender s'est arrêté avec le code {code}")


def _ffmpeg(settings: Settings, args: list[str]) -> None:
    result = subprocess.run(  # noqa: S603 (arguments construits par le serveur)
        [settings.ffmpeg_path, "-hide_banner", "-loglevel", "error", "-y", *args],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        logger.error("ffmpeg_failed", stderr=result.stderr[-4000:])
        raise RenderFailedError("Échec de l'encodage vidéo")


def _encode(settings: Settings, out: Path, description: dict[str, Any]) -> dict[str, Path]:
    fps = f"{description['fps']['numerator']}/{description['fps']['denominator']}"
    sequence = ["-framerate", fps, "-start_number", str(description["frameStart"])]
    source = ["-i", str(out / "png" / "frame_%04d.png")]
    files = {"video": out / "rendu.mp4"}
    _ffmpeg(
        settings,
        [
            *sequence,
            *source,
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-crf",
            "18",
            "-vf",
            "pad=ceil(iw/2)*2:ceil(ih/2)*2",
            "-movflags",
            "+faststart",
            str(files["video"]),
        ],
    )
    if description["render"]["transparentBackground"]:
        files["alphaVideo"] = out / "rendu-alpha.mov"
        _ffmpeg(
            settings,
            [
                *sequence,
                *source,
                "-c:v",
                "prores_ks",
                "-profile:v",
                "4444",
                "-pix_fmt",
                "yuva444p10le",
                str(files["alphaVideo"]),
            ],
        )
    files["passes"] = out / "passes-exr.zip"
    with zipfile.ZipFile(files["passes"], "w", zipfile.ZIP_STORED) as archive:
        for exr in sorted((out / "exr").glob("*.exr")):
            archive.write(exr, exr.name)
    first = sorted((out / "png").glob("*.png"))[0]
    files["preview"] = out / "apercu.png"
    shutil.copy(first, files["preview"])
    files["blend"] = out / "scene.blend"
    return files


OUTPUT_TYPES = {
    "video": ("render", "video/mp4", "Rendu {shot} (H.264).mp4"),
    "alphaVideo": ("render", "video/quicktime", "Rendu {shot} (ProRes 4444 alpha).mov"),
    "passes": ("render_pass", "application/zip", "Passes {shot} (OpenEXR multicouche).zip"),
    "preview": ("image", "image/png", "Aperçu {shot}.png"),
    "blend": ("render", "application/x-blender", "Scène {shot}.blend"),
}


def run_job(
    job_id: uuid.UUID,
    settings: Settings,
    db_factory: sessionmaker[Session],
    storage: ObjectStorage,
    worker_id: str,
) -> None:
    with db_factory() as db:
        job = db.get(RenderJob, job_id, with_for_update=True)
        if job is None or job.status != "queued":
            return
        transition(job, "preparing", "Préparation de la scène")
        job.worker_id = worker_id
        db.commit()
    try:
        with tempfile.TemporaryDirectory(prefix="ass-render-") as directory:
            work = Path(directory)
            (work / "assets").mkdir()
            with db_factory() as db:
                job = db.get(RenderJob, job_id)
                assert job is not None  # noqa: S101
                revision = db.get(SceneRevision, job.scene_revision_id)
                shot = db.get(Shot, job.shot_id)
                assert revision is not None and shot is not None  # noqa: S101
                scene = parse_snapshot(storage.get_bytes(revision.snapshot_key))
                assert isinstance(scene, dict)  # noqa: S101
                if scene["activeCameraId"] is None:
                    raise RenderFailedError(
                        "Aucune caméra active dans la scène : choisissez-en une"
                    )
                paths = _download_models(db, storage, job, scene, work / "assets")
                description = build_description(scene, job.settings, paths)
                (work / "description.json").write_text(json.dumps(description), encoding="utf-8")
                total = job.settings["frameEnd"] - job.settings["frameStart"] + 1
                shot_name = shot.name
                transition(job, "running", f"Rendu Blender : 0/{total} frames")
                db.commit()
            _run_blender(settings, db_factory, job_id, work, total)
            with db_factory() as db:
                job = db.get(RenderJob, job_id, with_for_update=True)
                assert job is not None  # noqa: S101
                if job.cancel_requested:
                    raise RenderCancelledError
                transition(job, "processing", "Encodage vidéo et publication des sorties")
                db.commit()
            files = _encode(settings, work / "out", description)
            with db_factory() as db:
                job = db.get(RenderJob, job_id, with_for_update=True)
                assert job is not None  # noqa: S101
                outputs: dict[str, Any] = {}
                for key, path in files.items():
                    asset_type, mime, label = OUTPUT_TYPES[key]
                    asset = store_file(
                        db,
                        storage,
                        workspace_id=job.workspace_id,
                        path=path,
                        name=label.format(shot=shot_name),
                        asset_type=asset_type,
                        mime_type=mime,
                        metadata={"renderJobId": str(job.id), "frames": total},
                        created_by_id=job.created_by_id,
                    )
                    outputs[key] = str(asset.id)
                job.outputs = outputs
                job.progress = 1.0
                transition(job, "completed", f"Rendu terminé : {total} frame(s)")
                db.commit()
                logger.info("render_completed", job_id=str(job_id), frames=total)
    except RenderCancelledError:
        finish(db_factory, job_id, "cancelled", "Rendu annulé", None)
    except RenderFailedError as exc:
        finish(db_factory, job_id, "failed", str(exc), str(exc))
    except Exception as exc:
        logger.exception("render_crashed", job_id=str(job_id))
        finish(
            db_factory, job_id, "failed", "Erreur interne du worker de rendu", type(exc).__name__
        )


def finish(
    db_factory: sessionmaker[Session],
    job_id: uuid.UUID,
    status: str,
    message: str,
    error: str | None,
) -> None:
    with db_factory() as db:
        job = db.get(RenderJob, job_id, with_for_update=True)
        if (
            job is None
            or status not in {"failed", "cancelled"}
            or job.status in ("completed", "failed", "cancelled")
        ):
            return
        transition(job, status, message)
        job.error = error
        db.commit()
