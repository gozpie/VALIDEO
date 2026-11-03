"""Cohérence entre la scène canonique, le moteur et le rendu Blender réel.

Vérifie dans des rendus Cycles : orientation des axes, cadrage et focales (projection d'un objet
comparée au modèle sténopé à capteur horizontal), projection orthographique, hiérarchie et
rotations, interpolation et timing (positions à des frames données, ease compris), import GLB, et
l'évaluation des courbes par Blender (sonde) face au moteur Python.

Exécution : `ASS_BLENDER=docker` (image `ai-scene-studio/render-worker:dev`) ou
`ASS_BLENDER=/chemin/vers/blender`.
"""

import json
import math
import os
import shutil
import subprocess
import tempfile
import uuid
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from ass_api.animation.evaluate import evaluate_frame, translation, world_matrix
from ass_api.animation.math3d import compose
from ass_api.render.prepare import build_description

from .png import alpha_centroid

BLENDER = os.environ.get("ASS_BLENDER")
pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(not BLENDER, reason="ASS_BLENDER non défini (docker ou chemin de Blender)"),
]
ROOT = Path(__file__).resolve().parents[3]
SCRIPT_DIR = ROOT / "workers/render-worker/blender"
IMAGE = os.environ.get("ASS_RENDER_IMAGE", "ai-scene-studio/render-worker:dev")
WIDTH, HEIGHT = 320, 180


@pytest.fixture
def workdir() -> Iterator[Path]:
    # Sous le dossier temporaire du système, partagé avec Docker Desktop sur macOS.
    path = Path(tempfile.mkdtemp(prefix="ass-coherence-", dir="/tmp"))
    yield path
    shutil.rmtree(path, ignore_errors=True)


def run_blender(
    description: dict[str, Any], work: Path, *, render: bool, probe: str | None = None
) -> None:
    (work / "description.json").write_text(json.dumps(description), encoding="utf-8")
    if BLENDER == "docker":
        prefix = [
            "docker",
            "run",
            "--rm",
            "--platform",
            "linux/amd64",
            "-v",
            f"{work}:/work",
            "-v",
            f"{SCRIPT_DIR}:/blender:ro",
            IMAGE,
            "blender",
        ]
        base, script = "/work", "/blender/build_scene.py"
    else:
        prefix, base, script = [str(BLENDER)], str(work), str(SCRIPT_DIR / "build_scene.py")
    args = ["--description", f"{base}/description.json", "--output", f"{base}/out"]
    if render:
        args.append("--render")
    if probe:
        args += ["--probe", probe]
    result = subprocess.run(  # noqa: S603
        [
            *prefix,
            "-b",
            "--factory-startup",
            "--python-exit-code",
            "1",
            "--python",
            script,
            "--",
            *args,
        ],
        capture_output=True,
        text=True,
        check=False,
        timeout=900,
    )
    assert result.returncode == 0, result.stdout[-3000:] + result.stderr[-3000:]


def node(name: str, position: list[float], **values: Any) -> dict[str, Any]:
    entity: dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "name": name,
        "type": "primitive",
        "parentId": None,
        "assetId": None,
        "primitive": "cube",
        "transform": {"position": position, "rotation": [0, 0, 0, 1], "scale": [0.2, 0.2, 0.2]},
        "visible": True,
        "castShadow": False,
        "receiveShadow": False,
        "locked": False,
        "layer": "default",
        "passIndex": 1,
        "renderMode": "final_3d",
        "materialOverrides": [],
    }
    entity.update(values)
    return entity


def camera(focal: float = 50, **values: Any) -> dict[str, Any]:
    entity: dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "name": "Caméra",
        "parentId": None,
        "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0, 1], "scale": [1, 1, 1]},
        "projection": "perspective",
        "focalLengthMm": focal,
        "sensorWidthMm": 36,
        "sensorHeightMm": 24,
        "orthographicHeight": None,
        "nearClip": 0.1,
        "farClip": 100,
        "focusDistance": None,
        "aperture": 2.8,
        "locked": False,
        "lookAtTargetId": None,
        "rollRadians": 0,
    }
    entity.update(values)
    return entity


def scene_of(
    nodes: list[dict[str, Any]],
    cam: dict[str, Any],
    duration: int = 11,
    animations: list[Any] | None = None,
) -> dict[str, Any]:
    return {
        "schemaVersion": 2,
        "sceneId": str(uuid.uuid4()),
        "coordinateSystem": {"handedness": "right", "upAxis": "+Y", "forwardAxis": "-Z"},
        "units": {"length": "meter", "angle": "radian"},
        "fps": {"numerator": 24, "denominator": 1},
        "durationFrames": duration,
        "activeCameraId": cam["id"],
        "markers": [],
        "nodes": nodes,
        "cameras": [cam],
        "lights": [],
        "materials": [],
        "animations": animations or [],
        "references": [],
        "renderSettings": {
            "width": WIDTH,
            "height": HEIGHT,
            "frameStart": 0,
            "frameEnd": duration - 1,
            "samples": 1,
            "transparentBackground": True,
            "motionBlur": False,
            "antiAliasing": "msaa4",
            "colorManagement": {"workingSpace": "linear_rec709", "displayTransform": "srgb"},
        },
    }


def project(scene: dict[str, Any], frame: int, entity_id: str) -> tuple[float, float]:
    """Projection sténopé (capteur horizontal) du centre de l'entité, en pixels (haut gauche)."""
    evaluated = evaluate_frame(scene, frame)
    cam = evaluated["cameras"][0]
    t = cam["transform"]
    cam_world = compose(t["position"], t["rotation"], t["scale"])
    point = translation(world_matrix(evaluated, entity_id))
    # Repère caméra : inverse d'une matrice rotation + translation (échelle 1).
    rel = [point[i] - cam_world[i][3] for i in range(3)]
    local = [sum(cam_world[r][c] * rel[r] for r in range(3)) for c in range(3)]
    if cam["projection"] == "orthographic":
        scale = HEIGHT / cam["orthographicHeight"]
        return WIDTH / 2 + local[0] * scale, HEIGHT / 2 - local[1] * scale
    focal_px = cam["focalLengthMm"] / cam["sensorWidthMm"] * WIDTH
    return WIDTH / 2 + focal_px * local[0] / -local[2], HEIGHT / 2 - focal_px * local[1] / -local[2]


def frame_png(work: Path, frame: int) -> Path:
    return work / "out" / "png" / f"frame_{frame:04d}.png"


def render(scene: dict[str, Any], work: Path, frames: tuple[int, int] | None = None) -> None:
    start, end = frames or (0, scene["durationFrames"] - 1)
    settings = {
        "frameStart": start,
        "frameEnd": end,
        "resolutionPercent": 100,
        "samples": 1,
        "passes": ["beauty"],
    }
    run_blender(build_description(scene, settings, {}), work, render=True)


@pytest.mark.parametrize("focal", [25, 50])
def test_framing_focal_and_axes(workdir: Path, focal: float) -> None:
    right_up = node("Droite-haut", [1, 0.5, -10])
    cam = camera(focal)
    scene = scene_of([right_up], cam, duration=1)
    render(scene, workdir)
    x, y, _n = alpha_centroid(frame_png(workdir, 0))
    ex, ey = project(scene, 0, right_up["id"])
    # +X canonique vers la droite, +Y vers le haut de l'image.
    assert x > WIDTH / 2 and y < HEIGHT / 2
    assert abs(x - ex) < 1.0 and abs(y - ey) < 1.0, ((x, y), (ex, ey))


def test_orthographic_camera(workdir: Path) -> None:
    target = node("Cube", [1.5, -0.5, -10])
    cam = camera(projection="orthographic", orthographicHeight=4)
    scene = scene_of([target], cam, duration=1)
    render(scene, workdir)
    x, y, _n = alpha_centroid(frame_png(workdir, 0))
    ex, ey = project(scene, 0, target["id"])
    assert abs(x - ex) < 1.0 and abs(y - ey) < 1.0, ((x, y), (ex, ey))


def test_hierarchy_and_rotation(workdir: Path) -> None:
    half = math.sqrt(0.5)
    parent = node(
        "Parent",
        [0, 0, -10],
        type="empty",
        primitive=None,
        transform={"position": [0, 0, -10], "rotation": [0, half, 0, half], "scale": [1, 1, 1]},
    )
    child = node("Enfant", [0, 0, 2], parentId=parent["id"])
    scene = scene_of([parent, child], camera(35), duration=1)
    render(scene, workdir)
    x, y, _n = alpha_centroid(frame_png(workdir, 0))
    ex, ey = project(scene, 0, child["id"])
    # Rotation de 90° autour de Y : l'enfant local (0, 0, 2) se retrouve en (2, 0, -10).
    assert ex > WIDTH / 2 + 20
    assert abs(x - ex) < 1.0 and abs(y - ey) < 1.0, ((x, y), (ex, ey))


def test_timing_and_interpolation(workdir: Path) -> None:
    moving = node("Mobile", [0, 0, -10])
    track = {
        "id": str(uuid.uuid4()),
        "targetId": moving["id"],
        "propertyPath": "transform.position",
        "valueType": "vec3",
        "extrapolation": "constant",
        "keyframes": [
            {
                "frame": 0,
                "value": [-2, 0, -10],
                "interpolation": "ease_in_out",
                "inHandle": None,
                "outHandle": None,
            },
            {
                "frame": 10,
                "value": [2, 0.5, -10],
                "interpolation": "linear",
                "inHandle": None,
                "outHandle": None,
            },
        ],
    }
    scene = scene_of([moving], camera(35), duration=11, animations=[track])
    render(scene, workdir, (0, 10))
    for frame in (0, 3, 5, 8, 10):
        x, y, _n = alpha_centroid(frame_png(workdir, frame))
        ex, ey = project(scene, frame, moving["id"])
        assert abs(x - ex) < 1.0 and abs(y - ey) < 1.0, (frame, (x, y), (ex, ey))


def test_glb_model_position(workdir: Path) -> None:
    model = node("Modèle", [-1, -0.5, -8], type="model", primitive=None, assetId=str(uuid.uuid4()))
    scene = scene_of([model], camera(35), duration=1)
    glb = workdir / "cube.glb"
    shutil.copy(ROOT / "tests/fixtures/assets/cube.glb", glb)
    path = "/work/cube.glb" if BLENDER == "docker" else str(glb)
    settings = {
        "frameStart": 0,
        "frameEnd": 0,
        "resolutionPercent": 100,
        "samples": 1,
        "passes": ["beauty"],
    }
    run_blender(build_description(scene, settings, {model["assetId"]: path}), workdir, render=True)
    x, y, _n = alpha_centroid(frame_png(workdir, 0))
    ex, ey = project(scene, 0, model["id"])
    assert abs(x - ex) < 1.0 and abs(y - ey) < 1.0, ((x, y), (ex, ey))


def test_blender_curves_match_engine(workdir: Path) -> None:
    scene = json.loads((ROOT / "tests/fixtures/scenes/look-at.v2.json").read_text(encoding="utf-8"))
    frames = [0, 3, 7, 24, 39, 40, 41, 60, 70, 95]
    settings = {
        "frameStart": 0,
        "frameEnd": 95,
        "resolutionPercent": 10,
        "samples": 1,
        "passes": ["beauty"],
    }
    run_blender(
        build_description(scene, settings, {}),
        workdir,
        render=False,
        probe=",".join(map(str, frames)),
    )
    probe = json.loads((workdir / "out" / "probe.json").read_text(encoding="utf-8"))
    for frame in frames:
        evaluated = evaluate_frame(scene, frame)
        by_id = {e["id"]: e for key in ("nodes", "cameras", "lights") for e in evaluated[key]}
        for entity_id, values in probe[str(frame)].items():
            expected = translation(world_matrix(evaluated, entity_id))
            assert values["world"] == pytest.approx(list(expected), abs=1e-4), (frame, entity_id)
            entity = by_id[entity_id]
            if "lens" in values:
                assert values["lens"] == pytest.approx(entity["focalLengthMm"], abs=1e-4)
            if entity.get("renderMode", "final_3d") != "proxy" and "visible" in entity:
                assert values["hidden"] is (not entity["visible"]), (frame, entity["name"])
