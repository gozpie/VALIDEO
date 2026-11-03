"""Assets GLB : envoi validé, déduplication, contenu, droits, références depuis les scènes."""

import hashlib
import json
import os
import uuid
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import insert
from sqlalchemy.orm import Session, sessionmaker

from ass_api.core.config import Settings
from ass_api.db.models import WorkspaceMember

from .glb_factory import build_glb, cube_glb
from .support import ApiClient, ClientPool, build_app, create_user

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        os.environ.get("ASS_RUN_INTEGRATION") != "1", reason="ASS_RUN_INTEGRATION != 1"
    ),
]

SCENE = Path(__file__).resolve().parents[3] / "tests/fixtures/scenes/empty.v2.json"


@pytest.fixture
def alice(clients: ClientPool, db_factory: sessionmaker[Session]) -> ApiClient:
    return clients.login(create_user(db_factory, "Alice"))


@pytest.fixture
def workspace(alice: ApiClient) -> str:
    identifier: str = alice.post("/workspaces", json={"name": "Studio"}).json()["id"]
    return identifier


def _upload(api: ApiClient, workspace: str, data: bytes, filename: str = "cube.glb") -> Any:
    return api.post(
        f"/workspaces/{workspace}/assets",
        files={"file": (filename, data, "model/gltf-binary")},
    )


def test_upload_list_and_content(alice: ApiClient, workspace: str) -> None:
    data = cube_glb()
    response = _upload(alice, workspace, data, "../../etc/passwd.glb")
    assert response.status_code == 201, response.text
    asset = response.json()["asset"]
    assert asset["type"] == "model"
    assert asset["sha256"] == hashlib.sha256(data).hexdigest()
    assert asset["sizeBytes"] == len(data)
    assert asset["metadata"]["meshCount"] == 1
    # Le nom n'est qu'un libellé : il n'influence pas le stockage.
    assert asset["name"] == "../../etc/passwd.glb"

    listed = alice.get(f"/workspaces/{workspace}/assets", params={"type": "model"}).json()
    assert [item["id"] for item in listed["items"]] == [asset["id"]]

    content = alice.get(f"/assets/{asset['id']}/content")
    assert content.status_code == 200
    assert content.content == data
    assert content.headers["content-type"] == "model/gltf-binary"
    assert "private" in content.headers["cache-control"]


def test_same_content_is_deduplicated(alice: ApiClient, workspace: str) -> None:
    first = _upload(alice, workspace, cube_glb()).json()["asset"]
    again = _upload(alice, workspace, cube_glb(), "copie.glb")
    assert again.status_code == 200
    assert again.json() == {"created": False, "asset": first}
    other = _upload(alice, workspace, cube_glb(color=(0, 1, 0, 1)))
    assert other.status_code == 201


@pytest.mark.parametrize(
    "data",
    [
        b"",
        b"not a glb at all, just text",
        build_glb({"asset": {"version": "2.0"}, "buffers": [{"uri": "http://169.254.169.254/"}]}),
    ],
)
def test_invalid_files_are_refused(alice: ApiClient, workspace: str, data: bytes) -> None:
    response = _upload(alice, workspace, data)
    assert response.status_code == 422
    assert alice.get(f"/workspaces/{workspace}/assets").json()["items"] == []


def test_size_limit(
    database_url: str, api_settings: Settings, db_factory: sessionmaker[Session]
) -> None:
    small = Settings(**{**api_settings.model_dump(), "asset_max_bytes": 1024})
    user = create_user(db_factory, "Limité")
    with TestClient(build_app(small)) as client:
        login = client.post(
            "/auth/login", json={"email": user.email, "password": "un mot de passe assez long"}
        )
        csrf = {"X-CSRF-Token": login.json()["csrfToken"]}
        workspace = client.post("/workspaces", json={"name": "W"}, headers=csrf).json()["id"]
        # Sous le plafond global (corps + 1 Mo) mais au-delà de la limite d'asset.
        too_big = client.post(
            f"/workspaces/{workspace}/assets",
            files={"file": ("big.glb", b"\0" * 4096, "model/gltf-binary")},
            headers=csrf,
        )
        assert too_big.status_code == 413
        # Au-delà du plafond global : refusé avant toute lecture par l'application.
        huge = client.post(
            f"/workspaces/{workspace}/assets",
            content=b"\0" * (2 * 1024 * 1024),
            headers={**csrf, "Content-Type": "multipart/form-data; boundary=x"},
        )
        assert huge.status_code == 413


def test_roles_and_isolation(
    alice: ApiClient, workspace: str, clients: ClientPool, db_factory: sessionmaker[Session]
) -> None:
    asset = _upload(alice, workspace, cube_glb()).json()["asset"]
    viewer_user = create_user(db_factory, "Lectrice")
    with db_factory() as db:
        db.execute(
            insert(WorkspaceMember).values(
                workspace_id=uuid.UUID(workspace), user_id=viewer_user.id, role="viewer"
            )
        )
        db.commit()
    viewer = clients.login(viewer_user)
    assert viewer.get(f"/assets/{asset['id']}/content").status_code == 200
    assert _upload(viewer, workspace, cube_glb(color=(0, 0, 1, 1))).status_code == 403

    outsider = clients.login(create_user(db_factory, "Mallory"))
    assert outsider.get(f"/assets/{asset['id']}").status_code == 404
    assert outsider.get(f"/assets/{asset['id']}/content").status_code == 404
    assert outsider.get(f"/workspaces/{workspace}/assets").status_code == 404
    assert clients.anonymous().get(f"/assets/{asset['id']}/content").status_code == 401


@pytest.fixture
def shot_of(alice: ApiClient) -> Iterator[Any]:
    def make(workspace: str) -> str:
        project = alice.post(f"/workspaces/{workspace}/projects", json={"name": "P"}).json()["id"]
        sequence = alice.post(f"/projects/{project}/sequences", json={"name": "S"}).json()["id"]
        shot: str = alice.post(
            f"/sequences/{sequence}/shots", json={"name": "Plan", "durationFrames": 48}
        ).json()["id"]
        return shot

    yield make


def _model_scene(asset_id: str) -> dict[str, Any]:
    scene: dict[str, Any] = json.loads(SCENE.read_text(encoding="utf-8"))
    scene["sceneId"] = str(uuid.uuid4())
    scene["nodes"] = [
        {
            "id": str(uuid.uuid4()),
            "name": "Modèle",
            "type": "model",
            "parentId": None,
            "assetId": asset_id,
            "primitive": None,
            "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0, 1], "scale": [1, 1, 1]},
            "visible": True,
            "castShadow": True,
            "receiveShadow": True,
            "locked": False,
            "layer": "default",
            "passIndex": 0,
            "renderMode": "final_3d",
            "materialOverrides": [],
        }
    ]
    return scene


def test_scene_may_only_reference_its_workspace_assets(
    alice: ApiClient, workspace: str, shot_of: Any
) -> None:
    mine = _upload(alice, workspace, cube_glb()).json()["asset"]["id"]
    other_workspace = alice.post("/workspaces", json={"name": "Autre"}).json()["id"]
    foreign = _upload(alice, other_workspace, cube_glb(color=(1, 1, 0, 1))).json()["asset"]["id"]
    shot = shot_of(workspace)
    url = f"/shots/{shot}/scene/revisions"

    refused = alice.post(url, json={"baseRevisionId": None, "snapshot": _model_scene(foreign)})
    assert refused.status_code == 422
    assert refused.json()["errors"][0]["path"] == "snapshot.nodes.0.assetId"
    unknown = alice.post(
        url, json={"baseRevisionId": None, "snapshot": _model_scene(str(uuid.uuid4()))}
    )
    assert unknown.status_code == 422

    accepted = alice.post(url, json={"baseRevisionId": None, "snapshot": _model_scene(mine)})
    assert accepted.status_code == 201, accepted.text
