"""Image d'un plan pour bâtir son plateau : la première image, et la même graduée en pixels."""

import json
import shutil
import subprocess
from pathlib import Path

from ass_api.ai.providers.base import ProviderError

LARGEUR = 1280
POLICE = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")


def _ffmpeg(ffmpeg: str, source: Path, target: Path, filtre: str) -> None:
    result = subprocess.run(  # noqa: S603 (arguments construits ici)
        [
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(source),
            "-frames:v",
            "1",
            "-vf",
            filtre,
            str(target),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0 or not target.exists():
        raise ProviderError(
            "invalid_request",
            "Impossible de lire l'image de cette version",
            detail=result.stderr[-300:],
        )


def first_frame(ffmpeg: str, source: Path, target: Path) -> Path:
    """Première image d'une vidéo ou image fixe, en PNG, réduite pour rester lisible et légère."""
    _ffmpeg(ffmpeg, source, target, f"scale='min({LARGEUR},iw)':-2")
    return target


def image_size(ffmpeg: str, image: Path) -> tuple[int, int]:
    ffprobe = str(Path(shutil.which(ffmpeg) or ffmpeg).with_name("ffprobe"))
    result = subprocess.run(  # noqa: S603 (arguments construits ici)
        [
            ffprobe,
            "-v",
            "error",
            "-select_streams",
            "v",
            "-show_entries",
            "stream=width,height",
            "-of",
            "json",
            str(image),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    try:
        stream = json.loads(result.stdout)["streams"][0]
        return int(stream["width"]), int(stream["height"])
    except (KeyError, IndexError, ValueError) as exc:
        raise ProviderError("invalid_request", "Cette image est illisible") from exc


def graduated_image(ffmpeg: str, image: Path, target: Path, size: tuple[int, int]) -> Path:
    """L'image avec une grille tous les 50 pixels (appuyée tous les 100), et ses graduations."""
    filtres = [
        "drawgrid=w=50:h=50:t=1:c=cyan@0.25",
        "drawgrid=w=100:h=100:t=1:c=cyan@0.8",
    ]
    if POLICE.exists():
        style = f"fontfile={POLICE}:fontsize=13:fontcolor=white:box=1:boxcolor=black@0.7"
        filtres += [f"drawtext={style}:text={x}:x={x + 2}:y=2" for x in range(100, size[0], 100)]
        filtres += [f"drawtext={style}:text={y}:x=2:y={y + 2}" for y in range(100, size[1], 100)]
    _ffmpeg(ffmpeg, image, target, ",".join(filtres))
    return target
