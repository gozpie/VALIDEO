"""Migrations et contraintes contre un vrai PostgreSQL (ASS_RUN_INTEGRATION=1).

Chaque module travaille dans une base temporaire créée puis supprimée : la base configurée
(ASS_DATABASE_URL) ne sert qu'à se connecter au serveur, ses données ne sont jamais touchées.
"""

import os
import uuid
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import Connection, Engine, create_engine, inspect, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError

from ass_api.core.config import Settings

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        os.environ.get("ASS_RUN_INTEGRATION") != "1", reason="ASS_RUN_INTEGRATION != 1"
    ),
]

ROOT = Path(__file__).resolve().parents[3]
ALEMBIC_INI = ROOT / "infrastructure/migrations/alembic.ini"
PHASE_1_TABLES = {"users", "workspaces", "workspace_members", "projects", "sequences", "shots"}


@pytest.fixture(scope="module")
def database_url() -> Iterator[str]:
    server_url = make_url(Settings().database_url.get_secret_value())
    name = f"ass_test_{uuid.uuid4().hex[:12]}"
    admin = create_engine(server_url, isolation_level="AUTOCOMMIT")
    with admin.connect() as connection:
        connection.execute(text(f'CREATE DATABASE "{name}"'))
    try:
        yield server_url.set(database=name).render_as_string(hide_password=False)
    finally:
        with admin.connect() as connection:
            connection.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        admin.dispose()


@pytest.fixture(scope="module")
def alembic_config(database_url: str) -> Config:
    config = Config(str(ALEMBIC_INI))
    config.attributes["database_url"] = database_url
    return config


@pytest.fixture(scope="module")
def engine(database_url: str, alembic_config: Config) -> Iterator[Engine]:
    command.upgrade(alembic_config, "head")
    db_engine = create_engine(database_url)
    yield db_engine
    db_engine.dispose()


@pytest.fixture
def conn(engine: Engine) -> Iterator[Connection]:
    """Connexion dont la transaction est annulée après chaque test."""
    with engine.connect() as connection:
        transaction = connection.begin()
        yield connection
        transaction.rollback()


def _insert(conn: Connection, table: str, **values: Any) -> uuid.UUID:
    values.setdefault("id", uuid.uuid4())
    columns = ", ".join(values)
    params = ", ".join(f":{key}" for key in values)
    conn.execute(text(f"INSERT INTO {table} ({columns}) VALUES ({params})"), values)  # noqa: S608
    identifier: uuid.UUID = values["id"]
    return identifier


def _user(conn: Connection, email: str | None = None) -> uuid.UUID:
    email = email or f"{uuid.uuid4().hex[:8]}@example.test"
    return _insert(conn, "users", email=email, display_name="Test")


def _project_tree(conn: Connection) -> dict[str, uuid.UUID]:
    owner = _user(conn)
    workspace = _insert(conn, "workspaces", name="Studio", owner_id=owner)
    conn.execute(
        text("INSERT INTO workspace_members VALUES (:w, :u, 'owner')"), {"w": workspace, "u": owner}
    )
    project = _insert(
        conn,
        "projects",
        workspace_id=workspace,
        name="Pilote",
        fps_numerator=24000,
        fps_denominator=1001,
        resolution_width=1920,
        resolution_height=1080,
    )
    sequence = _insert(conn, "sequences", project_id=project, name="Ouverture", order_index=0)
    shot = _insert(
        conn, "shots", sequence_id=sequence, name="Plan 1", order_index=0, duration_frames=120
    )
    return {
        "owner": owner,
        "workspace": workspace,
        "project": project,
        "sequence": sequence,
        "shot": shot,
    }


def _count(conn: Connection, table: str) -> int:
    return int(conn.execute(text(f"SELECT count(*) FROM {table}")).scalar_one())  # noqa: S608


def test_models_match_migrations(engine: Engine, alembic_config: Config) -> None:
    command.check(alembic_config)


def test_downgrade_then_upgrade(engine: Engine, alembic_config: Config) -> None:
    command.downgrade(alembic_config, "base")
    assert PHASE_1_TABLES.isdisjoint(inspect(engine).get_table_names())
    command.upgrade(alembic_config, "head")
    assert set(inspect(engine).get_table_names()) >= PHASE_1_TABLES


def test_defaults_are_set_by_database(conn: Connection) -> None:
    tree = _project_tree(conn)
    row = conn.execute(
        text("SELECT description, color_space, created_at FROM projects WHERE id = :id"),
        {"id": tree["project"]},
    ).one()
    assert row.description == ""
    assert row.color_space == "srgb"
    assert row.created_at.tzinfo is not None


def test_email_is_unique(conn: Connection) -> None:
    _user(conn, "pierre@example.test")
    with pytest.raises(IntegrityError, match="uq_users_email"):
        _user(conn, "pierre@example.test")


def test_email_must_be_lowercase(conn: Connection) -> None:
    with pytest.raises(IntegrityError, match="ck_users_email_lowercase"):
        _user(conn, "Pierre@Example.test")


def test_role_must_be_known(conn: Connection) -> None:
    tree = _project_tree(conn)
    other = _user(conn)
    with pytest.raises(IntegrityError, match="ck_workspace_members_role_valid"):
        conn.execute(
            text("INSERT INTO workspace_members VALUES (:w, :u, 'superuser')"),
            {"w": tree["workspace"], "u": other},
        )


@pytest.mark.parametrize(
    ("column", "value", "constraint"),
    [
        ("fps_numerator", 0, "ck_projects_fps_positive"),
        ("resolution_width", 0, "ck_projects_resolution_range"),
        ("resolution_height", 20000, "ck_projects_resolution_range"),
        ("color_space", "cmyk", "ck_projects_color_space_valid"),
        ("name", "", "ck_projects_name_not_empty"),
    ],
)
def test_project_checks(conn: Connection, column: str, value: object, constraint: str) -> None:
    tree = _project_tree(conn)
    with pytest.raises(IntegrityError, match=constraint):
        conn.execute(
            text(f"UPDATE projects SET {column} = :value WHERE id = :id"),  # noqa: S608
            {"value": value, "id": tree["project"]},
        )


@pytest.mark.parametrize(
    ("values", "constraint"),
    [
        ({"duration_frames": 0}, "ck_shots_duration_positive"),
        ({"fps_numerator": 25}, "ck_shots_fps_override_valid"),
        ({"fps_numerator": 25, "fps_denominator": 0}, "ck_shots_fps_override_valid"),
    ],
)
def test_shot_checks(conn: Connection, values: dict[str, int], constraint: str) -> None:
    tree = _project_tree(conn)
    assignments = ", ".join(f"{key} = :{key}" for key in values)
    with pytest.raises(IntegrityError, match=constraint):
        conn.execute(
            text(f"UPDATE shots SET {assignments} WHERE id = :id"),  # noqa: S608
            {**values, "id": tree["shot"]},
        )


def test_deleting_workspace_cascades(conn: Connection) -> None:
    tree = _project_tree(conn)
    conn.execute(text("DELETE FROM workspaces WHERE id = :id"), {"id": tree["workspace"]})
    for table in ("workspace_members", "projects", "sequences", "shots"):
        assert _count(conn, table) == 0, table


def test_owner_cannot_be_deleted_while_owning_workspace(conn: Connection) -> None:
    tree = _project_tree(conn)
    with pytest.raises(IntegrityError, match="fk_workspaces_owner_id_users"):
        conn.execute(text("DELETE FROM users WHERE id = :id"), {"id": tree["owner"]})


def test_shots_can_be_swapped_in_one_transaction(conn: Connection) -> None:
    tree = _project_tree(conn)
    second = _insert(
        conn, "shots", sequence_id=tree["sequence"], name="Plan 2", order_index=1, duration_frames=9
    )
    conn.execute(text("UPDATE shots SET order_index = 1 WHERE id = :id"), {"id": tree["shot"]})
    conn.execute(text("UPDATE shots SET order_index = 0 WHERE id = :id"), {"id": second})
    conn.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))


def test_duplicate_order_is_rejected_at_commit(conn: Connection) -> None:
    tree = _project_tree(conn)
    _insert(conn, "sequences", project_id=tree["project"], name="Doublon", order_index=0)
    with pytest.raises(IntegrityError, match="uq_sequences_project_id_order_index"):
        conn.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))
