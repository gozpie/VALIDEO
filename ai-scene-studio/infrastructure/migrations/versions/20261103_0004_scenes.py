"""Phase 2.2 : scènes et révisions immuables (snapshot en S3, empreinte SHA-256).

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-03 16:50:26.921904+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "scenes",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("shot_id", sa.UUID(), nullable=False),
        sa.Column("schema_version", sa.Integer(), nullable=False),
        sa.Column("head_revision_id", sa.UUID(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("schema_version >= 1", name=op.f("ck_scenes_schema_version_positive")),
        sa.ForeignKeyConstraint(
            ["shot_id"], ["shots.id"], name=op.f("fk_scenes_shot_id_shots"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_scenes")),
        sa.UniqueConstraint("shot_id", name=op.f("uq_scenes_shot_id")),
    )
    op.create_table(
        "scene_revisions",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("scene_id", sa.UUID(), nullable=False),
        sa.Column("parent_revision_id", sa.UUID(), nullable=True),
        sa.Column("schema_version", sa.Integer(), nullable=False),
        sa.Column("snapshot_key", sa.String(length=300), nullable=False),
        sa.Column("snapshot_hash", sa.String(length=64), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("message", sa.String(length=500), server_default="", nullable=False),
        sa.Column("created_by_id", sa.UUID(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "length(snapshot_hash) = 64", name=op.f("ck_scene_revisions_snapshot_hash_sha256")
        ),
        sa.CheckConstraint("size_bytes > 0", name=op.f("ck_scene_revisions_size_positive")),
        sa.ForeignKeyConstraint(
            ["created_by_id"],
            ["users.id"],
            name=op.f("fk_scene_revisions_created_by_id_users"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["parent_revision_id"],
            ["scene_revisions.id"],
            name=op.f("fk_scene_revisions_parent_revision_id_scene_revisions"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["scene_id"],
            ["scenes.id"],
            name=op.f("fk_scene_revisions_scene_id_scenes"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_scene_revisions")),
    )
    op.create_index(
        "ix_scene_revisions_scene_id_created_at",
        "scene_revisions",
        ["scene_id", "created_at"],
        unique=False,
    )
    # Référence circulaire : la contrainte n'est créée qu'une fois les deux tables présentes.
    op.create_foreign_key(
        op.f("fk_scenes_head_revision_id_scene_revisions"),
        "scenes",
        "scene_revisions",
        ["head_revision_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        op.f("fk_scenes_head_revision_id_scene_revisions"), "scenes", type_="foreignkey"
    )
    op.drop_index("ix_scene_revisions_scene_id_created_at", table_name="scene_revisions")
    op.drop_table("scene_revisions")
    op.drop_table("scenes")
