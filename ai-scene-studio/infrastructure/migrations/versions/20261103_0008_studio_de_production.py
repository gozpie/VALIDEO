"""Phase 6.1 : studio de production (scripts, bible, découpage des plans, versions de plans).

Les générations sont rattachées au projet ; le plan et la révision de scène deviennent facultatifs.

Revision ID: 0008
Revises: 0007
Create Date: 2026-11-03 21:37:18.637093+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "bible_entries",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("project_id", sa.UUID(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), server_default="", nullable=False),
        sa.Column("prompt", sa.Text(), server_default="", nullable=False),
        sa.Column("key_asset_id", sa.UUID(), nullable=True),
        sa.Column(
            "image_asset_ids",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column("order_index", sa.Integer(), server_default="0", nullable=False),
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
            "kind IN ('look', 'character', 'set', 'prop')", name=op.f("ck_bible_entries_kind_valid")
        ),
        sa.CheckConstraint("length(name) > 0", name=op.f("ck_bible_entries_name_not_empty")),
        sa.ForeignKeyConstraint(
            ["key_asset_id"],
            ["assets.id"],
            name=op.f("fk_bible_entries_key_asset_id_assets"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name=op.f("fk_bible_entries_project_id_projects"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_bible_entries")),
        sa.UniqueConstraint(
            "project_id", "kind", "name", name="uq_bible_entries_project_kind_name"
        ),
    )
    op.create_index(
        op.f("ix_bible_entries_project_id"), "bible_entries", ["project_id"], unique=False
    )
    op.create_table(
        "project_scripts",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("project_id", sa.UUID(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=200), server_default="", nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_by_id", sa.UUID(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "length(content) <= 500000", name=op.f("ck_project_scripts_content_length")
        ),
        sa.CheckConstraint("version >= 1", name=op.f("ck_project_scripts_version_positive")),
        sa.ForeignKeyConstraint(
            ["created_by_id"],
            ["users.id"],
            name=op.f("fk_project_scripts_created_by_id_users"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name=op.f("fk_project_scripts_project_id_projects"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_project_scripts")),
        sa.UniqueConstraint("project_id", "version", name="uq_project_scripts_project_id_version"),
    )
    op.create_table(
        "shot_bible_links",
        sa.Column("shot_id", sa.UUID(), nullable=False),
        sa.Column("entry_id", sa.UUID(), nullable=False),
        sa.ForeignKeyConstraint(
            ["entry_id"],
            ["bible_entries.id"],
            name=op.f("fk_shot_bible_links_entry_id_bible_entries"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["shot_id"],
            ["shots.id"],
            name=op.f("fk_shot_bible_links_shot_id_shots"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("shot_id", "entry_id", name=op.f("pk_shot_bible_links")),
    )
    op.create_index(
        op.f("ix_shot_bible_links_entry_id"), "shot_bible_links", ["entry_id"], unique=False
    )
    op.create_table(
        "shot_versions",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("shot_id", sa.UUID(), nullable=False),
        sa.Column("parent_id", sa.UUID(), nullable=True),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=8), nullable=False),
        sa.Column("asset_id", sa.UUID(), nullable=False),
        sa.Column("generation_job_id", sa.UUID(), nullable=True),
        sa.Column("prompt", sa.Text(), server_default="", nullable=False),
        sa.Column("note", sa.Text(), server_default="", nullable=False),
        sa.Column("created_by_id", sa.UUID(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("kind IN ('image', 'video')", name=op.f("ck_shot_versions_kind_valid")),
        sa.CheckConstraint("number >= 1", name=op.f("ck_shot_versions_number_positive")),
        sa.ForeignKeyConstraint(
            ["asset_id"],
            ["assets.id"],
            name=op.f("fk_shot_versions_asset_id_assets"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["created_by_id"],
            ["users.id"],
            name=op.f("fk_shot_versions_created_by_id_users"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["generation_job_id"],
            ["generation_jobs.id"],
            name=op.f("fk_shot_versions_generation_job_id_generation_jobs"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["parent_id"],
            ["shot_versions.id"],
            name=op.f("fk_shot_versions_parent_id_shot_versions"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["shot_id"],
            ["shots.id"],
            name=op.f("fk_shot_versions_shot_id_shots"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_shot_versions")),
        sa.UniqueConstraint("shot_id", "number", name="uq_shot_versions_shot_id_number"),
    )
    op.add_column("generation_jobs", sa.Column("project_id", sa.UUID(), nullable=True))
    op.execute(
        "UPDATE generation_jobs g SET project_id = q.project_id "
        "FROM shots s JOIN sequences q ON q.id = s.sequence_id WHERE s.id = g.shot_id"
    )
    op.alter_column("generation_jobs", "project_id", existing_type=sa.UUID(), nullable=False)
    op.alter_column("generation_jobs", "shot_id", existing_type=sa.UUID(), nullable=True)
    op.alter_column("generation_jobs", "scene_revision_id", existing_type=sa.UUID(), nullable=True)
    op.create_index(
        "ix_generation_jobs_project_id_created_at",
        "generation_jobs",
        ["project_id", "created_at"],
        unique=False,
    )
    op.create_foreign_key(
        op.f("fk_generation_jobs_project_id_projects"),
        "generation_jobs",
        "projects",
        ["project_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.add_column("shots", sa.Column("description", sa.Text(), server_default="", nullable=False))
    op.add_column("shots", sa.Column("intention", sa.Text(), server_default="", nullable=False))
    op.add_column("shots", sa.Column("dialogue", sa.Text(), server_default="", nullable=False))
    op.add_column(
        "shots", sa.Column("shot_size", sa.String(length=80), server_default="", nullable=False)
    )
    op.add_column("shots", sa.Column("camera", sa.Text(), server_default="", nullable=False))
    op.add_column(
        "shots",
        sa.Column(
            "approach", sa.String(length=20), server_default="image_to_video", nullable=False
        ),
    )
    op.add_column(
        "shots", sa.Column("status", sa.String(length=16), server_default="todo", nullable=False)
    )
    op.add_column("shots", sa.Column("image_prompt", sa.Text(), server_default="", nullable=False))
    op.add_column("shots", sa.Column("video_prompt", sa.Text(), server_default="", nullable=False))
    op.add_column(
        "shots", sa.Column("negative_prompt", sa.Text(), server_default="", nullable=False)
    )
    op.add_column("shots", sa.Column("selected_version_id", sa.UUID(), nullable=True))
    op.create_foreign_key(
        op.f("fk_shots_selected_version_id_shot_versions"),
        "shots",
        "shot_versions",
        ["selected_version_id"],
        ["id"],
        ondelete="SET NULL",
        use_alter=True,
    )
    op.create_check_constraint(
        op.f("ck_shots_approach_valid"),
        "shots",
        "approach IN ('image_to_video', 'multishot', 'text_to_video', 'still', 'scene_3d')",
    )
    op.create_check_constraint(
        op.f("ck_shots_status_valid"),
        "shots",
        "status IN ('todo', 'in_progress', 'review', 'approved')",
    )


def downgrade() -> None:
    op.drop_constraint(op.f("ck_shots_status_valid"), "shots", type_="check")
    op.drop_constraint(op.f("ck_shots_approach_valid"), "shots", type_="check")
    op.drop_constraint(
        op.f("fk_shots_selected_version_id_shot_versions"), "shots", type_="foreignkey"
    )
    op.drop_column("shots", "selected_version_id")
    op.drop_column("shots", "negative_prompt")
    op.drop_column("shots", "video_prompt")
    op.drop_column("shots", "image_prompt")
    op.drop_column("shots", "status")
    op.drop_column("shots", "approach")
    op.drop_column("shots", "camera")
    op.drop_column("shots", "shot_size")
    op.drop_column("shots", "dialogue")
    op.drop_column("shots", "intention")
    op.drop_column("shots", "description")
    op.drop_constraint(
        op.f("fk_generation_jobs_project_id_projects"), "generation_jobs", type_="foreignkey"
    )
    op.drop_index("ix_generation_jobs_project_id_created_at", table_name="generation_jobs")
    # Les générations du studio (sans plan ni révision) n'existent pas avant cette migration.
    op.execute("DELETE FROM generation_jobs WHERE shot_id IS NULL OR scene_revision_id IS NULL")
    op.alter_column("generation_jobs", "scene_revision_id", existing_type=sa.UUID(), nullable=False)
    op.alter_column("generation_jobs", "shot_id", existing_type=sa.UUID(), nullable=False)
    op.drop_column("generation_jobs", "project_id")
    op.drop_table("shot_versions")
    op.drop_index(op.f("ix_shot_bible_links_entry_id"), table_name="shot_bible_links")
    op.drop_table("shot_bible_links")
    op.drop_table("project_scripts")
    op.drop_index(op.f("ix_bible_entries_project_id"), table_name="bible_entries")
    op.drop_table("bible_entries")
