"""Hiérarchie des rôles et décisions d'autorisation (sans base)."""

import pytest
from fastapi import HTTPException

from ass_api.auth.permissions import Role, _check
from ass_api.db.models import WORKSPACE_ROLES


def test_every_stored_role_is_known() -> None:
    assert {Role.parse(value).label for value in WORKSPACE_ROLES} == set(WORKSPACE_ROLES)


def test_roles_are_ordered() -> None:
    assert Role.VIEWER < Role.EDITOR < Role.ADMIN < Role.OWNER


@pytest.mark.parametrize(
    ("role", "minimum", "allowed"),
    [
        ("viewer", Role.VIEWER, True),
        ("viewer", Role.EDITOR, False),
        ("editor", Role.EDITOR, True),
        ("editor", Role.ADMIN, False),
        ("admin", Role.ADMIN, True),
        ("admin", Role.OWNER, False),
        ("owner", Role.OWNER, True),
    ],
)
def test_minimum_role(role: str, minimum: Role, allowed: bool) -> None:
    if allowed:
        assert _check(role, minimum) == Role.parse(role)
    else:
        with pytest.raises(HTTPException) as error:
            _check(role, minimum)
        assert error.value.status_code == 403


def test_unknown_role_is_rejected() -> None:
    with pytest.raises(KeyError):
        Role.parse("superuser")
