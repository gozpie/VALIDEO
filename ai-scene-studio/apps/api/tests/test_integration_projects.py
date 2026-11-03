"""Projets, séquences et plans : CRUD, ordre, droits et isolation (ASS_RUN_INTEGRATION=1)."""

import os
import uuid

import pytest
from sqlalchemy import insert
from sqlalchemy.orm import Session, sessionmaker

from ass_api.db.models import WorkspaceMember

from .support import ApiClient, ClientPool, create_user

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        os.environ.get("ASS_RUN_INTEGRATION") != "1", reason="ASS_RUN_INTEGRATION != 1"
    ),
]


@pytest.fixture
def alice(clients: ClientPool, db_factory: sessionmaker[Session]) -> ApiClient:
    return clients.login(create_user(db_factory, "Alice"))


@pytest.fixture
def workspace(alice: ApiClient) -> str:
    identifier: str = alice.post("/workspaces", json={"name": "Studio"}).json()["id"]
    return identifier


@pytest.fixture
def project(alice: ApiClient, workspace: str) -> dict[str, object]:
    response = alice.post(
        f"/workspaces/{workspace}/projects",
        json={"name": "Pilote", "fps": {"numerator": 24000, "denominator": 1001}},
    )
    assert response.status_code == 201, response.text
    body: dict[str, object] = response.json()
    return body


def _member(
    clients: ClientPool, factory: sessionmaker[Session], workspace: str, role: str
) -> ApiClient:
    user = create_user(factory, role.capitalize())
    with factory() as db:
        db.execute(
            insert(WorkspaceMember).values(
                workspace_id=uuid.UUID(workspace), user_id=user.id, role=role
            )
        )
        db.commit()
    return clients.login(user)


def _names(items: list[dict[str, object]]) -> list[object]:
    return [item["name"] for item in items]


def test_project_defaults_and_shape(project: dict[str, object], workspace: str) -> None:
    assert project["workspaceId"] == workspace
    assert project["fps"] == {"numerator": 24000, "denominator": 1001}
    assert project["resolution"] == {"width": 1920, "height": 1080}
    assert project["colorSpace"] == "srgb"
    assert project["description"] == ""


@pytest.mark.parametrize(
    "payload",
    [
        {"name": ""},
        {"name": "P", "fps": {"numerator": 0}},
        {"name": "P", "fps": {"numerator": 1, "denominator": 1001}},
        {"name": "P", "resolution": {"width": 0, "height": 1080}},
        {"name": "P", "resolution": {"width": 20000, "height": 1080}},
        {"name": "P", "colorSpace": "cmyk"},
    ],
)
def test_project_validation(alice: ApiClient, workspace: str, payload: dict[str, object]) -> None:
    assert alice.post(f"/workspaces/{workspace}/projects", json=payload).status_code == 422


def test_project_is_found_again_after_reconnection(
    clients: ClientPool, alice: ApiClient, workspace: str, project: dict[str, object]
) -> None:
    # Critère de la phase 1 : l'utilisateur retrouve ses projets dans une nouvelle session.
    again = clients.login(alice.user)
    listed = again.get(f"/workspaces/{workspace}/projects").json()
    assert [item["id"] for item in listed["items"]] == [project["id"]]
    assert again.get(f"/projects/{project['id']}").json() == project


def test_project_update_and_delete(alice: ApiClient, project: dict[str, object]) -> None:
    url = f"/projects/{project['id']}"
    updated = alice.patch(
        url, json={"name": "Pilote v2", "resolution": {"width": 3840, "height": 2160}}
    ).json()
    assert updated["name"] == "Pilote v2"
    assert updated["resolution"] == {"width": 3840, "height": 2160}
    assert updated["fps"] == project["fps"]
    assert alice.delete(url).status_code == 204
    assert alice.get(url).status_code == 404


def test_projects_pagination(alice: ApiClient, workspace: str) -> None:
    for index in range(3):
        alice.post(f"/workspaces/{workspace}/projects", json={"name": f"P{index}"})
    first = alice.get(f"/workspaces/{workspace}/projects", params={"limit": 2}).json()
    second = alice.get(
        f"/workspaces/{workspace}/projects", params={"limit": 2, "cursor": first["nextCursor"]}
    ).json()
    assert _names(first["items"]) + _names(second["items"]) == ["P0", "P1", "P2"]
    assert second["nextCursor"] is None


def test_sequences_order(alice: ApiClient, project: dict[str, object]) -> None:
    base = f"/projects/{project['id']}/sequences"
    a = alice.post(base, json={"name": "A"}).json()
    c = alice.post(base, json={"name": "C"}).json()
    b = alice.post(base, json={"name": "B", "position": 1}).json()
    head = alice.post(base, json={"name": "Tête", "position": 0}).json()
    listed = alice.get(base).json()
    assert _names(listed) == ["Tête", "A", "B", "C"]
    assert [item["orderIndex"] for item in listed] == [0, 1, 2, 3]

    reordered = alice.put(
        f"{base}/order", json={"sequenceIds": [c["id"], b["id"], a["id"], head["id"]]}
    ).json()
    assert _names(reordered) == ["C", "B", "A", "Tête"]

    assert alice.delete(f"/sequences/{b['id']}").status_code == 204
    listed = alice.get(base).json()
    assert _names(listed) == ["C", "A", "Tête"]
    assert [item["orderIndex"] for item in listed] == [0, 1, 2]

    renamed = alice.patch(f"/sequences/{a['id']}", json={"name": "A bis"}).json()
    assert renamed["name"] == "A bis"


@pytest.mark.parametrize("mode", ["missing", "duplicate", "foreign"])
def test_sequence_order_must_be_a_permutation(
    alice: ApiClient, project: dict[str, object], mode: str
) -> None:
    base = f"/projects/{project['id']}/sequences"
    ids = [alice.post(base, json={"name": n}).json()["id"] for n in ("A", "B")]
    order = {
        "missing": ids[:1],
        "duplicate": [ids[0], ids[0]],
        "foreign": [ids[0], str(uuid.uuid4())],
    }[mode]
    assert alice.put(f"{base}/order", json={"sequenceIds": order}).status_code == 422
    assert _names(alice.get(base).json()) == ["A", "B"]


def test_shots_crud_order_and_fps(alice: ApiClient, project: dict[str, object]) -> None:
    sequence = alice.post(f"/projects/{project['id']}/sequences", json={"name": "S"}).json()
    base = f"/sequences/{sequence['id']}/shots"
    one = alice.post(base, json={"name": "Plan 1", "durationFrames": 120}).json()
    assert one["fps"] is None
    assert one["effectiveFps"] == {"numerator": 24000, "denominator": 1001}
    assert one["projectId"] == project["id"]
    two = alice.post(
        base, json={"name": "Plan 2", "durationFrames": 50, "fps": {"numerator": 25}}
    ).json()
    assert two["effectiveFps"] == {"numerator": 25, "denominator": 1}

    patched = alice.patch(f"/shots/{two['id']}", json={"durationFrames": 75}).json()
    assert patched["durationFrames"] == 75
    assert patched["fps"] == {"numerator": 25, "denominator": 1}
    cleared = alice.patch(f"/shots/{two['id']}", json={"fps": None}).json()
    assert cleared["fps"] is None

    reordered = alice.put(f"{base}/order", json={"shotIds": [two["id"], one["id"]]}).json()
    assert _names(reordered) == ["Plan 2", "Plan 1"]
    assert alice.delete(f"/shots/{two['id']}").status_code == 204
    remaining = alice.get(base).json()
    assert [(item["name"], item["orderIndex"]) for item in remaining] == [("Plan 1", 0)]
    assert alice.post(base, json={"name": "X", "durationFrames": 0}).status_code == 422


def test_deleting_project_removes_sequences_and_shots(
    alice: ApiClient, project: dict[str, object]
) -> None:
    sequence = alice.post(f"/projects/{project['id']}/sequences", json={"name": "S"}).json()
    shot = alice.post(
        f"/sequences/{sequence['id']}/shots", json={"name": "P", "durationFrames": 1}
    ).json()
    alice.delete(f"/projects/{project['id']}")
    assert alice.get(f"/sequences/{sequence['id']}").status_code == 404
    assert alice.get(f"/shots/{shot['id']}").status_code == 404


def test_other_workspace_content_is_invisible(
    alice: ApiClient,
    project: dict[str, object],
    clients: ClientPool,
    db_factory: sessionmaker[Session],
) -> None:
    sequence = alice.post(f"/projects/{project['id']}/sequences", json={"name": "S"}).json()
    shot = alice.post(
        f"/sequences/{sequence['id']}/shots", json={"name": "P", "durationFrames": 1}
    ).json()
    mallory = clients.login(create_user(db_factory, "Mallory"))
    own = mallory.post("/workspaces", json={"name": "Le mien"}).json()["id"]
    for url in (
        f"/projects/{project['id']}",
        f"/projects/{project['id']}/sequences",
        f"/sequences/{sequence['id']}",
        f"/sequences/{sequence['id']}/shots",
        f"/shots/{shot['id']}",
    ):
        assert mallory.get(url).status_code == 404, url
    assert mallory.patch(f"/shots/{shot['id']}", json={"name": "x"}).status_code == 404
    assert mallory.delete(f"/projects/{project['id']}").status_code == 404
    # Son propre workspace ne donne aucun accès aux projets d'un autre.
    assert mallory.get(f"/workspaces/{own}/projects").json()["items"] == []


def test_viewer_reads_but_cannot_write(
    alice: ApiClient,
    workspace: str,
    project: dict[str, object],
    clients: ClientPool,
    db_factory: sessionmaker[Session],
) -> None:
    sequence = alice.post(f"/projects/{project['id']}/sequences", json={"name": "S"}).json()
    viewer = _member(clients, db_factory, workspace, "viewer")
    assert viewer.get(f"/projects/{project['id']}").status_code == 200
    assert viewer.get(f"/sequences/{sequence['id']}/shots").status_code == 200
    assert viewer.post(f"/workspaces/{workspace}/projects", json={"name": "X"}).status_code == 403
    assert viewer.patch(f"/projects/{project['id']}", json={"name": "X"}).status_code == 403
    assert (
        viewer.post(f"/projects/{project['id']}/sequences", json={"name": "X"}).status_code == 403
    )
    shot = {"name": "X", "durationFrames": 1}
    assert viewer.post(f"/sequences/{sequence['id']}/shots", json=shot).status_code == 403


def test_editor_writes_but_only_admin_deletes_project(
    workspace: str,
    project: dict[str, object],
    clients: ClientPool,
    db_factory: sessionmaker[Session],
) -> None:
    editor = _member(clients, db_factory, workspace, "editor")
    assert editor.patch(f"/projects/{project['id']}", json={"name": "Édité"}).status_code == 200
    sequence = editor.post(f"/projects/{project['id']}/sequences", json={"name": "S"})
    assert sequence.status_code == 201
    assert editor.delete(f"/sequences/{sequence.json()['id']}").status_code == 204
    assert editor.delete(f"/projects/{project['id']}").status_code == 403
    admin = _member(clients, db_factory, workspace, "admin")
    assert admin.delete(f"/projects/{project['id']}").status_code == 204
