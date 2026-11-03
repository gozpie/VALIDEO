"""Modèle de données (sans base) : tables attendues, clés, suppressions en cascade, contrats TS."""

import re
from pathlib import Path

import pytest
from sqlalchemy import ForeignKeyConstraint, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID

from ass_api.db.base import Base
from ass_api.db.models import COLOR_SPACES, WORKSPACE_ROLES

ROOT = Path(__file__).resolve().parents[3]
ENTITIES_TS = ROOT / "packages/shared-types/src/entities.ts"
TABLES = Base.metadata.tables


def _ts_union(type_name: str) -> tuple[str, ...]:
    source = ENTITIES_TS.read_text(encoding="utf-8")
    match = re.search(rf"export type {type_name} =([^;]+);", source)
    assert match, f"type {type_name} introuvable dans entities.ts"
    return tuple(re.findall(r"'([a-z_0-9]+)'", match.group(1)))


def _foreign_key(table: str, column: str) -> ForeignKeyConstraint:
    for constraint in TABLES[table].foreign_key_constraints:
        if constraint.column_keys == [column]:
            return constraint
    raise AssertionError(f"pas de clé étrangère {table}.{column}")


def test_phase_1_tables() -> None:
    assert set(TABLES) == {
        "users",
        "workspaces",
        "workspace_members",
        "projects",
        "sequences",
        "shots",
    }


@pytest.mark.parametrize("table", ["users", "workspaces", "projects", "sequences", "shots"])
def test_primary_key_is_uuid(table: str) -> None:
    (column,) = TABLES[table].primary_key.columns
    assert column.name == "id"
    assert isinstance(column.type, UUID)


@pytest.mark.parametrize(
    ("table", "column", "ondelete"),
    [
        ("workspaces", "owner_id", "RESTRICT"),
        ("workspace_members", "workspace_id", "CASCADE"),
        ("workspace_members", "user_id", "CASCADE"),
        ("projects", "workspace_id", "CASCADE"),
        ("sequences", "project_id", "CASCADE"),
        ("shots", "sequence_id", "CASCADE"),
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


def test_roles_match_shared_types() -> None:
    assert _ts_union("WorkspaceRole") == WORKSPACE_ROLES


def test_color_spaces_match_shared_types() -> None:
    assert _ts_union("ColorSpace") == COLOR_SPACES
