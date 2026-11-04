"""Montage enregistré côté serveur (phase 7.2) contre la vraie pile."""

import os
import uuid
from typing import Any

import pytest
from sqlalchemy.orm import Session, sessionmaker

from ass_api.db.models import WorkspaceMember

from .support import ApiClient, ClientPool, create_user

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        os.environ.get("ASS_RUN_INTEGRATION") != "1", reason="ASS_RUN_INTEGRATION != 1"
    ),
]

PNG = b"\x89PNG\r\n\x1a\n" + b"\0" * 64
WAV = b"RIFF\x24\0\0\0WAVEfmt " + b"\0" * 64
DOCUMENT = {"schemaVersion": 1, "name": "Le phare", "sequences": [{"id": "s", "tracks": []}]}
LINKS = {"media": {"m1": {"assetId": str(uuid.uuid4()), "shotId": None}}, "shots": {}}


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


def _member(
    clients: ClientPool,
    db_factory: sessionmaker[Session],
    project: dict[str, str],
    role: str,
) -> ApiClient:
    user = create_user(db_factory, role.capitalize())
    with db_factory() as db:
        db.add(
            WorkspaceMember(
                workspace_id=uuid.UUID(project["workspace"]), user_id=user.id, role=role
            )
        )
        db.commit()
    return clients.login(user)


def test_edit_starts_empty_then_round_trips_untouched(
    alice: ApiClient, project: dict[str, str]
) -> None:
    url = f"/projects/{project['id']}/edit"
    empty = alice.get(url).json()
    assert empty == {"document": None, "links": {}, "revision": 0, "updatedAt": None}

    saved = alice.put(url, json={"document": DOCUMENT, "links": LINKS, "expectedRevision": 0})
    assert saved.status_code == 200
    assert saved.json()["revision"] == 1

    # Le document appartient au moteur : ses clés ne sont ni renommées ni filtrées.
    loaded = alice.get(url).json()
    assert loaded["document"] == DOCUMENT
    assert loaded["links"] == LINKS
    assert loaded["revision"] == 1


def test_edit_refuses_to_overwrite_a_newer_revision(
    alice: ApiClient, project: dict[str, str]
) -> None:
    url = f"/projects/{project['id']}/edit"
    alice.put(url, json={"document": DOCUMENT, "links": {}, "expectedRevision": 0})
    second = {**DOCUMENT, "name": "Deuxième onglet"}
    assert (
        alice.put(url, json={"document": second, "links": {}, "expectedRevision": 1}).status_code
        == 200
    )
    stale = alice.put(url, json={"document": DOCUMENT, "links": {}, "expectedRevision": 1})
    assert stale.status_code == 409
    assert alice.get(url).json()["document"]["name"] == "Deuxième onglet"
    fresh = alice.put(url, json={"document": DOCUMENT, "links": {}, "expectedRevision": 0})
    assert fresh.status_code == 409


def test_edit_rejects_a_document_too_large(alice: ApiClient, project: dict[str, str]) -> None:
    url = f"/projects/{project['id']}/edit"
    huge: dict[str, Any] = {"name": "x" * (8 * 1024 * 1024 + 1)}
    response = alice.put(url, json={"document": huge, "links": {}, "expectedRevision": 0})
    assert response.status_code == 413


def test_edit_permissions(
    alice: ApiClient,
    clients: ClientPool,
    db_factory: sessionmaker[Session],
    project: dict[str, str],
) -> None:
    url = f"/projects/{project['id']}/edit"
    alice.put(url, json={"document": DOCUMENT, "links": {}, "expectedRevision": 0})
    viewer = _member(clients, db_factory, project, "viewer")
    assert viewer.get(url).status_code == 200
    denied = viewer.put(url, json={"document": DOCUMENT, "links": {}, "expectedRevision": 1})
    assert denied.status_code == 403
    media = viewer.post(f"{url}/media", files={"file": ("a.png", PNG, "image/png")})
    assert media.status_code == 403

    stranger = clients.login(create_user(db_factory, "Inconnu"))
    assert stranger.get(url).status_code == 404
    assert stranger.put(url, json={"document": DOCUMENT, "expectedRevision": 1}).status_code == 404


def test_media_upload_keeps_the_file_with_the_project(
    alice: ApiClient, project: dict[str, str]
) -> None:
    url = f"/projects/{project['id']}/edit/media"
    created = alice.post(url, files={"file": ("musique.wav", WAV, "audio/wav")})
    assert created.status_code == 201
    asset = created.json()["asset"]
    assert asset["type"] == "audio"
    assert asset["mimeType"] == "audio/wav"
    assert alice.get(f"/assets/{asset['id']}/content").content == WAV

    again = alice.post(url, files={"file": ("autre-nom.wav", WAV, "audio/wav")})
    assert again.status_code == 200
    assert again.json()["asset"]["id"] == asset["id"]


@pytest.mark.parametrize(
    ("name", "content", "mime", "expected"),
    [
        ("page.html", b"<html><script>alert(1)</script></html>", "text/html", 415),
        ("vecteur.svg", b"<svg xmlns='http://www.w3.org/2000/svg'/>", "image/svg+xml", 415),
        ("faux.png", b"<script>alert(1)</script>" + b"\0" * 32, "image/png", 422),
        ("vide.png", b"", "image/png", 422),
    ],
)
def test_media_upload_refuses_anything_else(
    alice: ApiClient,
    project: dict[str, str],
    name: str,
    content: bytes,
    mime: str,
    expected: int,
) -> None:
    response = alice.post(
        f"/projects/{project['id']}/edit/media", files={"file": (name, content, mime)}
    )
    assert response.status_code == expected
