"""Phase 7.2 : montage du film enregistré côté serveur, et médias audio dans les assets.

Revision ID: 0009
Revises: 0008
Create Date: 2026-11-04 09:00:00.000000+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

OLD_TYPES = "'model', 'texture', 'hdri', 'image', 'video', 'reference', 'render', 'render_pass'"


def upgrade() -> None:
    op.create_table(
        "project_edits",
        sa.Column("project_id", sa.UUID(), nullable=False),
        sa.Column("document", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "links",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("revision", sa.Integer(), server_default="1", nullable=False),
        sa.Column("updated_by_id", sa.UUID(), nullable=True),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("revision >= 1", name=op.f("ck_project_edits_revision_positive")),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name=op.f("fk_project_edits_project_id_projects"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["updated_by_id"],
            ["users.id"],
            name=op.f("fk_project_edits_updated_by_id_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("project_id", name=op.f("pk_project_edits")),
    )
    op.drop_constraint(op.f("ck_assets_type_valid"), "assets", type_="check")
    op.create_check_constraint(
        op.f("ck_assets_type_valid"), "assets", f"type IN ({OLD_TYPES}, 'audio')"
    )


def downgrade() -> None:
    op.execute("DELETE FROM assets WHERE type = 'audio'")
    op.drop_constraint(op.f("ck_assets_type_valid"), "assets", type_="check")
    op.create_check_constraint(op.f("ck_assets_type_valid"), "assets", f"type IN ({OLD_TYPES})")
    op.drop_table("project_edits")
