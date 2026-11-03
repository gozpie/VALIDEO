"""Phase 5.1 : jobs de génération IA (fournisseur, modèle, manifests, coûts, sorties).

Revision ID: 0007
Revises: 0006
Create Date: 2026-11-03 18:42:35.872948+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "generation_jobs",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("workspace_id", sa.UUID(), nullable=False),
        sa.Column("shot_id", sa.UUID(), nullable=False),
        sa.Column("scene_revision_id", sa.UUID(), nullable=False),
        sa.Column("render_job_id", sa.UUID(), nullable=True),
        sa.Column("provider", sa.String(length=50), nullable=False),
        sa.Column("model_id", sa.String(length=100), nullable=False),
        sa.Column("model_version", sa.String(length=100), nullable=True),
        sa.Column("mode", sa.String(length=40), nullable=False),
        sa.Column("status", sa.String(length=16), server_default="queued", nullable=False),
        sa.Column("request", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("progress", sa.Float(), server_default="0", nullable=False),
        sa.Column("message", sa.String(length=500), server_default="", nullable=False),
        sa.Column("input_manifest_key", sa.String(length=300), nullable=True),
        sa.Column("output_manifest_key", sa.String(length=300), nullable=True),
        sa.Column(
            "outputs",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("external_id", sa.String(length=200), nullable=True),
        sa.Column("estimated_cost", sa.Float(), nullable=True),
        sa.Column("actual_cost", sa.Float(), nullable=True),
        sa.Column("cost_unit", sa.String(length=40), server_default="", nullable=False),
        sa.Column("error_details", sa.Text(), nullable=True),
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
            name=op.f("ck_generation_jobs_status_valid"),
        ),
        sa.CheckConstraint(
            "progress >= 0 AND progress <= 1", name=op.f("ck_generation_jobs_progress_range")
        ),
        sa.ForeignKeyConstraint(
            ["created_by_id"],
            ["users.id"],
            name=op.f("fk_generation_jobs_created_by_id_users"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["render_job_id"],
            ["render_jobs.id"],
            name=op.f("fk_generation_jobs_render_job_id_render_jobs"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["scene_revision_id"],
            ["scene_revisions.id"],
            name=op.f("fk_generation_jobs_scene_revision_id_scene_revisions"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["shot_id"],
            ["shots.id"],
            name=op.f("fk_generation_jobs_shot_id_shots"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_generation_jobs_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_generation_jobs")),
        sa.UniqueConstraint(
            "workspace_id",
            "idempotency_key",
            name="uq_generation_jobs_workspace_id_idempotency_key",
        ),
    )
    op.create_index(
        "ix_generation_jobs_shot_id_created_at",
        "generation_jobs",
        ["shot_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_generation_jobs_status_provider",
        "generation_jobs",
        ["status", "provider"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_generation_jobs_status_provider", table_name="generation_jobs")
    op.drop_index("ix_generation_jobs_shot_id_created_at", table_name="generation_jobs")
    op.drop_table("generation_jobs")
