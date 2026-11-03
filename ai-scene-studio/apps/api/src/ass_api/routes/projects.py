"""Projets d'un workspace : création, liste paginée, lecture, modification, suppression."""

import uuid
from datetime import datetime
from typing import Annotated, Self

from fastapi import APIRouter, Depends, Response, status
from pydantic import Field, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from ass_api.auth.dependencies import CurrentSessionDep
from ass_api.auth.permissions import Role, project_access, workspace_access
from ass_api.core.api_model import ApiModel
from ass_api.core.pagination import (
    DEFAULT_LIMIT,
    CursorQuery,
    LimitQuery,
    Page,
    encode_cursor,
    paginate,
)
from ass_api.db.models import MAX_RESOLUTION, Project
from ass_api.db.session import get_db
from ass_api.routes.schemas import ColorSpace, Description, Name

router = APIRouter(tags=["projects"])
DbDep = Annotated[Session, Depends(get_db)]


class Fps(ApiModel):
    """Cadence rationnelle (ex. 24000/1001), entre 1 et 1000 images par seconde."""

    numerator: Annotated[int, Field(ge=1, le=1_000_000)]
    denominator: Annotated[int, Field(ge=1, le=100_000)] = 1

    @model_validator(mode="after")
    def _plausible(self) -> Self:
        if not 1 <= self.numerator / self.denominator <= 1000:
            raise ValueError("La cadence doit être comprise entre 1 et 1000 images par seconde")
        return self


class Resolution(ApiModel):
    width: Annotated[int, Field(ge=1, le=MAX_RESOLUTION)]
    height: Annotated[int, Field(ge=1, le=MAX_RESOLUTION)]


class ProjectIn(ApiModel):
    name: Name
    description: Description = ""
    fps: Fps = Fps(numerator=24)
    resolution: Resolution = Resolution(width=1920, height=1080)
    color_space: ColorSpace = "srgb"


class ProjectPatch(ApiModel):
    name: Name | None = None
    description: Description | None = None
    fps: Fps | None = None
    resolution: Resolution | None = None
    color_space: ColorSpace | None = None


class ProjectOut(ApiModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    name: str
    description: str
    fps: Fps
    resolution: Resolution
    color_space: ColorSpace
    created_at: datetime
    updated_at: datetime


def project_out(project: Project) -> ProjectOut:
    return ProjectOut.model_validate(
        {
            "id": project.id,
            "workspace_id": project.workspace_id,
            "name": project.name,
            "description": project.description,
            "fps": {"numerator": project.fps_numerator, "denominator": project.fps_denominator},
            "resolution": {"width": project.resolution_width, "height": project.resolution_height},
            "color_space": project.color_space,
            "created_at": project.created_at,
            "updated_at": project.updated_at,
        }
    )


@router.post(
    "/workspaces/{workspace_id}/projects",
    response_model=ProjectOut,
    status_code=status.HTTP_201_CREATED,
)
def create_project(
    workspace_id: uuid.UUID, body: ProjectIn, current: CurrentSessionDep, db: DbDep
) -> ProjectOut:
    access = workspace_access(db, current.user, workspace_id, Role.EDITOR)
    project = Project(
        workspace_id=access.workspace.id,
        name=body.name,
        description=body.description,
        fps_numerator=body.fps.numerator,
        fps_denominator=body.fps.denominator,
        resolution_width=body.resolution.width,
        resolution_height=body.resolution.height,
        color_space=body.color_space,
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    return project_out(project)


@router.get("/workspaces/{workspace_id}/projects", response_model=Page[ProjectOut])
def list_projects(
    workspace_id: uuid.UUID,
    current: CurrentSessionDep,
    db: DbDep,
    cursor: CursorQuery = None,
    limit: LimitQuery = DEFAULT_LIMIT,
) -> Page[ProjectOut]:
    workspace_access(db, current.user, workspace_id, Role.VIEWER)
    query = select(Project).where(Project.workspace_id == workspace_id)
    projects = db.scalars(paginate(query, Project.created_at, Project.id, cursor, limit)).all()
    last = projects[limit - 1] if len(projects) > limit else None
    return Page(
        items=[project_out(project) for project in projects[:limit]],
        next_cursor=encode_cursor(last.created_at, last.id) if last else None,
    )


@router.get("/projects/{project_id}", response_model=ProjectOut)
def get_project(project_id: uuid.UUID, current: CurrentSessionDep, db: DbDep) -> ProjectOut:
    project, _access = project_access(db, current.user, project_id, Role.VIEWER)
    return project_out(project)


@router.patch("/projects/{project_id}", response_model=ProjectOut)
def update_project(
    project_id: uuid.UUID, body: ProjectPatch, current: CurrentSessionDep, db: DbDep
) -> ProjectOut:
    project, _access = project_access(db, current.user, project_id, Role.EDITOR, lock=True)
    if body.name is not None:
        project.name = body.name
    if body.description is not None:
        project.description = body.description
    if body.fps is not None:
        project.fps_numerator, project.fps_denominator = body.fps.numerator, body.fps.denominator
    if body.resolution is not None:
        project.resolution_width = body.resolution.width
        project.resolution_height = body.resolution.height
    if body.color_space is not None:
        project.color_space = body.color_space
    db.commit()
    db.refresh(project)
    return project_out(project)


@router.delete("/projects/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(project_id: uuid.UUID, current: CurrentSessionDep, db: DbDep) -> Response:
    project, _access = project_access(db, current.user, project_id, Role.ADMIN, lock=True)
    db.delete(project)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
