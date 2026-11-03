"""Pont vers gozCut (monteur Mac natif) : le montage du projet devient un projet gozCut.

gozCut range ses projets dans ~/Movies/gozCut/<nom>/ (`project.json` et `Media/`). Ce pont écrit un
NOUVEAU dossier, jamais un projet existant, et ne modifie pas gozCut. gozCut ne monte que des
vidéos : une image retenue devient un clip de la durée du plan, un plan sans version un clip noir
qui garde sa place. Ce n'est pas une génération IA : le fournisseur n'apparaît que pour ce mode.
"""

import json
import re
import shutil
import subprocess
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Final

from ass_api.ai.capabilities import GenerationRequest, ModelCapabilities
from ass_api.ai.providers.base import (
    CostEstimate,
    ProviderAdapter,
    ProviderError,
    ProviderOutput,
    RunContext,
)

TICKS_PER_SECOND: Final = 60_000
FORMATS: Final = {"16:9": 16 / 9, "9:16": 9 / 16, "1:1": 1.0, "4:5": 4 / 5}


def safe_name(value: str) -> str:
    """Nom de fichier lisible : sans séparateur de chemin ni caractère de contrôle."""
    cleaned = re.sub(r'[/\\:*?"<>|\x00-\x1f]+', " ", value).strip(" .")
    return re.sub(r"\s+", " ", cleaned)[:120] or "Sans titre"


def unique_folder(root: Path, base: str) -> Path:
    candidate = root / base
    number = 2
    while candidate.exists():
        candidate = root / f"{base} {number}"
        number += 1
    return candidate


def canvas_format(width: int, height: int) -> str:
    ratio = width / height if height else 16 / 9
    return min(FORMATS, key=lambda name: abs(FORMATS[name] - ratio))


class GozCutBridgeProvider(ProviderAdapter):
    id = "gozcut"
    label = "gozCut (monteur Mac)"
    kind = "tool"

    def __init__(
        self,
        ffmpeg: str,
        projects_dir: str,
        app_path: str,
        *,
        open_app: bool = True,
    ) -> None:
        self._ffmpeg = ffmpeg
        self._root = Path(projects_dir).expanduser()
        self._app = Path(app_path).expanduser()
        self._open_app = open_app
        self._results: dict[str, list[ProviderOutput]] = {}

    def availability(self) -> tuple[bool, str]:
        if not shutil.which(self._ffmpeg):
            return False, "FFmpeg introuvable sur ce worker"
        if self._open_app and not self._app.exists():
            return False, f"gozCut introuvable ({self._app})"
        return True, ""

    def get_capabilities(self) -> list[ModelCapabilities]:
        return [
            ModelCapabilities(
                provider=self.id,
                model="project",
                label="gozCut",
                modes=("gozcut_project",),
                notes="Crée un nouveau projet gozCut avec les plans du film.",
            )
        ]

    def estimate_cost(self, model: str, request: GenerationRequest) -> CostEstimate:
        return CostEstimate(0, "", "Aucun coût : traitement local sur le Mac", paid=False)

    def _run(self, args: list[str]) -> None:
        result = subprocess.run(  # noqa: S603 (arguments construits ici)
            [self._ffmpeg, "-hide_banner", "-loglevel", "error", "-y", *args],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            raise ProviderError("unknown", "Échec de FFmpeg", detail=result.stderr[-500:])

    def _probe(self, path: Path) -> dict[str, Any]:
        ffprobe = str(Path(shutil.which(self._ffmpeg) or self._ffmpeg).with_name("ffprobe"))
        result = subprocess.run(  # noqa: S603 (arguments construits ici)
            [ffprobe, "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            raise ProviderError("unknown", "Média illisible", detail=result.stderr[-500:])
        data = json.loads(result.stdout)
        video = next(s for s in data["streams"] if s["codec_type"] == "video")
        numerator, _, denominator = str(video.get("avg_frame_rate", "24/1")).partition("/")
        fps = float(numerator) / float(denominator or 1) if float(denominator or 1) else 24.0
        return {
            "seconds": float(data["format"]["duration"]),
            "width": int(video["width"]),
            "height": int(video["height"]),
            "fps": fps,
            "audio": any(s["codec_type"] == "audio" for s in data["streams"]),
        }

    def _still(self, source: Path, target: Path, seconds: float, plan: dict[str, Any]) -> None:
        size = f"{plan['width']}:{plan['height']}"
        self._run(
            [
                "-loop",
                "1",
                "-i",
                str(source),
                "-t",
                f"{seconds:.3f}",
                "-r",
                str(round(plan["fps"])),
                "-vf",
                f"scale={size}:force_original_aspect_ratio=decrease,"
                f"pad={size}:(ow-iw)/2:(oh-ih)/2,format=yuv420p",
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                str(target),
            ]
        )

    def _black(self, target: Path, seconds: float, plan: dict[str, Any]) -> None:
        self._run(
            [
                "-f",
                "lavfi",
                "-i",
                f"color=c=black:s={plan['width']}x{plan['height']}:r={round(plan['fps'])}",
                "-t",
                f"{seconds:.3f}",
                "-pix_fmt",
                "yuv420p",
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                str(target),
            ]
        )

    def submit_generation(self, model: str, request: GenerationRequest, context: RunContext) -> str:
        available, reason = self.availability()
        if not available:
            raise ProviderError("provider_unavailable", reason)
        if context.fetch_asset is None or "edit.json" not in context.documents:
            raise ProviderError("invalid_request", "Liste de montage absente")
        plan = json.loads(context.documents["edit.json"])
        if not plan["items"]:
            raise ProviderError("invalid_request", "Le storyboard est vide")
        stamp = datetime.now(UTC).astimezone().strftime("%Y-%m-%d %Hh%M")
        folder = unique_folder(self._root, safe_name(f"{plan['project']} — Chagomi {stamp}"))
        media_folder = folder / "Media"
        media_folder.mkdir(parents=True)
        now = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
        media: list[dict[str, Any]] = []
        clips: list[dict[str, Any]] = []
        missing: list[str] = []
        start = 0
        total = len(plan["items"])
        for index, item in enumerate(plan["items"]):
            if context.progress(
                0.05 + 0.85 * index / total, f"Plan {item['label']} : {item['name']}"
            ):
                shutil.rmtree(folder, ignore_errors=True)
                raise ProviderError("cancelled", "Génération annulée")
            name = safe_name(f"{item['label']} {item['name']}")
            target = media_folder / f"{name}.mp4"
            seconds = float(item["seconds"])
            source = item["media"]
            if source is None:
                missing.append(f"{item['label']} {item['name']}")
                self._black(target, seconds, plan)
            elif source["kind"] == "video":
                context.fetch_asset(source["assetId"], target)
            else:
                still = media_folder / f".{name}.source"
                context.fetch_asset(source["assetId"], still)
                self._still(still, target, seconds, plan)
                still.unlink()
            info = self._probe(target)
            media_id = str(uuid.uuid4()).upper()
            media.append(
                {
                    "id": media_id,
                    "name": name,
                    "fileName": target.name,
                    "kind": "video",
                    "duration": round(info["seconds"] * TICKS_PER_SECOND),
                    "width": info["width"],
                    "height": info["height"],
                    "fps": info["fps"],
                    "hasAudio": info["audio"],
                    "importedAt": now,
                    "origin": "Chagomi",
                }
            )
            # La durée du montage suit le plan, sans dépasser ce que le fichier contient.
            duration = round(min(seconds, info["seconds"]) * TICKS_PER_SECOND)
            clips.append(
                {
                    "id": str(uuid.uuid4()).upper(),
                    "mediaID": media_id,
                    "start": start,
                    "duration": duration,
                    "sourceIn": 0,
                }
            )
            start += duration
        project = {
            "id": str(uuid.uuid4()).upper(),
            "name": folder.name,
            "created": now,
            "modified": now,
            "media": media,
            "settings": {
                "format": canvas_format(plan["width"], plan["height"]),
                "fps": round(plan["fps"]),
                "background": {"r": 0, "g": 0, "b": 0, "a": 1},
            },
            "timeline": {
                "tracks": [
                    {
                        "id": str(uuid.uuid4()).upper(),
                        "kind": "video",
                        "isMain": True,
                        "hidden": False,
                        "muted": False,
                        "clips": clips,
                    },
                    {
                        "id": str(uuid.uuid4()).upper(),
                        "kind": "audio",
                        "isMain": False,
                        "hidden": False,
                        "muted": False,
                        "clips": [],
                    },
                ]
            },
        }
        (folder / "project.json").write_text(
            json.dumps(project, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        opened = False
        if self._open_app:
            # Nouvelle instance sur ce nouveau projet : un projet ouvert ailleurs n'est pas touché.
            result = subprocess.run(  # noqa: S603 (commande macOS fixe)
                ["/usr/bin/open", "-n", "-a", str(self._app), "--args", "--open", str(folder)],
                capture_output=True,
                text=True,
                check=False,
            )
            opened = result.returncode == 0
        external_id = f"gozcut-{uuid.uuid4().hex[:12]}"
        self._results[external_id] = [
            ProviderOutput(
                "json",
                data={
                    "folder": str(folder),
                    "name": folder.name,
                    "clips": len(clips),
                    "seconds": start / TICKS_PER_SECOND,
                    "missing": missing,
                    "opened": opened,
                },
            )
        ]
        return external_id

    def retrieve_outputs(self, external_id: str, context: RunContext) -> list[ProviderOutput]:
        return self._results.pop(external_id)
