"""Modèle de données (sans base) : tables attendues, clés, suppressions en cascade, contrats TS."""

from typing import get_args

import pytest
from sqlalchemy import ForeignKeyConstraint, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID

from ass_api.db.base import Base
from ass_api.db.models import COLOR_SPACES, INVITABLE_ROLES, WORKSPACE_ROLES
from ass_api.routes.schemas import ColorSpace, InvitableRole, RoleName

TABLES = Base.metadata.tables


def _foreign_key(table: str, column: str) -> ForeignKeyConstraint:
    for constraint in TABLES[table].foreign_key_constraints:
        if constraint.column_keys == [column]:
            return constraint
    raise AssertionError(f"pas de clé étrangère {table}.{column}")


def test_phase_1_tables() -> None:
    assert set(TABLES) == {
        "users",
        "user_sessions",
        "workspaces",
        "workspace_members",
        "workspace_invitations",
        "projects",
        "sequences",
        "shots",
        "scenes",
        "scene_revisions",
        "assets",
        "render_jobs",
        "generation_jobs",
        "project_scripts",
        "bible_entries",
        "shot_bible_links",
        "shot_versions",
    }


@pytest.mark.parametrize(
    "table",
    [
        "users",
        "user_sessions",
        "workspaces",
        "workspace_invitations",
        "projects",
        "sequences",
        "shots",
    ],
)
def test_primary_key_is_uuid(table: str) -> None:
    (column,) = TABLES[table].primary_key.columns
    assert column.name == "id"
    assert isinstance(column.type, UUID)


@pytest.mark.parametrize(
    ("table", "column", "ondelete"),
    [
        ("user_sessions", "user_id", "CASCADE"),
        ("workspaces", "owner_id", "RESTRICT"),
        ("workspace_members", "workspace_id", "CASCADE"),
        ("workspace_members", "user_id", "CASCADE"),
        ("workspace_invitations", "workspace_id", "CASCADE"),
        ("workspace_invitations", "invited_by_id", "SET NULL"),
        ("projects", "workspace_id", "CASCADE"),
        ("sequences", "project_id", "CASCADE"),
        ("shots", "sequence_id", "CASCADE"),
        ("scenes", "shot_id", "CASCADE"),
        ("scenes", "head_revision_id", "SET NULL"),
        ("scene_revisions", "scene_id", "CASCADE"),
        ("assets", "workspace_id", "CASCADE"),
    ],
)
def test_foreign_key_delete_rule(table: str, column: str, ondelete: str) -> None:
    assert _foreign_key(table, column).ondelete == ondelete


@pytest.mark.parametrize(
    ("table", "parent"), [("sequences", "project_id"), ("shots", "sequence_id")]
)
def test_order_is_unique_per_parent_and_deferred(table: str, parent: str) -> None:
    uniques = [c for c in TABLES[table].constraints if isinstance(c, UniqueConstraint)]
    (order,) = [c for c in uniques if c.columns.keys() == [parent, "order_index"]]
    assert order.deferrable is True
    assert order.initially == "DEFERRED"


def test_api_enums_match_database_checks() -> None:
    # Les types TypeScript sont générés depuis l'OpenAPI, donc depuis ces Literal.
    assert get_args(RoleName) == WORKSPACE_ROLES
    assert get_args(InvitableRole) == INVITABLE_ROLES
    assert get_args(ColorSpace) == COLOR_SPACES
