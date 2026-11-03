"""Phase 2.3 : assets d'un workspace (fichiers référencés par ID, dédupliqués par SHA-256).

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-03 16:54:18.797199+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "assets",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("workspace_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("type", sa.String(length=16), nullable=False),
        sa.Column("mime_type", sa.String(length=100), nullable=False),
        sa.Column("storage_key", sa.String(length=300), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column(
            "metadata",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("created_by_id", sa.UUID(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "type IN ('model', 'texture', 'hdri', 'image', 'video', 'reference', 'render', "
            "'render_pass')",
            name=op.f("ck_assets_type_valid"),
        ),
        sa.CheckConstraint("length(name) > 0", name=op.f("ck_assets_name_not_empty")),
        sa.CheckConstraint("length(sha256) = 64", name=op.f("ck_assets_sha256_hex")),
        sa.CheckConstraint("size_bytes > 0", name=op.f("ck_assets_size_positive")),
        sa.ForeignKeyConstraint(
            ["created_by_id"],
            ["users.id"],
            name=op.f("fk_assets_created_by_id_users"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_assets_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_assets")),
        sa.UniqueConstraint("workspace_id", "sha256", name="uq_assets_workspace_id_sha256"),
    )
    op.create_index(
        "ix_assets_workspace_id_created_at", "assets", ["workspace_id", "created_at"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_assets_workspace_id_created_at", table_name="assets")
    op.drop_table("assets")
