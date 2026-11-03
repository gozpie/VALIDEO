"""Studio de production (phase 6) contre la vraie pile : scripts, bible, découpage, versions."""

import json
import os
import uuid
from datetime import UTC, datetime
from typing import Any

import pytest
import redis
from sqlalchemy import insert, update
from sqlalchemy.orm import Session, sessionmaker

from ass_api.ai.providers.base import ProviderAdapter
from ass_api.ai.providers.simulation import SimulationProvider
from ass_api.ai.service import run_generation, studio_documents
from ass_api.ai.worker import availability_key
from ass_api.core.config import Settings
from ass_api.core.storage import ObjectStorage
from ass_api.db.models import Asset, GenerationJob, Project, Shot, WorkspaceMember
from ass_api.render.jobs import RenderQueue

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

SCRIPT = """INT. PHARE — NUIT
Le gardien MARC (60 ans) rallume la lampe. Dehors, la tempête.
LÉA (12 ans) monte l'escalier en colimaçon, une lanterne à la main.
"""
BREAKDOWN = {
    "method": {
        "intention": "Une enfant rejoint son grand-père pour garder la lumière.",
        "dramaturgy": "…",
        "beats": "…",
        "staging": "…",
        "cinematography": "…",
        "draft": "…",
        "qualityControl": "…",
    },
    "sequences": [
        {
            "name": "Le phare dans la tempête",
            "intention": "La lumière tient bon",
            "shots": [
                {
                    "name": "Marc rallume la lampe",
                    "shotSize": "Plan rapproché",
                    "camera": "Hauteur d'œil, 50 mm, fixe",
                    "durationSeconds": 2.5,
                    "description": "**Visuel** : Marc, à gauche du cadre…",
                    "intention": "Le devoir",
                    "dialogue": "",
                    "approach": "image_to_video",
                    "characters": ["Marc"],
                    "sets": ["Lanterne du phare"],
                    "props": [],
                },
                {
                    "name": "Léa dans l'escalier",
                    "shotSize": "Plan large",
                    "camera": "Plongée, 24 mm",
                    "durationSeconds": 4,
                    "description": "Léa monte…",
                    "intention": "Elle vient l'aider",
                    "dialogue": "LÉA : Je suis là !",
                    "approach": "teleportation",
                    "characters": ["léa"],
                    "sets": [],
                    "props": ["Lanterne"],
                },
            ],
        }
    ],
}
BIBLE = {
    "look": {"name": "", "description": "Pellicule 35 mm", "prompt": "Shot on 35mm film."},
    "characters": [
        {"name": "Marc", "description": "Gardien, 60 ans", "prompt": "a 60-year-old keeper"},
        {"name": "Léa", "description": "Sa petite-fille", "prompt": "a 12-year-old girl"},
    ],
    "sets": [{"name": "Lanterne du phare", "description": "Salle vitrée", "prompt": "lantern"}],
    "props": [{"name": "Lanterne", "description": "À pétrole", "prompt": "oil lantern"}],
}


@pytest.fixture(scope="module")
def ai_settings(api_settings: Settings) -> Settings:
    prefix = f"ass:test:studio{uuid.uuid4().hex[:6]}"
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


def _beat(client: Any, settings: Settings, provider: str) -> None:
    client.set(
        availability_key(settings, provider),
        json.dumps({"available": True, "reason": "", "at": datetime.now(UTC).isoformat()}),
        ex=30,
    )


@pytest.fixture
def alice(clients: ClientPool, db_factory: sessionmaker[Session]) -> ApiClient:
    return clients.login(create_user(db_factory, "Alice"))


@pytest.fixture
def project(alice: ApiClient) -> dict[str, str]:
    workspace = alice.post("/workspaces", json={"name": "Studio"}).json()["id"]
    project_id = alice.post(
        f"/workspaces/{workspace}/projects",
        json={"name": "Le phare", "fps": {"numerator": 24, "denominator": 1}},
    ).json()["id"]
    return {"id": project_id, "workspace": workspace}


def _image_asset(db_factory: sessionmaker[Session], workspace: str) -> str:
    with db_factory() as db:
        asset = Asset(
            workspace_id=uuid.UUID(workspace),
            name="ref.png",
            type="image",
            mime_type="image/png",
            size_bytes=10,
            sha256=uuid.uuid4().hex * 2,
            storage_key=f"test/{uuid.uuid4()}.png",
        )
        db.add(asset)
        db.commit()
        return str(asset.id)


def _complete(db_factory: sessionmaker[Session], job_id: str, result: dict[str, Any]) -> None:
    """Simule la réponse de Claude (le vrai appel est couvert par l'E2E avec abonnement)."""
    with db_factory() as db:
        db.execute(
            update(GenerationJob)
            .where(GenerationJob.id == uuid.UUID(job_id))
            .values(status="completed", progress=1, outputs={"assets": [], "result": result})
        )
        db.commit()


def test_scripts_are_immutable_versions(
    alice: ApiClient,
    project: dict[str, str],
    clients: ClientPool,
    db_factory: sessionmaker[Session],
) -> None:
    first = alice.post(f"/projects/{project['id']}/scripts", json={"content": "brief"}).json()
    second = alice.post(
        f"/projects/{project['id']}/scripts", json={"title": "V2", "content": SCRIPT}
    ).json()
    assert (first["version"], second["version"]) == (1, 2)
    listed = alice.get(f"/projects/{project['id']}/scripts").json()
    assert [s["version"] for s in listed] == [2, 1]
    assert "content" not in listed[0]
    assert listed[0]["length"] == len(SCRIPT)
    assert alice.get(f"/scripts/{first['id']}").json()["content"] == "brief"

    viewer_user = create_user(db_factory, "Lectrice")
    with db_factory() as db:
        db.execute(
            insert(WorkspaceMember).values(
                workspace_id=uuid.UUID(project["workspace"]), user_id=viewer_user.id, role="viewer"
            )
        )
        db.commit()
    viewer = clients.login(viewer_user)
    assert viewer.get(f"/scripts/{second['id']}").status_code == 200
    assert (
        viewer.post(f"/projects/{project['id']}/scripts", json={"content": "x"}).status_code == 403
    )
    outsider = clients.login(create_user(db_factory, "Mallory"))
    assert outsider.get(f"/scripts/{second['id']}").status_code == 404


def test_bible_entries_and_images(
    alice: ApiClient, project: dict[str, str], db_factory: sessionmaker[Session]
) -> None:
    url = f"/projects/{project['id']}/bible"
    marc = alice.post(url, json={"kind": "character", "name": "Marc", "prompt": "keeper"}).json()
    alice.post(url, json={"kind": "look", "name": "LOOK", "prompt": "35mm"})
    alice.post(url, json={"kind": "set", "name": "Phare"})
    assert alice.post(url, json={"kind": "character", "name": "marc"}).status_code == 409
    # Ordre : LOOK, personnages, décors, accessoires.
    assert [e["kind"] for e in alice.get(url).json()] == ["look", "character", "set"]

    image = _image_asset(db_factory, project["workspace"])
    patch = {"keyAssetId": image}
    assert alice.patch(f"/bible-entries/{marc['id']}", json=patch).status_code == 422
    added = alice.post(f"/bible-entries/{marc['id']}/images", json={"assetId": image}).json()
    assert added["imageAssetIds"] == [image]
    assert added["keyAssetId"] == image  # première image = image clé
    renamed = alice.patch(f"/bible-entries/{marc['id']}", json={"name": "Marc Le Goff"}).json()
    assert renamed["name"] == "Marc Le Goff"
    assert alice.delete(f"/bible-entries/{marc['id']}").status_code == 204
    assert len(alice.get(url).json()) == 2


def test_breakdown_then_bible_build_the_storyboard(
    alice: ApiClient,
    project: dict[str, str],
    broker: Any,
    ai_settings: Settings,
    db_factory: sessionmaker[Session],
) -> None:
    pid = project["id"]
    claude = {"provider": "claude", "model": "opus", "mode": "script_breakdown"}
    # Pas de découpage sans script.
    assert alice.post(f"/projects/{pid}/generations/estimate", json=claude).status_code == 409
    alice.post(f"/projects/{pid}/scripts", json={"content": SCRIPT})
    estimate = alice.post(f"/projects/{pid}/generations/estimate", json=claude).json()
    assert estimate["paid"] is False
    # Les modes du projet ne se lancent pas depuis un plan, et inversement.
    image = {"provider": "simulation", "model": "image", "mode": "text_to_image", "prompt": "x"}
    assert alice.post(f"/projects/{pid}/generations", json=image).status_code == 422

    _beat(broker, ai_settings, "claude")
    job = alice.post(f"/projects/{pid}/generations", json=claude).json()
    assert job["shotId"] is None and job["projectId"] == pid
    assert alice.get(f"/projects/{pid}/generations").json()[0]["id"] == job["id"]
    assert (
        alice.post(f"/projects/{pid}/breakdown/apply", json={"jobId": job["id"]}).status_code == 409
    )  # pas encore terminé
    _complete(db_factory, job["id"], BREAKDOWN)
    board = alice.post(f"/projects/{pid}/breakdown/apply", json={"jobId": job["id"]}).json()
    assert [s["name"] for s in board] == ["Le phare dans la tempête"]
    first, second = board[0]["shots"]
    assert first["name"] == "Marc rallume la lampe"
    assert first["durationFrames"] == 60  # 2,5 s à 24 i/s
    assert first["shotSize"] == "Plan rapproché"
    assert second["approach"] == "image_to_video"  # valeur inconnue remplacée
    assert second["dialogue"] == "LÉA : Je suis là !"
    assert first["bibleEntryIds"] == []  # bible encore vide
    assert (
        alice.post(f"/projects/{pid}/breakdown/apply", json={"jobId": job["id"]}).status_code == 409
    )  # déjà appliqué

    bible_job = alice.post(
        f"/projects/{pid}/generations", json={**claude, "mode": "bible_from_script"}
    ).json()
    _complete(db_factory, bible_job["id"], BIBLE)
    alice.post(f"/projects/{pid}/bible", json={"kind": "character", "name": "Marc"})
    entries = alice.post(f"/projects/{pid}/bible/apply", json={"jobId": bible_job["id"]}).json()
    names = [(e["kind"], e["name"]) for e in entries]
    assert ("look", "LOOK du film") in names
    assert names.count(("character", "Marc")) == 1  # existant conservé, pas de doublon
    assert ("prop", "Lanterne") in names
    by_name = {e["name"]: e["id"] for e in entries}
    board = alice.get(f"/projects/{pid}/storyboard").json()
    first, second = board[0]["shots"]
    # Les plans retrouvent leurs éléments par leur nom (casse ignorée).
    assert set(first["bibleEntryIds"]) == {by_name["Marc"], by_name["Lanterne du phare"]}
    assert set(second["bibleEntryIds"]) == {by_name["Léa"], by_name["Lanterne"]}

    # Documents transmis à Claude pour écrire les prompts d'un plan.
    with db_factory() as db:
        shot = db.get(Shot, uuid.UUID(first["id"]))
        proj = db.get(Project, uuid.UUID(pid))
        assert shot is not None and proj is not None
        prompt_job = GenerationJob(mode="shot_prompts", request={})
        documents = studio_documents(db, prompt_job, proj, shot)
    assert set(documents) == {"script.md", "bible.md", "plan.md"}
    assert "Marc rallume la lampe" in documents["plan.md"]
    assert "Plan suivant : « Léa dans l'escalier »" in documents["plan.md"]
    assert "Shot on 35mm film." in documents["plan.md"]
    assert "## Personnages" in documents["bible.md"]


def test_shot_versions_tree_and_selection(
    alice: ApiClient,
    project: dict[str, str],
    broker: Any,
    ai_settings: Settings,
    db_factory: sessionmaker[Session],
) -> None:
    pid = project["id"]
    sequence = alice.post(f"/projects/{pid}/sequences", json={"name": "S"}).json()["id"]
    shot = alice.post(
        f"/sequences/{sequence}/shots",
        json={"name": "Plan", "durationFrames": 48, "description": "Un phare", "status": "todo"},
    ).json()
    entry = alice.post(f"/projects/{pid}/bible", json={"kind": "character", "name": "Marc"}).json()
    key = _image_asset(db_factory, project["workspace"])
    alice.post(f"/bible-entries/{entry['id']}/images", json={"assetId": key})
    patched = alice.patch(
        f"/shots/{shot['id']}",
        json={"bibleEntryIds": [entry["id"]], "imagePrompt": "LOOK…", "camera": "50 mm"},
    ).json()
    assert patched["bibleEntryIds"] == [entry["id"]]
    assert patched["imagePrompt"] == "LOOK…"
    foreign = str(uuid.uuid4())
    assert alice.patch(f"/shots/{shot['id']}", json={"bibleEntryIds": [foreign]}).status_code == 422

    # Génération simulée SANS scène 3D, avec les images clés de la bible en références.
    _beat(broker, ai_settings, "simulation")
    body = {
        "provider": "simulation",
        "model": "image",
        "mode": "text_to_image",
        "prompt": "Marc",
        "bibleReferences": True,
    }
    job = alice.post(f"/shots/{shot['id']}/generations", json=body).json()
    assert job["sceneRevisionId"] is None
    assert job["request"]["referenceAssetIds"] == [key]
    # La référence de test n'a pas de contenu : on l'enlève avant l'exécution simulée.
    with db_factory() as db:
        stored = db.get(GenerationJob, uuid.UUID(job["id"]))
        assert stored is not None
        stored.request = {**stored.request, "referenceAssetIds": []}
        db.commit()
    providers: dict[str, ProviderAdapter] = {"simulation": SimulationProvider("ffmpeg")}
    storage = ObjectStorage.from_settings(ai_settings)
    queue = RenderQueue.from_settings(ai_settings)

    def run(job_id: str) -> dict[str, Any]:
        run_generation(uuid.UUID(job_id), providers, ai_settings, db_factory, storage, queue, "t")
        done: dict[str, Any] = alice.get(f"/generation-jobs/{job_id}").json()
        assert done["status"] == "completed", done
        return done

    try:
        first = run(job["id"])
        versions = alice.get(f"/shots/{shot['id']}/versions").json()
        assert [v["number"] for v in versions] == [1]
        assert versions[0]["kind"] == "image"
        assert versions[0]["generationJobId"] == job["id"]
        assert first["outputs"]["versionIds"] == [versions[0]["id"]]
        assert alice.get(f"/shots/{shot['id']}").json()["status"] == "in_progress"

        # Nouvelle version qui repart de la première (arbre).
        child = alice.post(
            f"/shots/{shot['id']}/generations",
            json={**body, "bibleReferences": False, "parentVersionId": versions[0]["id"]},
        ).json()
        run(child["id"])
        versions = alice.get(f"/shots/{shot['id']}/versions").json()
        assert [v["number"] for v in versions] == [2, 1]
        assert versions[0]["parentId"] == versions[1]["id"]

        # Image d'un élément de bible générée au niveau du projet.
        bible_image = alice.post(
            f"/projects/{pid}/generations",
            json={**body, "bibleReferences": False, "bibleEntryId": entry["id"]},
        ).json()
        run(bible_image["id"])
        images = alice.get(f"/projects/{pid}/bible").json()[0]["imageAssetIds"]
        assert len(images) == 2 and images[0] == key
    finally:
        queue.close()

    selected = alice.patch(
        f"/shots/{shot['id']}", json={"selectedVersionId": versions[1]["id"]}
    ).json()
    assert selected["selectedVersionId"] == versions[1]["id"]
    board = alice.get(f"/projects/{pid}/storyboard").json()
    card = board[0]["shots"][0]
    assert card["selectedVersion"]["number"] == 1
    assert card["versionCount"] == 2
    assert (
        alice.patch(f"/shot-versions/{versions[0]['id']}", json={"note": "B"}).json()["note"] == "B"
    )
    # La galerie du workspace montre une affiche (première image de plan) et l'avancement.
    listed = alice.get(f"/workspaces/{project['workspace']}/projects").json()["items"]
    assert listed[0]["shotCount"] == 1
    assert listed[0]["approvedCount"] == 0
    assert listed[0]["posterAssetId"] == versions[0]["assetId"]
    other = alice.post(f"/sequences/{sequence}/shots", json={"name": "P2", "durationFrames": 1})
    assert (
        alice.patch(
            f"/shots/{other.json()['id']}", json={"selectedVersionId": versions[0]["id"]}
        ).status_code
        == 422
    )
