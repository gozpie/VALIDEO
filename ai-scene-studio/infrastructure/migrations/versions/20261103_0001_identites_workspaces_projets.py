"""Phase 1.1 : utilisateurs, workspaces, membres, projets, séquences et plans.

Revision ID: 0001
Revises:
Create Date: 2026-11-03 16:11:00.760025+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=True),
        sa.Column("display_name", sa.String(length=120), nullable=False),
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
        sa.CheckConstraint("email = lower(email)", name=op.f("ck_users_email_lowercase")),
        sa.CheckConstraint(
            "length(display_name) > 0", name=op.f("ck_users_display_name_not_empty")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_users")),
        sa.UniqueConstraint("email", name=op.f("uq_users_email")),
    )
    op.create_table(
        "workspaces",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("owner_id", sa.UUID(), nullable=False),
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
        sa.CheckConstraint("length(name) > 0", name=op.f("ck_workspaces_name_not_empty")),
        sa.ForeignKeyConstraint(
            ["owner_id"],
            ["users.id"],
            name=op.f("fk_workspaces_owner_id_users"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_workspaces")),
    )
    op.create_index(op.f("ix_workspaces_owner_id"), "workspaces", ["owner_id"], unique=False)
    op.create_table(
        "projects",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("workspace_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), server_default="", nullable=False),
        sa.Column("fps_numerator", sa.Integer(), nullable=False),
        sa.Column("fps_denominator", sa.Integer(), server_default="1", nullable=False),
        sa.Column("resolution_width", sa.Integer(), nullable=False),
        sa.Column("resolution_height", sa.Integer(), nullable=False),
        sa.Column("color_space", sa.String(length=32), server_default="srgb", nullable=False),
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
        sa.CheckConstraint(
            "color_space IN ('srgb', 'rec709', 'acescg', 'linear_rec709')",
            name=op.f("ck_projects_color_space_valid"),
        ),
        sa.CheckConstraint(
            "fps_numerator > 0 AND fps_denominator > 0", name=op.f("ck_projects_fps_positive")
        ),
        sa.CheckConstraint("length(name) > 0", name=op.f("ck_projects_name_not_empty")),
        sa.CheckConstraint(
            "resolution_width BETWEEN 1 AND 16384 AND resolution_height BETWEEN 1 AND 16384",
            name=op.f("ck_projects_resolution_range"),
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_projects_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_projects")),
    )
    op.create_index(op.f("ix_projects_workspace_id"), "projects", ["workspace_id"], unique=False)
    op.create_table(
        "workspace_members",
        sa.Column("workspace_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "role IN ('owner', 'admin', 'editor', 'viewer')",
            name=op.f("ck_workspace_members_role_valid"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_workspace_members_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_workspace_members_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("workspace_id", "user_id", name=op.f("pk_workspace_members")),
    )
    op.create_index(
        op.f("ix_workspace_members_user_id"), "workspace_members", ["user_id"], unique=False
    )
    op.create_table(
        "sequences",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("project_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("order_index", sa.Integer(), nullable=False),
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
        sa.CheckConstraint("length(name) > 0", name=op.f("ck_sequences_name_not_empty")),
        sa.CheckConstraint("order_index >= 0", name=op.f("ck_sequences_order_index_positive")),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name=op.f("fk_sequences_project_id_projects"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_sequences")),
        sa.UniqueConstraint(
            "project_id",
            "order_index",
            deferrable=True,
            initially="DEFERRED",
            name="uq_sequences_project_id_order_index",
        ),
    )
    op.create_table(
        "shots",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("sequence_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("order_index", sa.Integer(), nullable=False),
        sa.Column("duration_frames", sa.Integer(), nullable=False),
        sa.Column("fps_numerator", sa.Integer(), nullable=True),
        sa.Column("fps_denominator", sa.Integer(), nullable=True),
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
        sa.CheckConstraint(
            "(fps_numerator IS NULL AND fps_denominator IS NULL) "
            "OR (fps_numerator IS NOT NULL AND fps_denominator IS NOT NULL "
            "AND fps_numerator > 0 AND fps_denominator > 0)",
            name=op.f("ck_shots_fps_override_valid"),
        ),
        sa.CheckConstraint("duration_frames > 0", name=op.f("ck_shots_duration_positive")),
        sa.CheckConstraint("length(name) > 0", name=op.f("ck_shots_name_not_empty")),
        sa.CheckConstraint("order_index >= 0", name=op.f("ck_shots_order_index_positive")),
        sa.ForeignKeyConstraint(
            ["sequence_id"],
            ["sequences.id"],
            name=op.f("fk_shots_sequence_id_sequences"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_shots")),
        sa.UniqueConstraint(
            "sequence_id",
            "order_index",
            deferrable=True,
            initially="DEFERRED",
            name="uq_shots_sequence_id_order_index",
        ),
    )


def downgrade() -> None:
    op.drop_table("shots")
    op.drop_table("sequences")
    op.drop_index(op.f("ix_workspace_members_user_id"), table_name="workspace_members")
    op.drop_table("workspace_members")
    op.drop_index(op.f("ix_projects_workspace_id"), table_name="projects")
    op.drop_table("projects")
    op.drop_index(op.f("ix_workspaces_owner_id"), table_name="workspaces")
    op.drop_table("workspaces")
    op.drop_table("users")
