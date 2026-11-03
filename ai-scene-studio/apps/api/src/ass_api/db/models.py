"""Modèle de données de la phase 1 : identités, workspaces, projets, séquences et plans.

Conventions :
- identifiants UUID générés côté application (stables, jamais réutilisés) ;
- dates ``timestamptz`` en UTC, renseignées par PostgreSQL ;
- énumérations stockées en texte et contraintes par ``CHECK`` (évolution sans ``ALTER TYPE``) ;
- l'ordre des séquences et des plans est unique par parent, contrôlé en fin de transaction
  (``DEFERRABLE INITIALLY DEFERRED``) pour permettre les réordonnancements en une transaction.

La table ``scenes`` et la colonne ``shots.active_scene_revision_id`` arrivent en phase 2,
avec les révisions de scène qu'elles référencent.
"""

import uuid
from datetime import datetime
from typing import Final

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from ass_api.db.base import Base

WORKSPACE_ROLES: Final = ("owner", "admin", "editor", "viewer")
COLOR_SPACES: Final = ("srgb", "rec709", "acescg", "linear_rec709")
MAX_RESOLUTION: Final = 16384


def _in(column: str, values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"{column} IN ({quoted})"


def _uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


def _created_at() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


def _updated_at() -> Mapped[datetime]:
    return mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        # L'application normalise l'adresse en minuscules ; la base le garantit.
        CheckConstraint("email = lower(email)", name="email_lowercase"),
        CheckConstraint("length(display_name) > 0", name="display_name_not_empty"),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False)
    # NULL : compte sans mot de passe local (invitation non acceptée ou identité externe).
    password_hash: Mapped[str | None] = mapped_column(Text, nullable=True)
    display_name: Mapped[str] = mapped_column(String(120), nullable=False)
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = _updated_at()


class Workspace(Base):
    __tablename__ = "workspaces"
    __table_args__ = (CheckConstraint("length(name) > 0", name="name_not_empty"),)

    id: Mapped[uuid.UUID] = _uuid_pk()
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    # Un utilisateur propriétaire ne peut pas être supprimé tant qu'il possède un workspace.
    owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = _updated_at()


class WorkspaceMember(Base):
    __tablename__ = "workspace_members"
    __table_args__ = (CheckConstraint(_in("role", WORKSPACE_ROLES), name="role_valid"),)

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    created_at: Mapped[datetime] = _created_at()


class Project(Base):
    __tablename__ = "projects"
    __table_args__ = (
        CheckConstraint("length(name) > 0", name="name_not_empty"),
        CheckConstraint("fps_numerator > 0 AND fps_denominator > 0", name="fps_positive"),
        CheckConstraint(
            f"resolution_width BETWEEN 1 AND {MAX_RESOLUTION} "
            f"AND resolution_height BETWEEN 1 AND {MAX_RESOLUTION}",
            name="resolution_range",
        ),
        CheckConstraint(_in("color_space", COLOR_SPACES), name="color_space_valid"),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    # fps rationnel (ex. 24000/1001) : aucune dérive flottante dans le calcul des frames.
    fps_numerator: Mapped[int] = mapped_column(Integer, nullable=False)
    fps_denominator: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1")
    resolution_width: Mapped[int] = mapped_column(Integer, nullable=False)
    resolution_height: Mapped[int] = mapped_column(Integer, nullable=False)
    color_space: Mapped[str] = mapped_column(String(32), nullable=False, server_default="srgb")
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = _updated_at()


class Sequence(Base):
    __tablename__ = "sequences"
    __table_args__ = (
        CheckConstraint("length(name) > 0", name="name_not_empty"),
        CheckConstraint("order_index >= 0", name="order_index_positive"),
        UniqueConstraint(
            "project_id",
            "order_index",
            name="uq_sequences_project_id_order_index",
            deferrable=True,
            initially="DEFERRED",
        ),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    order_index: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = _updated_at()


class Shot(Base):
    __tablename__ = "shots"
    __table_args__ = (
        CheckConstraint("length(name) > 0", name="name_not_empty"),
        CheckConstraint("order_index >= 0", name="order_index_positive"),
        CheckConstraint("duration_frames > 0", name="duration_positive"),
        # fps propre au plan, ou hérité du projet (les deux colonnes NULL). Les IS NOT NULL sont
        # nécessaires : un CHECK évalué à NULL (une seule colonne renseignée) serait accepté.
        CheckConstraint(
            "(fps_numerator IS NULL AND fps_denominator IS NULL) "
            "OR (fps_numerator IS NOT NULL AND fps_denominator IS NOT NULL "
            "AND fps_numerator > 0 AND fps_denominator > 0)",
            name="fps_override_valid",
        ),
        UniqueConstraint(
            "sequence_id",
            "order_index",
            name="uq_shots_sequence_id_order_index",
            deferrable=True,
            initially="DEFERRED",
        ),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    sequence_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("sequences.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    order_index: Mapped[int] = mapped_column(Integer, nullable=False)
    duration_frames: Mapped[int] = mapped_column(Integer, nullable=False)
    fps_numerator: Mapped[int | None] = mapped_column(Integer, nullable=True)
    fps_denominator: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = _updated_at()
