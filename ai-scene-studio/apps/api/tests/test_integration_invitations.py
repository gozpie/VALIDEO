"""Membres et invitations (ASS_RUN_INTEGRATION=1)."""

import os

import pytest
from sqlalchemy.orm import Session, sessionmaker

from .support import PASSWORD, ApiClient, ClientPool, create_user

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        os.environ.get("ASS_RUN_INTEGRATION") != "1", reason="ASS_RUN_INTEGRATION != 1"
    ),
]

NEW_PASSWORD = "mot de passe du nouveau compte"


@pytest.fixture
def owner(clients: ClientPool, db_factory: sessionmaker[Session]) -> ApiClient:
    return clients.login(create_user(db_factory, "Propriétaire"))


@pytest.fixture
def workspace(owner: ApiClient) -> str:
    identifier: str = owner.post("/workspaces", json={"name": "Studio"}).json()["id"]
    return identifier


def _invite(api: ApiClient, workspace: str, email: str, role: str = "editor") -> dict[str, str]:
    response = api.post(f"/workspaces/{workspace}/invitations", json={"email": email, "role": role})
    assert response.status_code == 201, response.text
    body: dict[str, str] = response.json()
    return body


def test_new_account_accepts_and_is_logged_in(
    owner: ApiClient, workspace: str, clients: ClientPool
) -> None:
    invitation = _invite(owner, workspace, "  Nouvelle@Example.test ")
    assert invitation["email"] == "nouvelle@example.test"
    assert invitation["acceptUrl"].endswith(f"/invitations/{invitation['token']}")

    guest = clients.anonymous()
    preview = guest.get(f"/invitations/{invitation['token']}").json()
    assert preview == {
        "workspaceName": "Studio",
        "email": "nouvelle@example.test",
        "role": "editor",
        "expiresAt": preview["expiresAt"],
        "accountExists": False,
    }
    accepted = guest.post(
        f"/invitations/{invitation['token']}/accept",
        json={"displayName": "Nouvelle", "password": NEW_PASSWORD},
    )
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["user"]["email"] == "nouvelle@example.test"
    # Connectée d'emblée, avec le rôle prévu.
    assert guest.get(f"/workspaces/{workspace}").json()["role"] == "editor"
    # Lien à usage unique.
    assert guest.get(f"/invitations/{invitation['token']}").status_code == 404


def test_new_account_needs_name_and_strong_password(
    owner: ApiClient, workspace: str, clients: ClientPool
) -> None:
    token = _invite(owner, workspace, "faible@example.test")["token"]
    guest = clients.anonymous()
    url = f"/invitations/{token}/accept"
    assert guest.post(url, json={}).status_code == 422
    assert guest.post(url, json={"displayName": "X", "password": "court"}).status_code == 422
    assert guest.get(f"/invitations/{token}").status_code == 200


def test_existing_account_must_be_logged_in_as_invitee(
    owner: ApiClient, workspace: str, clients: ClientPool, db_factory: sessionmaker[Session]
) -> None:
    invitee = create_user(db_factory, "Invité")
    stranger = clients.login(create_user(db_factory, "Inconnu"))
    token = _invite(owner, workspace, invitee.email, "viewer")["token"]
    url = f"/invitations/{token}/accept"

    assert clients.anonymous().get(f"/invitations/{token}").json()["accountExists"] is True
    # Le lien seul ne permet pas de prendre la main sur un compte existant.
    anonymous = clients.anonymous()
    assert (
        anonymous.post(url, json={"displayName": "X", "password": NEW_PASSWORD}).status_code == 401
    )
    assert stranger.post(url, json={}).status_code == 403

    invited = clients.login(invitee, PASSWORD)
    assert invited.post(url, json={}).status_code == 200
    assert invited.get(f"/workspaces/{workspace}").json()["role"] == "viewer"


def test_unknown_token_is_404(clients: ClientPool) -> None:
    guest = clients.anonymous()
    assert guest.get("/invitations/" + "x" * 43).status_code == 404
    assert guest.post("/invitations/" + "x" * 43 + "/accept", json={}).status_code == 404


def test_only_admins_invite(
    owner: ApiClient, workspace: str, clients: ClientPool, db_factory: sessionmaker[Session]
) -> None:
    editor_user = create_user(db_factory, "Éditrice")
    token = _invite(owner, workspace, editor_user.email, "editor")["token"]
    editor = clients.login(editor_user)
    editor.post(f"/invitations/{token}/accept", json={})
    response = editor.post(
        f"/workspaces/{workspace}/invitations", json={"email": "x@example.test", "role": "viewer"}
    )
    assert response.status_code == 403
    assert editor.get(f"/workspaces/{workspace}/invitations").status_code == 403


def test_owner_role_cannot_be_invited(owner: ApiClient, workspace: str) -> None:
    response = owner.post(
        f"/workspaces/{workspace}/invitations", json={"email": "x@example.test", "role": "owner"}
    )
    assert response.status_code == 422


def test_reinviting_replaces_pending_and_revoke_works(owner: ApiClient, workspace: str) -> None:
    first = _invite(owner, workspace, "deux@example.test")
    second = _invite(owner, workspace, "deux@example.test", "viewer")
    pending = owner.get(f"/workspaces/{workspace}/invitations").json()
    assert [item["id"] for item in pending] == [second["id"]]
    assert owner.get(f"/invitations/{first['token']}").status_code == 404

    assert owner.delete(f"/workspaces/{workspace}/invitations/{second['id']}").status_code == 204
    assert owner.get(f"/workspaces/{workspace}/invitations").json() == []


def test_member_cannot_be_invited_twice(owner: ApiClient, workspace: str) -> None:
    response = owner.post(
        f"/workspaces/{workspace}/invitations",
        json={"email": owner.user.email, "role": "viewer"},
    )
    assert response.status_code == 409


def test_members_roles_and_removal(
    owner: ApiClient, workspace: str, clients: ClientPool, db_factory: sessionmaker[Session]
) -> None:
    member_user = create_user(db_factory, "Membre")
    token = _invite(owner, workspace, member_user.email, "viewer")["token"]
    member = clients.login(member_user)
    member.post(f"/invitations/{token}/accept", json={})
    base = f"/workspaces/{workspace}/members"

    members = owner.get(base).json()
    assert {(m["displayName"], m["role"]) for m in members} == {
        ("Propriétaire", "owner"),
        ("Membre", "viewer"),
    }
    # Un viewer ne gère pas les rôles ; le propriétaire ne peut être ni rétrogradé ni retiré.
    assert member.patch(f"{base}/{owner.user.id}", json={"role": "viewer"}).status_code == 403
    assert owner.patch(f"{base}/{owner.user.id}", json={"role": "viewer"}).status_code == 403
    assert owner.delete(f"{base}/{owner.user.id}").status_code == 403
    assert owner.patch(f"{base}/{member_user.id}", json={"role": "owner"}).status_code == 422

    promoted = owner.patch(f"{base}/{member_user.id}", json={"role": "admin"})
    assert promoted.json()["role"] == "admin"
    # Départ volontaire, puis plus aucun accès.
    assert member.delete(f"{base}/{member_user.id}").status_code == 204
    assert member.get(f"/workspaces/{workspace}").status_code == 404
