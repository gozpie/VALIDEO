"""Phase 1.4 : invitations à rejoindre un workspace (lien à usage unique).

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-03 16:23:28.701892+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "workspace_invitations",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("workspace_id", sa.UUID(), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("invited_by_id", sa.UUID(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "role IN ('admin', 'editor', 'viewer')",
            name=op.f("ck_workspace_invitations_role_valid"),
        ),
        sa.CheckConstraint(
            "email = lower(email)", name=op.f("ck_workspace_invitations_email_lowercase")
        ),
        sa.ForeignKeyConstraint(
            ["invited_by_id"],
            ["users.id"],
            name=op.f("fk_workspace_invitations_invited_by_id_users"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_workspace_invitations_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_workspace_invitations")),
        sa.UniqueConstraint("token_hash", name=op.f("uq_workspace_invitations_token_hash")),
    )
    op.create_index(
        "uq_workspace_invitations_pending_email",
        "workspace_invitations",
        ["workspace_id", "email"],
        unique=True,
        postgresql_where="accepted_at IS NULL",
    )


def downgrade() -> None:
    op.drop_index(
        "uq_workspace_invitations_pending_email",
        table_name="workspace_invitations",
        postgresql_where="accepted_at IS NULL",
    )
    op.drop_table("workspace_invitations")
