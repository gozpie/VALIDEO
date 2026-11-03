"""Rendu réel de bout en bout par le worker Blender (pile Docker démarrée, ASS_RUN_RENDER=1).

Passe par l'API HTTP réelle : connexion, plan, import GLB, scène animée, rendu, sorties publiées.
"""

import io
import json
import os
import time
import uuid
import zipfile
from pathlib import Path
from typing import Any

import httpx
import pytest

from .exr import exr_channels

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(os.environ.get("ASS_RUN_RENDER") != "1", reason="ASS_RUN_RENDER != 1"),
]

API = os.environ.get("E2E_API_URL", "http://localhost:8000")
FIXTURES = Path(__file__).resolve().parents[3] / "tests/fixtures"


def _node(name: str, **values: Any) -> dict[str, Any]:
    node: dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "name": name,
        "type": "primitive",
        "parentId": None,
        "assetId": None,
        "primitive": "cube",
        "transform": {"position": [0, 0.5, 0], "rotation": [0, 0, 0, 1], "scale": [1, 1, 1]},
        "visible": True,
        "castShadow": True,
        "receiveShadow": True,
        "locked": False,
        "layer": "default",
        "passIndex": 0,
        "renderMode": "final_3d",
        "materialOverrides": [],
    }
    node.update(values)
    return node


def test_render_end_to_end() -> None:
    with httpx.Client(base_url=API, timeout=60) as client:
        login = client.post(
            "/auth/login",
            json={"email": os.environ["E2E_EMAIL"], "password": os.environ["E2E_PASSWORD"]},
        )
        assert login.status_code == 200, login.text
        client.headers["X-CSRF-Token"] = login.json()["csrfToken"]
        # Le cookie est « Secure » : httpx ne le renverrait pas en HTTP local, on le pose à la main.
        client.headers["Cookie"] = f"ass_session={login.cookies['ass_session']}"
        client.cookies.clear()
        workspace = client.post("/workspaces", json={"name": "Rendu E2E"}).json()["id"]
        project = client.post(f"/workspaces/{workspace}/projects", json={"name": "P"}).json()["id"]
        sequence = client.post(f"/projects/{project}/sequences", json={"name": "S"}).json()["id"]
        shot = client.post(
            f"/sequences/{sequence}/shots", json={"name": "Plan", "durationFrames": 24}
        ).json()["id"]
        glb = (FIXTURES / "assets/cube.glb").read_bytes()
        asset = client.post(
            f"/workspaces/{workspace}/assets",
            files={"file": ("cube.glb", glb, "model/gltf-binary")},
        ).json()["asset"]["id"]

        scene = json.loads((FIXTURES / "scenes/empty.v2.json").read_text(encoding="utf-8"))
        scene["sceneId"] = str(uuid.uuid4())
        scene["durationFrames"] = 24
        scene["renderSettings"]["frameEnd"] = 23
        cube = _node("Cube", passIndex=1)
        model = _node(
            "Modèle",
            type="model",
            primitive=None,
            assetId=asset,
            passIndex=2,
            transform={"position": [1.5, 0.5, 0], "rotation": [0, 0, 0, 1], "scale": [1, 1, 1]},
        )
        camera_id = str(uuid.uuid4())
        scene["nodes"] = [cube, model]
        scene["cameras"] = [
            {
                "id": camera_id,
                "name": "Caméra",
                "parentId": None,
                "transform": {
                    "position": [0.75, 1.5, 6],
                    "rotation": [0, 0, 0, 1],
                    "scale": [1, 1, 1],
                },
                "projection": "perspective",
                "focalLengthMm": 35,
                "sensorWidthMm": 36,
                "sensorHeightMm": 24,
                "orthographicHeight": None,
                "nearClip": 0.1,
                "farClip": 100,
                "focusDistance": None,
                "aperture": 2.8,
                "locked": False,
                "lookAtTargetId": cube["id"],
                "rollRadians": 0,
            }
        ]
        scene["activeCameraId"] = camera_id
        scene["animations"] = [
            {
                "id": str(uuid.uuid4()),
                "targetId": cube["id"],
                "propertyPath": "transform.position",
                "valueType": "vec3",
                "extrapolation": "constant",
                "keyframes": [
                    {
                        "frame": 0,
                        "value": [-1, 0.5, 0],
                        "interpolation": "ease_in_out",
                        "inHandle": None,
                        "outHandle": None,
                    },
                    {
                        "frame": 3,
                        "value": [0, 0.5, 0],
                        "interpolation": "linear",
                        "inHandle": None,
                        "outHandle": None,
                    },
                ],
            }
        ]
        saved = client.post(
            f"/shots/{shot}/scene/revisions", json={"baseRevisionId": None, "snapshot": scene}
        )
        assert saved.status_code == 201, saved.text

        job = client.post(
            f"/shots/{shot}/renders",
            json={"frameStart": 0, "frameEnd": 3, "resolutionPercent": 10, "samples": 2},
        ).json()
        deadline = time.monotonic() + 900
        while job["status"] not in ("completed", "failed", "cancelled"):
            assert time.monotonic() < deadline, job
            time.sleep(2)
            job = client.get(f"/render-jobs/{job['id']}").json()
        assert job["status"] == "completed", job
        assert job["progress"] == 1
        assert set(job["outputs"]) == {"video", "passes", "preview", "blend", "frames"}
        # Rendu court (≤ 8 frames) : chaque frame est aussi publiée en PNG (réutilisable par l'IA).
        assert sorted(job["outputs"]["frames"], key=int) == ["0", "1", "2", "3"]
        assert set(job["outputs"]["frames"]["0"]) >= {"beauty"}

        video = client.get(f"/assets/{job['outputs']['video']}/content").content
        assert video[4:8] == b"ftyp"
        preview = client.get(f"/assets/{job['outputs']['preview']}/content").content
        assert preview[:8] == b"\x89PNG\r\n\x1a\n"
        blend = client.get(f"/assets/{job['outputs']['blend']}/content").content
        # .blend compressé (zstd) ou non.
        assert blend[:4] == b"\x28\xb5\x2f\xfd" or blend[:7] == b"BLENDER"
        passes = zipfile.ZipFile(
            io.BytesIO(client.get(f"/assets/{job['outputs']['passes']}/content").content)
        )
        names = sorted(passes.namelist())
        assert names == [f"frame_{i:04d}.exr" for i in range(4)]
        channels = exr_channels(passes.open(names[0]))
        joined = " ".join(channels)
        for expected in (
            "ViewLayer.Combined.A",
            "ViewLayer.Depth.Z",
            "ViewLayer.Normal.X",
            "ViewLayer.IndexOB.X",
            "ViewLayer.CryptoObject00.r",
        ):
            assert expected in joined, channels
