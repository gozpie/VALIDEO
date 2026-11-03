"""API des rendus : création, idempotence, validation, annulation, file Redis, jobs abandonnés."""

import json
import os
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
import redis
from sqlalchemy import insert, update
from sqlalchemy.orm import Session, sessionmaker

from ass_api.core.config import Settings
from ass_api.db.models import RenderJob, WorkspaceMember
from ass_api.render.jobs import RenderQueue, fail_stale_jobs

from .support import (
    ApiClient,
    ClientPool,
    build_app,
    client_pool,
    create_user,
    integration_settings,
)

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        os.environ.get("ASS_RUN_INTEGRATION") != "1", reason="ASS_RUN_INTEGRATION != 1"
    ),
]

SCENE = Path(__file__).resolve().parents[3] / "tests/fixtures/scenes/cube-camera-animated.v2.json"


@pytest.fixture(scope="module")
def queue_settings(api_settings: Settings) -> Settings:
    # File dédiée au module : aucun worker réel ne prend ces jobs.
    return integration_settings(
        api_settings.database_url.get_secret_value(),
        render_queue_key=f"ass:test:{uuid.uuid4().hex[:8]}",
    )


@pytest.fixture
def clients(queue_settings: Settings) -> Any:
    yield from client_pool(build_app(queue_settings))


@pytest.fixture(autouse=True)
def queue(queue_settings: Settings) -> Any:
    client = redis.Redis.from_url(queue_settings.redis_url.get_secret_value())
    for key in client.keys(f"{queue_settings.render_queue_key}*"):
        client.delete(key)
    yield client
    for key in client.keys(f"{queue_settings.render_queue_key}*"):
        client.delete(key)
    client.close()


@pytest.fixture
def alice(clients: ClientPool, db_factory: sessionmaker[Session]) -> ApiClient:
    return clients.login(create_user(db_factory, "Alice"))


@pytest.fixture
def shot(alice: ApiClient) -> dict[str, str]:
    workspace = alice.post("/workspaces", json={"name": "Studio"}).json()["id"]
    project = alice.post(f"/workspaces/{workspace}/projects", json={"name": "P"}).json()["id"]
    sequence = alice.post(f"/projects/{project}/sequences", json={"name": "S"}).json()["id"]
    shot_id = alice.post(
        f"/sequences/{sequence}/shots", json={"name": "Plan", "durationFrames": 96}
    ).json()["id"]
    return {"id": shot_id, "workspace": workspace}


def _save_scene(api: ApiClient, shot_id: str) -> str:
    scene = json.loads(SCENE.read_text(encoding="utf-8"))
    scene["sceneId"] = str(uuid.uuid4())
    scene["references"] = []
    response = api.post(
        f"/shots/{shot_id}/scene/revisions", json={"baseRevisionId": None, "snapshot": scene}
    )
    revision: str = response.json()["revision"]["id"]
    return revision


def test_render_requires_a_saved_revision(alice: ApiClient, shot: dict[str, str]) -> None:
    assert alice.post(f"/shots/{shot['id']}/renders", json={}).status_code == 409


def test_create_render_and_enqueue(
    alice: ApiClient, shot: dict[str, str], queue: Any, queue_settings: Settings
) -> None:
    revision = _save_scene(alice, shot["id"])
    response = alice.post(
        f"/shots/{shot['id']}/renders",
        json={"frameStart": 10, "frameEnd": 20, "resolutionPercent": 25, "samples": 8},
    )
    assert response.status_code == 201, response.text
    job = response.json()
    assert job["status"] == "queued"
    assert job["sceneRevisionId"] == revision
    assert job["settings"] == {
        "frameStart": 10,
        "frameEnd": 20,
        "resolutionPercent": 25,
        "samples": 8,
        "passes": ["alpha", "beauty", "cryptomatte", "depth", "normal", "object_id"],
    }
    assert queue.lrange(queue_settings.render_queue_key, 0, -1) == [job["id"].encode()]
    listed = alice.get(f"/shots/{shot['id']}/renders").json()
    assert [item["id"] for item in listed] == [job["id"]]
    assert alice.get(f"/render-jobs/{job['id']}").json()["status"] == "queued"


def test_defaults_come_from_scene_render_settings(alice: ApiClient, shot: dict[str, str]) -> None:
    _save_scene(alice, shot["id"])
    job = alice.post(f"/shots/{shot['id']}/renders", json={"passes": ["depth"]}).json()
    assert job["settings"]["frameStart"] == 0
    assert job["settings"]["frameEnd"] == 95
    assert job["settings"]["samples"] == 128  # renderSettings.samples de la fixture
    assert job["settings"]["passes"] == ["beauty", "depth"]


@pytest.mark.parametrize(
    "body",
    [
        {"frameStart": 50, "frameEnd": 10},
        {"frameEnd": 96},
        {"resolutionPercent": 0},
        {"passes": ["inconnue"]},
    ],
)
def test_invalid_settings(alice: ApiClient, shot: dict[str, str], body: dict[str, Any]) -> None:
    _save_scene(alice, shot["id"])
    assert alice.post(f"/shots/{shot['id']}/renders", json=body).status_code == 422


def test_idempotency_key(
    alice: ApiClient, shot: dict[str, str], queue: Any, queue_settings: Settings
) -> None:
    _save_scene(alice, shot["id"])
    headers = {"Idempotency-Key": "rendu-1"}
    first = alice.post(f"/shots/{shot['id']}/renders", json={}, headers=headers)
    again = alice.post(f"/shots/{shot['id']}/renders", json={}, headers=headers)
    assert first.status_code == 201
    assert again.status_code == 200
    assert again.json()["id"] == first.json()["id"]
    assert queue.llen(queue_settings.render_queue_key) == 1


def test_cancel(alice: ApiClient, shot: dict[str, str], db_factory: sessionmaker[Session]) -> None:
    _save_scene(alice, shot["id"])
    queued = alice.post(f"/shots/{shot['id']}/renders", json={}).json()
    cancelled = alice.post(f"/render-jobs/{queued['id']}/cancel").json()
    assert cancelled["status"] == "cancelled"
    assert alice.post(f"/render-jobs/{queued['id']}/cancel").status_code == 409

    running = alice.post(f"/shots/{shot['id']}/renders", json={}).json()
    with db_factory() as db:
        db.execute(
            update(RenderJob)
            .where(RenderJob.id == uuid.UUID(running["id"]))
            .values(status="running")
        )
        db.commit()
    requested = alice.post(f"/render-jobs/{running['id']}/cancel").json()
    assert requested["status"] == "running"
    assert requested["message"] == "Annulation demandée"
    with db_factory() as db:
        assert db.get(RenderJob, uuid.UUID(running["id"])).cancel_requested is True  # type: ignore[union-attr]


def test_stale_jobs_fail(
    alice: ApiClient, shot: dict[str, str], db_factory: sessionmaker[Session]
) -> None:
    _save_scene(alice, shot["id"])
    job = alice.post(f"/shots/{shot['id']}/renders", json={}).json()
    with db_factory() as db:
        db.execute(
            update(RenderJob)
            .where(RenderJob.id == uuid.UUID(job["id"]))
            .values(status="running", heartbeat_at=datetime.now(UTC) - timedelta(hours=1))
        )
        db.commit()
        assert fail_stale_jobs(db, timedelta(minutes=5)) >= 1
    failed = alice.get(f"/render-jobs/{job['id']}").json()
    assert failed["status"] == "failed"
    assert "worker" in failed["message"]


def test_roles_and_isolation(
    alice: ApiClient, shot: dict[str, str], clients: ClientPool, db_factory: sessionmaker[Session]
) -> None:
    _save_scene(alice, shot["id"])
    job = alice.post(f"/shots/{shot['id']}/renders", json={}).json()
    viewer_user = create_user(db_factory, "Lectrice")
    with db_factory() as db:
        db.execute(
            insert(WorkspaceMember).values(
                workspace_id=uuid.UUID(shot["workspace"]), user_id=viewer_user.id, role="viewer"
            )
        )
        db.commit()
    viewer = clients.login(viewer_user)
    assert viewer.get(f"/render-jobs/{job['id']}").status_code == 200
    assert viewer.post(f"/shots/{shot['id']}/renders", json={}).status_code == 403
    assert viewer.post(f"/render-jobs/{job['id']}/cancel").status_code == 403
    outsider = clients.login(create_user(db_factory, "Mallory"))
    assert outsider.get(f"/render-jobs/{job['id']}").status_code == 404
    assert outsider.get(f"/shots/{shot['id']}/renders").status_code == 404


def test_queue_is_reliable(queue_settings: Settings) -> None:
    queue = RenderQueue.from_settings(queue_settings)
    try:
        queue.push("a")
        queue.push("b")
        assert queue.pop("w1", 1) == "a"
        assert queue.pending("w1") == ["a"]
        queue.ack("w1", "a")
        assert queue.pending("w1") == []
        assert queue.pop("w1", 1) == "b"
        queue.ack("w1", "b")
        assert queue.pop("w1", 1) is None
    finally:
        queue.close()
