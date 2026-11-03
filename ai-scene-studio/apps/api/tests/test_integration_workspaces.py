"""Workspaces et isolation entre utilisateurs (ASS_RUN_INTEGRATION=1)."""

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


def _create(api: ApiClient, name: str = "Studio") -> dict[str, str]:
    response = api.post("/workspaces", json={"name": name})
    assert response.status_code == 201, response.text
    body: dict[str, str] = response.json()
    return body


def _add_member(
    factory: sessionmaker[Session], workspace_id: str, api: ApiClient, role: str
) -> None:
    with factory() as db:
        db.execute(
            insert(WorkspaceMember).values(
                workspace_id=uuid.UUID(workspace_id), user_id=api.user.id, role=role
            )
        )
        db.commit()


@pytest.fixture
def alice(clients: ClientPool, db_factory: sessionmaker[Session]) -> ApiClient:
    return clients.login(create_user(db_factory, "Alice"))


@pytest.fixture
def bob(clients: ClientPool, db_factory: sessionmaker[Session]) -> ApiClient:
    return clients.login(create_user(db_factory, "Bob"))


def test_create_makes_creator_owner(alice: ApiClient) -> None:
    workspace = _create(alice, "  Studio Chagomi  ")
    assert workspace["name"] == "Studio Chagomi"
    assert workspace["role"] == "owner"
    assert workspace["ownerId"] == str(alice.user.id)


def test_requires_authentication(clients: ClientPool) -> None:
    anonymous = clients.anonymous()
    assert anonymous.get("/workspaces").status_code == 401
    assert anonymous.post("/workspaces", json={"name": "X"}).status_code == 401


def test_requires_csrf(alice: ApiClient) -> None:
    response = alice.http.post("/workspaces", json={"name": "Sans jeton"})
    assert response.status_code == 403


@pytest.mark.parametrize("name", ["", "   ", "x" * 121])
def test_rejects_invalid_names(alice: ApiClient, name: str) -> None:
    assert alice.post("/workspaces", json={"name": name}).status_code == 422


def test_list_shows_only_my_workspaces(alice: ApiClient, bob: ApiClient) -> None:
    mine = _create(alice, "A")
    theirs = _create(bob, "B")
    ids = {item["id"] for item in alice.get("/workspaces").json()["items"]}
    assert mine["id"] in ids
    assert theirs["id"] not in ids


def test_other_workspace_is_invisible(alice: ApiClient, bob: ApiClient) -> None:
    theirs = _create(bob)
    url = f"/workspaces/{theirs['id']}"
    # 404 et non 403 : l'existence d'un workspace étranger n'est pas révélée.
    assert alice.get(url).status_code == 404
    assert alice.patch(url, json={"name": "Piraté"}).status_code == 404
    assert alice.delete(url).status_code == 404
    assert bob.get(url).json()["name"] == "Studio"


def test_unknown_workspace_is_404(alice: ApiClient) -> None:
    assert alice.get(f"/workspaces/{uuid.uuid4()}").status_code == 404
    assert alice.get("/workspaces/pas-un-uuid").status_code == 422


@pytest.mark.parametrize(
    ("role", "can_rename", "can_delete"),
    [("viewer", False, False), ("editor", False, False), ("admin", True, False)],
)
def test_role_limits(
    alice: ApiClient,
    bob: ApiClient,
    db_factory: sessionmaker[Session],
    role: str,
    can_rename: bool,
    can_delete: bool,
) -> None:
    workspace = _create(alice)
    _add_member(db_factory, workspace["id"], bob, role)
    url = f"/workspaces/{workspace['id']}"
    assert bob.get(url).json()["role"] == role
    rename = bob.patch(url, json={"name": "Renommé"})
    assert rename.status_code == (200 if can_rename else 403)
    assert bob.delete(url).status_code == (204 if can_delete else 403)


def test_owner_renames_and_deletes(alice: ApiClient) -> None:
    workspace = _create(alice)
    url = f"/workspaces/{workspace['id']}"
    renamed = alice.patch(url, json={"name": "Nouveau nom"}).json()
    assert renamed["name"] == "Nouveau nom"
    assert renamed["updatedAt"] >= workspace["updatedAt"]
    assert alice.delete(url).status_code == 204
    assert alice.get(url).status_code == 404


def test_cursor_pagination(alice: ApiClient) -> None:
    created = [_create(alice, f"W{i}")["id"] for i in range(5)]
    seen: list[str] = []
    cursor: str | None = None
    while True:
        params: dict[str, str | int] = {"limit": 2}
        if cursor:
            params["cursor"] = cursor
        page = alice.get("/workspaces", params=params).json()
        assert len(page["items"]) <= 2
        seen += [item["id"] for item in page["items"]]
        cursor = page["nextCursor"]
        if cursor is None:
            break
    assert [identifier for identifier in seen if identifier in created] == created
    assert len(seen) == len(set(seen))


@pytest.mark.parametrize("cursor", ["n'importe quoi", "e30"])
def test_invalid_cursor(alice: ApiClient, cursor: str) -> None:
    assert alice.get("/workspaces", params={"cursor": cursor}).status_code == 422
