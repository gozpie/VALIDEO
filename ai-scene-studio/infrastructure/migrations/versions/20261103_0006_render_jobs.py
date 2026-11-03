"""Phase 4.2 : jobs de rendu (état, réglages, progression, sorties, idempotence).

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-03 17:56:57.998884+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "render_jobs",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("workspace_id", sa.UUID(), nullable=False),
        sa.Column("shot_id", sa.UUID(), nullable=False),
        sa.Column("scene_revision_id", sa.UUID(), nullable=False),
        sa.Column("status", sa.String(length=16), server_default="queued", nullable=False),
        sa.Column("settings", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("progress", sa.Float(), server_default="0", nullable=False),
        sa.Column("message", sa.String(length=500), server_default="", nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column(
            "outputs",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("idempotency_key", sa.String(length=100), nullable=True),
        sa.Column(
            "cancel_requested", sa.Boolean(), server_default=sa.text("false"), nullable=False
        ),
        sa.Column("worker_id", sa.String(length=100), nullable=True),
        sa.Column("created_by_id", sa.UUID(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("heartbeat_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('queued', 'preparing', 'running', 'processing', 'completed', 'failed', "
            "'cancelled')",
            name=op.f("ck_render_jobs_status_valid"),
        ),
        sa.CheckConstraint(
            "progress >= 0 AND progress <= 1", name=op.f("ck_render_jobs_progress_range")
        ),
        sa.ForeignKeyConstraint(
            ["created_by_id"],
            ["users.id"],
            name=op.f("fk_render_jobs_created_by_id_users"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["scene_revision_id"],
            ["scene_revisions.id"],
            name=op.f("fk_render_jobs_scene_revision_id_scene_revisions"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["shot_id"], ["shots.id"], name=op.f("fk_render_jobs_shot_id_shots"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_render_jobs_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_render_jobs")),
        sa.UniqueConstraint(
            "workspace_id", "idempotency_key", name="uq_render_jobs_workspace_id_idempotency_key"
        ),
    )
    op.create_index(
        "ix_render_jobs_shot_id_created_at", "render_jobs", ["shot_id", "created_at"], unique=False
    )
    op.create_index("ix_render_jobs_status", "render_jobs", ["status"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_render_jobs_status", table_name="render_jobs")
    op.drop_index("ix_render_jobs_shot_id_created_at", table_name="render_jobs")
    op.drop_table("render_jobs")
