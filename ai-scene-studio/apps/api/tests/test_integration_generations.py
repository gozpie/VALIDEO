"""Générations IA : fournisseurs, estimation, confirmation du coût, exécution simulée, droits."""

import json
import os
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
import redis
from sqlalchemy import insert
from sqlalchemy.orm import Session, sessionmaker

from ass_api.ai.providers.base import ProviderAdapter
from ass_api.ai.providers.simulation import SimulationProvider
from ass_api.ai.registry import build_providers
from ass_api.ai.service import run_generation
from ass_api.ai.worker import availability_key
from ass_api.core.config import Settings
from ass_api.core.storage import ObjectStorage
from ass_api.db.models import GenerationJob, WorkspaceMember
from ass_api.render.jobs import RenderQueue

from .glb_factory import cube_glb
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
def ai_settings(api_settings: Settings) -> Settings:
    prefix = f"ass:test:ai{uuid.uuid4().hex[:6]}"
    return integration_settings(
        api_settings.database_url.get_secret_value(), ai_queue_prefix=prefix
    )


@pytest.fixture
def clients(ai_settings: Settings) -> Any:
    yield from client_pool(build_app(ai_settings))


@pytest.fixture
def broker(ai_settings: Settings) -> Any:
    client = redis.Redis.from_url(ai_settings.redis_url.get_secret_value())
    yield client
    for key in client.keys(f"{ai_settings.ai_queue_prefix}*"):
        client.delete(key)
    client.close()


def _beat(client: Any, settings: Settings, provider: str, available: bool = True) -> None:
    client.set(
        availability_key(settings, provider),
        json.dumps(
            {
                "available": available,
                "reason": "" if available else "Chrome fermé",
                "at": datetime.now(UTC).isoformat(),
            }
        ),
        ex=30,
    )


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
    scene = json.loads(SCENE.read_text(encoding="utf-8"))
    scene["sceneId"] = str(uuid.uuid4())
    scene["references"] = []
    alice.post(
        f"/shots/{shot_id}/scene/revisions", json={"baseRevisionId": None, "snapshot": scene}
    )
    return {"id": shot_id, "workspace": workspace}


IMAGE = {
    "provider": "higgsfield",
    "model": "gpt_image_2_5",
    "mode": "text_to_image",
    "prompt": "a cube",
    "aspectRatio": "16:9",
}


def test_providers_report_worker_availability(
    alice: ApiClient, broker: Any, ai_settings: Settings
) -> None:
    listed = {p["id"]: p for p in alice.get("/ai/providers").json()}
    assert set(listed) == {"simulation", "claude", "higgsfield"}
    assert listed["higgsfield"]["available"] is False
    assert listed["higgsfield"]["kind"] == "bridge"
    assert "Seedance 2.5" in [m["label"] for m in listed["higgsfield"]["models"]]
    _beat(broker, ai_settings, "higgsfield", available=False)
    assert {p["id"]: p for p in alice.get("/ai/providers").json()}["higgsfield"][
        "reason"
    ] == "Chrome fermé"


def test_estimate_and_mismatches(alice: ApiClient, shot: dict[str, str]) -> None:
    estimate = alice.post(
        f"/shots/{shot['id']}/generations/estimate", json={**IMAGE, "sceneFrames": [0]}
    ).json()
    assert estimate["paid"] is True
    assert estimate["amount"] == 3
    assert estimate["unit"] == "crédits Higgsfield"
    ignored = {m["field"] for m in estimate["mismatches"] if m["severity"] == "ignored"}
    # GPT Image ne reçoit pas la profondeur : signalé comme seulement indicatif.
    assert {"controls.depth", "controls.normals", "controls.first_frame"} <= ignored
    video = {
        "provider": "higgsfield",
        "model": "seedance_2_5",
        "mode": "text_to_video",
        "prompt": "x",
        "durationSeconds": 10,
    }
    assert (
        alice.post(f"/shots/{shot['id']}/generations/estimate", json=video).json()["amount"] == 30
    )
    draft_off = {**video, "options": {"draft": False}}
    assert (
        alice.post(f"/shots/{shot['id']}/generations/estimate", json=draft_off).json()["amount"]
        == 120
    )


def test_scene_is_required_only_when_it_conditions(alice: ApiClient) -> None:
    workspace = alice.post("/workspaces", json={"name": "Vide"}).json()["id"]
    project = alice.post(f"/workspaces/{workspace}/projects", json={"name": "P"}).json()["id"]
    sequence = alice.post(f"/projects/{project}/sequences", json={"name": "S"}).json()["id"]
    shot_id = alice.post(
        f"/sequences/{sequence}/shots", json={"name": "Neuf", "durationFrames": 24}
    ).json()["id"]
    estimate = alice.post(f"/shots/{shot_id}/generations/estimate", json=IMAGE)
    assert estimate.status_code == 200
    assert estimate.json()["amount"] == 3
    # Cadrée par la caméra : la scène doit être enregistrée.
    framed = {**IMAGE, "confirmedCost": 3, "sceneFrames": [0]}
    created = alice.post(f"/shots/{shot_id}/generations", json=framed)
    assert created.status_code == 409
    assert "Enregistrez la scène" in created.json()["detail"]
    # Sans la scène 3D (studio : image à partir du découpage), aucune révision n'est requise ;
    # ici le refus vient seulement de l'absence de worker Higgsfield.
    free = alice.post(f"/shots/{shot_id}/generations", json={**IMAGE, "confirmedCost": 3})
    assert free.status_code == 503


def test_paid_generation_requires_exact_cost_confirmation(
    alice: ApiClient, shot: dict[str, str], broker: Any, ai_settings: Settings
) -> None:
    url = f"/shots/{shot['id']}/generations"
    assert alice.post(url, json=IMAGE).status_code == 503  # aucun worker
    _beat(broker, ai_settings, "higgsfield")
    refused = alice.post(url, json=IMAGE)
    assert refused.status_code == 409
    assert "3 crédits Higgsfield" in refused.json()["detail"]
    assert alice.post(url, json={**IMAGE, "confirmedCost": 2}).status_code == 409
    created = alice.post(url, json={**IMAGE, "confirmedCost": 3})
    assert created.status_code == 201, created.text
    job = created.json()
    assert job["status"] == "queued"
    assert job["estimatedCost"] == 3
    assert broker.lrange(f"{ai_settings.ai_queue_prefix}:higgsfield", 0, -1) == [job["id"].encode()]
    assert alice.post(f"/generation-jobs/{job['id']}/cancel").json()["status"] == "cancelled"


def test_blocking_mismatch_is_refused(
    alice: ApiClient, shot: dict[str, str], broker: Any, ai_settings: Settings
) -> None:
    _beat(broker, ai_settings, "higgsfield")
    bad = {
        "provider": "higgsfield",
        "model": "seedance_2_5",
        "mode": "text_to_video",
        "prompt": "x",
        "durationSeconds": 7,
    }
    response = alice.post(f"/shots/{shot['id']}/generations", json={**bad, "confirmedCost": 21})
    assert response.status_code == 422
    assert "Durée" in response.json()["detail"]


def test_simulated_generation_end_to_end(
    alice: ApiClient,
    shot: dict[str, str],
    broker: Any,
    ai_settings: Settings,
    db_factory: sessionmaker[Session],
) -> None:
    _beat(broker, ai_settings, "simulation")
    body = {"provider": "simulation", "model": "image", "mode": "text_to_image", "prompt": "test"}
    job = alice.post(f"/shots/{shot['id']}/generations", json=body).json()
    providers: dict[str, ProviderAdapter] = {"simulation": SimulationProvider("ffmpeg")}
    storage = ObjectStorage.from_settings(ai_settings)
    render_queue = RenderQueue.from_settings(ai_settings)
    try:
        run_generation(
            uuid.UUID(job["id"]), providers, ai_settings, db_factory, storage, render_queue, "test"
        )
    finally:
        render_queue.close()
    done = alice.get(f"/generation-jobs/{job['id']}").json()
    assert done["status"] == "completed", done
    asset_id = done["outputs"]["assets"][0]["assetId"]
    asset = alice.get(f"/assets/{asset_id}").json()
    assert asset["type"] == "image"
    assert asset["metadata"]["aiGenerated"] is True
    assert asset["metadata"]["simulated"] is True
    assert alice.get(f"/assets/{asset_id}/content").content[:8] == b"\x89PNG\r\n\x1a\n"
    with db_factory() as db:
        stored = db.get(GenerationJob, uuid.UUID(job["id"]))
        assert stored is not None and stored.input_manifest_key and stored.output_manifest_key
        manifest = json.loads(storage.get_bytes(stored.input_manifest_key))
    assert manifest["provider"] == "simulation"
    assert "Cube" in manifest["sceneSummary"]


def test_references_must_be_workspace_images(
    alice: ApiClient, shot: dict[str, str], broker: Any, ai_settings: Settings
) -> None:
    _beat(broker, ai_settings, "simulation")
    other = alice.post("/workspaces", json={"name": "Autre"}).json()["id"]
    foreign = alice.post(
        f"/workspaces/{other}/assets", files={"file": ("c.glb", cube_glb(), "model/gltf-binary")}
    ).json()["asset"]["id"]
    body = {
        "provider": "simulation",
        "model": "image",
        "mode": "image_to_image",
        "prompt": "x",
        "referenceAssetIds": [foreign],
    }
    assert alice.post(f"/shots/{shot['id']}/generations", json=body).status_code == 422


def test_roles_and_isolation(
    alice: ApiClient,
    shot: dict[str, str],
    clients: ClientPool,
    db_factory: sessionmaker[Session],
    broker: Any,
    ai_settings: Settings,
) -> None:
    _beat(broker, ai_settings, "simulation")
    body = {"provider": "simulation", "model": "image", "mode": "text_to_image", "prompt": "x"}
    job = alice.post(f"/shots/{shot['id']}/generations", json=body).json()
    viewer_user = create_user(db_factory, "Lectrice")
    with db_factory() as db:
        db.execute(
            insert(WorkspaceMember).values(
                workspace_id=uuid.UUID(shot["workspace"]), user_id=viewer_user.id, role="viewer"
            )
        )
        db.commit()
    viewer = clients.login(viewer_user)
    assert viewer.get(f"/generation-jobs/{job['id']}").status_code == 200
    assert viewer.post(f"/shots/{shot['id']}/generations", json=body).status_code == 403
    outsider = clients.login(create_user(db_factory, "Mallory"))
    assert outsider.get(f"/generation-jobs/{job['id']}").status_code == 404
    assert outsider.get(f"/shots/{shot['id']}/generations").status_code == 404


def test_registry_builds_all_providers(ai_settings: Settings) -> None:
    assert set(build_providers(ai_settings)) == {"simulation", "claude", "higgsfield"}
