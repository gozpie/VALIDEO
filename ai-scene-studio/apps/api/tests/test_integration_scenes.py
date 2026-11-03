"""Scènes et révisions immuables contre PostgreSQL et S3 réels (ASS_RUN_INTEGRATION=1)."""

import copy
import json
import os
import uuid
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import func, insert, select
from sqlalchemy.orm import Session, sessionmaker

from ass_api.core.config import Settings
from ass_api.core.storage import ObjectStorage
from ass_api.db.models import Scene, SceneRevision, WorkspaceMember

from .support import ApiClient, ClientPool, create_user

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        os.environ.get("ASS_RUN_INTEGRATION") != "1", reason="ASS_RUN_INTEGRATION != 1"
    ),
]

FIXTURE = Path(__file__).resolve().parents[3] / "tests/fixtures/scenes/cube-camera-animated.v1.json"


def _scene() -> dict[str, Any]:
    scene: dict[str, Any] = json.loads(FIXTURE.read_text(encoding="utf-8"))
    scene["sceneId"] = str(uuid.uuid4())
    return scene


@pytest.fixture
def alice(clients: ClientPool, db_factory: sessionmaker[Session]) -> ApiClient:
    return clients.login(create_user(db_factory, "Alice"))


@pytest.fixture
def shot(alice: ApiClient) -> dict[str, str]:
    workspace = alice.post("/workspaces", json={"name": "Studio"}).json()["id"]
    project = alice.post(f"/workspaces/{workspace}/projects", json={"name": "P"}).json()["id"]
    sequence = alice.post(f"/projects/{project}/sequences", json={"name": "S"}).json()["id"]
    created = alice.post(
        f"/sequences/{sequence}/shots", json={"name": "Plan", "durationFrames": 96}
    ).json()
    return {"id": created["id"], "workspace": workspace, "sequence": sequence}


def _save(
    api: ApiClient, shot_id: str, snapshot: dict[str, Any], base: str | None, message: str = ""
) -> Any:
    return api.post(
        f"/shots/{shot_id}/scene/revisions",
        json={"baseRevisionId": base, "message": message, "snapshot": snapshot},
    )


def test_new_shot_has_no_scene(alice: ApiClient, shot: dict[str, str]) -> None:
    state = alice.get(f"/shots/{shot['id']}/scene").json()
    assert state == {"shotId": shot["id"], "sceneId": None, "headRevision": None, "snapshot": None}
    assert alice.get(f"/shots/{shot['id']}/scene/revisions").json() == []


def test_save_reload_and_history(
    alice: ApiClient, shot: dict[str, str], api_settings: Settings
) -> None:
    scene = _scene()
    first = _save(alice, shot["id"], scene, None, "Première version")
    assert first.status_code == 201, first.text
    revision = first.json()["revision"]
    assert first.json()["created"] is True
    assert revision["parentRevisionId"] is None
    assert revision["createdById"] == str(alice.user.id)

    # Rechargement : le snapshot revient à l'identique depuis S3.
    state = alice.get(f"/shots/{shot['id']}/scene").json()
    assert state["sceneId"] == scene["sceneId"]
    assert state["headRevision"]["id"] == revision["id"]
    assert state["snapshot"] == scene

    # Le snapshot est adressé par son empreinte, sous le préfixe du workspace.
    storage = ObjectStorage.from_settings(api_settings)
    assert storage.exists(f"workspaces/{shot['workspace']}/scenes/{revision['snapshotHash']}.json")

    same = _save(alice, shot["id"], copy.deepcopy(scene), revision["id"])
    assert same.status_code == 200
    assert same.json() == {"created": False, "revision": revision}

    scene["nodes"][1]["transform"]["position"] = [2, 0.5, -1]
    second = _save(alice, shot["id"], scene, revision["id"], "Cube déplacé")
    assert second.status_code == 201
    assert second.json()["revision"]["parentRevisionId"] == revision["id"]

    history = alice.get(f"/shots/{shot['id']}/scene/revisions").json()
    assert [item["message"] for item in history] == ["Cube déplacé", "Première version"]
    old = alice.get(f"/scene-revisions/{revision['id']}").json()
    assert old["snapshot"]["nodes"][1]["transform"]["position"] == [0, 0.5, 0]


def test_stale_base_is_a_conflict(alice: ApiClient, shot: dict[str, str]) -> None:
    scene = _scene()
    head = _save(alice, shot["id"], scene, None).json()["revision"]["id"]
    scene["nodes"][1]["name"] = "Autre"
    response = _save(alice, shot["id"], scene, None)
    assert response.status_code == 409
    other = _save(alice, shot["id"], scene, str(uuid.uuid4()))
    assert other.status_code == 409
    assert alice.get(f"/shots/{shot['id']}/scene").json()["headRevision"]["id"] == head


def test_scene_id_is_stable(alice: ApiClient, shot: dict[str, str]) -> None:
    scene = _scene()
    head = _save(alice, shot["id"], scene, None).json()["revision"]["id"]
    scene["sceneId"] = str(uuid.uuid4())
    response = _save(alice, shot["id"], scene, head)
    assert response.status_code == 422
    assert response.json()["errors"][0]["path"] == "snapshot.sceneId"


def test_invalid_scene_is_rejected_with_paths(alice: ApiClient, shot: dict[str, str]) -> None:
    scene = _scene()
    scene["nodes"][1]["parentId"] = str(uuid.uuid4())
    response = _save(alice, shot["id"], scene, None)
    assert response.status_code == 422
    assert response.headers["content-type"].startswith("application/problem+json")
    assert "snapshot.nodes.1.parentId" in [error["path"] for error in response.json()["errors"]]
    assert alice.get(f"/shots/{shot['id']}/scene").json()["sceneId"] is None


def test_non_finite_numbers_are_rejected(alice: ApiClient, shot: dict[str, str]) -> None:
    body = json.dumps({"baseRevisionId": None, "snapshot": _scene()}).replace(
        '"durationFrames": 96', '"durationFrames": NaN'
    )
    response = alice.post(
        f"/shots/{shot['id']}/scene/revisions",
        content=body,
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 422


def test_oversized_body_is_rejected(alice: ApiClient, shot: dict[str, str]) -> None:
    response = alice.post(
        f"/shots/{shot['id']}/scene/revisions",
        content=b"{" + b" " * (6 * 1024 * 1024) + b"}",
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 413


def test_roles_and_isolation(
    alice: ApiClient,
    shot: dict[str, str],
    clients: ClientPool,
    db_factory: sessionmaker[Session],
) -> None:
    revision = _save(alice, shot["id"], _scene(), None).json()["revision"]
    viewer_user = create_user(db_factory, "Lectrice")
    with db_factory() as db:
        db.execute(
            insert(WorkspaceMember).values(
                workspace_id=uuid.UUID(shot["workspace"]), user_id=viewer_user.id, role="viewer"
            )
        )
        db.commit()
    viewer = clients.login(viewer_user)
    assert viewer.get(f"/shots/{shot['id']}/scene").status_code == 200
    assert _save(viewer, shot["id"], _scene(), revision["id"]).status_code == 403

    outsider = clients.login(create_user(db_factory, "Mallory"))
    assert outsider.get(f"/shots/{shot['id']}/scene").status_code == 404
    assert outsider.get(f"/scene-revisions/{revision['id']}").status_code == 404
    assert _save(outsider, shot["id"], _scene(), revision["id"]).status_code == 404


def test_deleting_shot_removes_scene_and_revisions(
    alice: ApiClient, shot: dict[str, str], db_factory: sessionmaker[Session]
) -> None:
    scene = _scene()
    _save(alice, shot["id"], scene, None)
    assert alice.delete(f"/shots/{shot['id']}").status_code == 204
    with db_factory() as db:
        assert db.get(Scene, uuid.UUID(scene["sceneId"])) is None
        remaining = db.scalar(
            select(func.count())
            .select_from(SceneRevision)
            .where(SceneRevision.scene_id == uuid.UUID(scene["sceneId"]))
        )
        assert remaining == 0
