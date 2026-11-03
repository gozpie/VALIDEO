"""Studio de production (phase 6) : scripts versionnés, bible, storyboard, versions de plans.

Le flux de fabrication : brief / script → découpage (séquences et plans) → bible (LOOK,
personnages, décors, accessoires) → plans générés en versions successives (arbre des allers-retours,
une version retenue par plan) → montage (phase 7).
"""

import re
import unicodedata
import uuid
from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ass_api.auth.dependencies import CurrentSessionDep
from ass_api.auth.permissions import Role, project_access, shot_access
from ass_api.core.api_model import ApiModel
from ass_api.db.models import (
    SHOT_APPROACHES,
    Asset,
    BibleEntry,
    GenerationJob,
    Project,
    ProjectScript,
    Sequence,
    Shot,
    ShotBibleLink,
    ShotVersion,
)
from ass_api.db.session import get_db
from ass_api.routes.ordering import open_slot
from ass_api.routes.schemas import Name
from ass_api.routes.shots import ShotOut, bible_links, shot_out

router = APIRouter(tags=["studio"])
DbDep = Annotated[Session, Depends(get_db)]
BibleKind = Literal["look", "character", "set", "prop"]
VersionKind = Literal["image", "video"]
ScriptText = Annotated[str, Field(max_length=500_000)]
LongText = Annotated[str, Field(max_length=20_000)]
MEDIA_MIME = {"image": ("image/png", "image/jpeg", "image/webp"), "video": ("video/mp4",)}


# --- Scripts -------------------------------------------------------------------------------------


class ScriptIn(ApiModel):
    title: Annotated[str, Field(max_length=200)] = ""
    content: ScriptText


class ScriptSummaryOut(ApiModel):
    id: uuid.UUID
    project_id: uuid.UUID
    version: int
    title: str
    length: int
    created_at: datetime


class ScriptOut(ScriptSummaryOut):
    content: str


def _script_out(script: ProjectScript, full: bool) -> ScriptOut | ScriptSummaryOut:
    values = {
        "id": script.id,
        "project_id": script.project_id,
        "version": script.version,
        "title": script.title,
        "length": len(script.content),
        "created_at": script.created_at,
    }
    return ScriptOut(**values, content=script.content) if full else ScriptSummaryOut(**values)


@router.get("/projects/{project_id}/scripts", response_model=list[ScriptSummaryOut])
def list_scripts(
    project_id: uuid.UUID, current: CurrentSessionDep, db: DbDep
) -> list[ScriptOut | ScriptSummaryOut]:
    project_access(db, current.user, project_id, Role.VIEWER)
    scripts = db.scalars(
        select(ProjectScript)
        .where(ProjectScript.project_id == project_id)
        .order_by(ProjectScript.version.desc())
    )
    return [_script_out(script, full=False) for script in scripts]


@router.post(
    "/projects/{project_id}/scripts",
    response_model=ScriptOut,
    status_code=status.HTTP_201_CREATED,
)
def create_script(
    project_id: uuid.UUID, body: ScriptIn, current: CurrentSessionDep, db: DbDep
) -> ScriptOut | ScriptSummaryOut:
    """Nouvelle version immuable (le projet est verrouillé pour numéroter sans conflit)."""
    project, _access = project_access(db, current.user, project_id, Role.EDITOR, lock=True)
    last = db.scalar(
        select(func.max(ProjectScript.version)).where(ProjectScript.project_id == project.id)
    )
    script = ProjectScript(
        project_id=project.id,
        version=(last or 0) + 1,
        title=body.title.strip(),
        content=body.content,
        created_by_id=current.user.id,
    )
    db.add(script)
    db.commit()
    db.refresh(script)
    return _script_out(script, full=True)


@router.get("/scripts/{script_id}", response_model=ScriptOut)
def get_script(
    script_id: uuid.UUID, current: CurrentSessionDep, db: DbDep
) -> ScriptOut | ScriptSummaryOut:
    script = db.get(ProjectScript, script_id)
    if script is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ressource introuvable")
    project_access(db, current.user, script.project_id, Role.VIEWER)
    return _script_out(script, full=True)


# --- Bible ---------------------------------------------------------------------------------------


class BibleEntryIn(ApiModel):
    kind: BibleKind
    name: Name
    description: LongText = ""
    prompt: LongText = ""


class BibleEntryPatch(ApiModel):
    name: Name | None = None
    description: LongText | None = None
    prompt: LongText | None = None
    key_asset_id: uuid.UUID | None = None
    order_index: Annotated[int, Field(ge=0)] | None = None


class BibleEntryOut(ApiModel):
    id: uuid.UUID
    project_id: uuid.UUID
    kind: BibleKind
    name: str
    description: str
    prompt: str
    key_asset_id: uuid.UUID | None
    image_asset_ids: list[uuid.UUID]
    order_index: int
    created_at: datetime
    updated_at: datetime


KIND_ORDER = {"look": 0, "character": 1, "set": 2, "prop": 3}


def project_bible(db: Session, project_id: uuid.UUID) -> list[BibleEntry]:
    entries = db.scalars(select(BibleEntry).where(BibleEntry.project_id == project_id))
    return sorted(entries, key=lambda e: (KIND_ORDER[e.kind], e.order_index, e.name.lower()))


def _entry(db: Session, current: CurrentSessionDep, entry_id: uuid.UUID, role: Role) -> BibleEntry:
    entry = db.get(BibleEntry, entry_id)
    if entry is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ressource introuvable")
    project_access(db, current.user, entry.project_id, role)
    return entry


def _name_taken(
    db: Session, project_id: uuid.UUID, kind: str, name: str, exclude: uuid.UUID | None = None
) -> bool:
    query = select(BibleEntry.id).where(
        BibleEntry.project_id == project_id,
        BibleEntry.kind == kind,
        func.lower(BibleEntry.name) == name.lower(),
    )
    if exclude is not None:
        query = query.where(BibleEntry.id != exclude)
    return db.scalar(query) is not None


@router.get("/projects/{project_id}/bible", response_model=list[BibleEntryOut])
def list_bible(project_id: uuid.UUID, current: CurrentSessionDep, db: DbDep) -> list[BibleEntry]:
    project_access(db, current.user, project_id, Role.VIEWER)
    return project_bible(db, project_id)


@router.post(
    "/projects/{project_id}/bible",
    response_model=BibleEntryOut,
    status_code=status.HTTP_201_CREATED,
)
def create_bible_entry(
    project_id: uuid.UUID, body: BibleEntryIn, current: CurrentSessionDep, db: DbDep
) -> BibleEntry:
    project, _access = project_access(db, current.user, project_id, Role.EDITOR, lock=True)
    if _name_taken(db, project.id, body.kind, body.name):
        raise HTTPException(status.HTTP_409_CONFLICT, "Ce nom existe déjà dans la bible")
    count = db.scalar(
        select(func.count())
        .select_from(BibleEntry)
        .where(BibleEntry.project_id == project.id, BibleEntry.kind == body.kind)
    )
    entry = BibleEntry(
        project_id=project.id,
        kind=body.kind,
        name=body.name,
        description=body.description,
        prompt=body.prompt,
        order_index=int(count or 0),
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


@router.patch("/bible-entries/{entry_id}", response_model=BibleEntryOut)
def update_bible_entry(
    entry_id: uuid.UUID, body: BibleEntryPatch, current: CurrentSessionDep, db: DbDep
) -> BibleEntry:
    entry = _entry(db, current, entry_id, Role.EDITOR)
    if body.name is not None and body.name != entry.name:
        if _name_taken(db, entry.project_id, entry.kind, body.name, exclude=entry.id):
            raise HTTPException(status.HTTP_409_CONFLICT, "Ce nom existe déjà dans la bible")
        entry.name = body.name
    if body.description is not None:
        entry.description = body.description
    if body.prompt is not None:
        entry.prompt = body.prompt
    if body.order_index is not None:
        entry.order_index = body.order_index
    if "key_asset_id" in body.model_fields_set:
        if body.key_asset_id is not None and str(body.key_asset_id) not in entry.image_asset_ids:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "L'image clé doit être l'une des images de cet élément",
            )
        entry.key_asset_id = body.key_asset_id
    db.commit()
    db.refresh(entry)
    return entry


@router.delete("/bible-entries/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_bible_entry(entry_id: uuid.UUID, current: CurrentSessionDep, db: DbDep) -> Response:
    entry = _entry(db, current, entry_id, Role.EDITOR)
    db.delete(entry)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


class BibleImageIn(ApiModel):
    asset_id: uuid.UUID


@router.post("/bible-entries/{entry_id}/images", response_model=BibleEntryOut)
def add_bible_image(
    entry_id: uuid.UUID, body: BibleImageIn, current: CurrentSessionDep, db: DbDep
) -> BibleEntry:
    """Ajoute une image du workspace (référence importée, rendu, image générée) à l'élément."""
    entry = _entry(db, current, entry_id, Role.EDITOR)
    project = db.get(Project, entry.project_id)
    assert project is not None  # noqa: S101
    asset = db.get(Asset, body.asset_id)
    if asset is None or asset.workspace_id != project.workspace_id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Image inconnue")
    if asset.mime_type not in MEDIA_MIME["image"]:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Ce fichier n'est pas une image")
    add_entry_image(entry, asset.id)
    db.commit()
    db.refresh(entry)
    return entry


def add_entry_image(entry: BibleEntry, asset_id: uuid.UUID) -> None:
    images = [i for i in entry.image_asset_ids if i != str(asset_id)]
    entry.image_asset_ids = [*images, str(asset_id)][-40:]
    if entry.key_asset_id is None:
        entry.key_asset_id = asset_id


# --- Versions de plans ---------------------------------------------------------------------------


class ShotVersionIn(ApiModel):
    asset_id: uuid.UUID
    parent_id: uuid.UUID | None = None
    note: LongText = ""
    prompt: LongText = ""


class ShotVersionPatch(ApiModel):
    note: LongText


class ShotVersionOut(ApiModel):
    id: uuid.UUID
    shot_id: uuid.UUID
    parent_id: uuid.UUID | None
    number: int
    kind: VersionKind
    asset_id: uuid.UUID
    generation_job_id: uuid.UUID | None
    prompt: str
    note: str
    created_at: datetime


def create_version(
    db: Session,
    shot: Shot,
    asset: Asset,
    *,
    parent_id: uuid.UUID | None,
    prompt: str = "",
    note: str = "",
    generation_job_id: uuid.UUID | None = None,
    created_by_id: uuid.UUID | None = None,
) -> ShotVersion:
    """Numérote la version suivante du plan (le plan est verrouillé par l'appelant)."""
    kind = next((k for k, mimes in MEDIA_MIME.items() if asset.mime_type in mimes), None)
    if kind is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Une version est une image ou une vidéo MP4"
        )
    if parent_id is not None:
        parent = db.get(ShotVersion, parent_id)
        if parent is None or parent.shot_id != shot.id:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Version parente inconnue")
    last = db.scalar(select(func.max(ShotVersion.number)).where(ShotVersion.shot_id == shot.id))
    version = ShotVersion(
        shot_id=shot.id,
        parent_id=parent_id,
        number=(last or 0) + 1,
        kind=kind,
        asset_id=asset.id,
        generation_job_id=generation_job_id,
        prompt=prompt[:20_000],
        note=note,
        created_by_id=created_by_id,
    )
    db.add(version)
    db.flush()
    return version


@router.get("/shots/{shot_id}/versions", response_model=list[ShotVersionOut])
def list_versions(shot_id: uuid.UUID, current: CurrentSessionDep, db: DbDep) -> list[ShotVersion]:
    shot, _sequence, _project, _access = shot_access(db, current.user, shot_id, Role.VIEWER)
    return list(
        db.scalars(
            select(ShotVersion)
            .where(ShotVersion.shot_id == shot.id)
            .order_by(ShotVersion.number.desc())
        )
    )


@router.post(
    "/shots/{shot_id}/versions",
    response_model=ShotVersionOut,
    status_code=status.HTTP_201_CREATED,
)
def add_version(
    shot_id: uuid.UUID, body: ShotVersionIn, current: CurrentSessionDep, db: DbDep
) -> ShotVersion:
    """Version ajoutée à la main (rendu Blender, image importée, vidéo montée ailleurs)."""
    shot, _sequence, _project, access = shot_access(db, current.user, shot_id, Role.EDITOR)
    db.refresh(shot, with_for_update=True)
    asset = db.get(Asset, body.asset_id)
    if asset is None or asset.workspace_id != access.workspace.id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Fichier inconnu")
    version = create_version(
        db,
        shot,
        asset,
        parent_id=body.parent_id,
        prompt=body.prompt,
        note=body.note,
        created_by_id=current.user.id,
    )
    db.commit()
    db.refresh(version)
    return version


@router.patch("/shot-versions/{version_id}", response_model=ShotVersionOut)
def update_version(
    version_id: uuid.UUID, body: ShotVersionPatch, current: CurrentSessionDep, db: DbDep
) -> ShotVersion:
    version = db.get(ShotVersion, version_id)
    if version is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ressource introuvable")
    shot_access(db, current.user, version.shot_id, Role.EDITOR)
    version.note = body.note
    db.commit()
    db.refresh(version)
    return version


# --- Storyboard ----------------------------------------------------------------------------------


class SelectedVersionOut(ApiModel):
    id: uuid.UUID
    number: int
    kind: VersionKind
    asset_id: uuid.UUID


class StoryboardShotOut(ShotOut):
    selected_version: SelectedVersionOut | None
    version_count: int


class StoryboardSequenceOut(ApiModel):
    id: uuid.UUID
    name: str
    order_index: int
    shots: list[StoryboardShotOut]


@router.get("/projects/{project_id}/storyboard", response_model=list[StoryboardSequenceOut])
def storyboard(
    project_id: uuid.UUID, current: CurrentSessionDep, db: DbDep
) -> list[StoryboardSequenceOut]:
    """Séquences et plans avec leur version retenue : l'écran « Plans » du studio."""
    project, _access = project_access(db, current.user, project_id, Role.VIEWER)
    sequences = list(
        db.scalars(
            select(Sequence).where(Sequence.project_id == project.id).order_by(Sequence.order_index)
        )
    )
    shots = list(
        db.scalars(
            select(Shot)
            .where(Shot.sequence_id.in_([s.id for s in sequences]))
            .order_by(Shot.order_index)
        )
    )
    links = bible_links(db, (shot.id for shot in shots))
    counts = dict(
        db.execute(
            select(ShotVersion.shot_id, func.count())
            .where(ShotVersion.shot_id.in_([shot.id for shot in shots]))
            .group_by(ShotVersion.shot_id)
        ).all()
    )
    selected = {
        version.id: version
        for version in db.scalars(
            select(ShotVersion).where(
                ShotVersion.id.in_([s.selected_version_id for s in shots if s.selected_version_id])
            )
        )
    }
    by_sequence: dict[uuid.UUID, list[StoryboardShotOut]] = {s.id: [] for s in sequences}
    for shot in shots:
        chosen = selected.get(shot.selected_version_id) if shot.selected_version_id else None
        by_sequence[shot.sequence_id].append(
            StoryboardShotOut(
                **shot_out(shot, project, links.get(shot.id)).model_dump(),
                selected_version=(
                    SelectedVersionOut(
                        id=chosen.id,
                        number=chosen.number,
                        kind=chosen.kind,
                        asset_id=chosen.asset_id,
                    )
                    if chosen
                    else None
                ),
                version_count=int(counts.get(shot.id, 0)),
            )
        )
    return [
        StoryboardSequenceOut(
            id=sequence.id,
            name=sequence.name,
            order_index=sequence.order_index,
            shots=by_sequence[sequence.id],
        )
        for sequence in sequences
    ]


# --- Application des propositions de Claude ------------------------------------------------------


class ApplyIn(ApiModel):
    job_id: uuid.UUID


ENTRY_KINDS = {"characters": "character", "sets": "set", "props": "prop"}


def _completed_job(db: Session, project: Project, job_id: uuid.UUID, mode: str) -> GenerationJob:
    job = db.get(GenerationJob, job_id, with_for_update=True)
    if job is None or job.project_id != project.id or job.mode != mode:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Proposition introuvable")
    if job.status != "completed" or not isinstance(job.outputs.get("result"), dict):
        raise HTTPException(status.HTTP_409_CONFLICT, "Cette proposition n'est pas terminée")
    if job.outputs.get("appliedAt"):
        raise HTTPException(status.HTTP_409_CONFLICT, "Cette proposition a déjà été appliquée")
    return job


def _clip(value: Any, limit: int) -> str:
    return str(value or "").strip()[:limit]


def normalize_name(value: str) -> str:
    """Nom comparable : sans accents ni casse, sans intitulé de scène (INT. / EXT. … — NUIT)."""
    text = unicodedata.normalize("NFD", value.lower())
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = re.sub(r"^(int|ext|int\.?/ext)\.?\s+", "", text)
    text = re.split(r"\s+[\u2014\u2013-]\s+", text)[0]
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def match_entry(entries: list[BibleEntry], name: str) -> uuid.UUID | None:
    """Nom identique (normalisé) ; sinon un seul élément dont le nom contient l'autre."""
    wanted = normalize_name(name)
    if not wanted:
        return None
    exact = [e for e in entries if normalize_name(e.name) == wanted]
    if exact:
        return exact[0].id
    partial = [
        e
        for e in entries
        if (other := normalize_name(e.name)) and (wanted in other or other in wanted)
    ]
    return partial[0].id if len(partial) == 1 else None


def _link_by_names(
    db: Session, shot_id: uuid.UUID, names: dict[str, list[str]], entries: list[BibleEntry]
) -> None:
    existing = set(
        db.scalars(select(ShotBibleLink.entry_id).where(ShotBibleLink.shot_id == shot_id))
    )
    for key, kind in ENTRY_KINDS.items():
        candidates = [e for e in entries if e.kind == kind]
        for name in names.get(key, []):
            entry_id = match_entry(candidates, str(name))
            if entry_id is not None and entry_id not in existing:
                db.add(ShotBibleLink(shot_id=shot_id, entry_id=entry_id))
                existing.add(entry_id)


@router.post("/projects/{project_id}/breakdown/apply", response_model=list[StoryboardSequenceOut])
def apply_breakdown(
    project_id: uuid.UUID, body: ApplyIn, current: CurrentSessionDep, db: DbDep
) -> list[StoryboardSequenceOut]:
    """Crée les séquences et plans du découpage, à la suite de l'existant, en une transaction."""
    project, _access = project_access(db, current.user, project_id, Role.EDITOR, lock=True)
    job = _completed_job(db, project, body.job_id, "script_breakdown")
    result = job.outputs["result"]
    fps = project.fps_numerator / project.fps_denominator
    entries = project_bible(db, project.id)
    applied: dict[str, dict[str, list[str]]] = {}
    for s_index, raw in enumerate(result.get("sequences") or []):
        sequence = Sequence(
            project_id=project.id,
            name=_clip(raw.get("name"), 200) or f"Séquence {s_index + 1}",
            order_index=open_slot(db, Sequence, project.id, None),
        )
        db.add(sequence)
        db.flush()
        for p_index, item in enumerate(raw.get("shots") or []):
            seconds = item.get("durationSeconds")
            seconds = float(seconds) if isinstance(seconds, int | float) and seconds > 0 else 3.0
            approach = item.get("approach")
            shot = Shot(
                sequence_id=sequence.id,
                name=_clip(item.get("name"), 200) or f"Plan {p_index + 1}",
                order_index=p_index,
                duration_frames=max(1, round(min(seconds, 600) * fps)),
                description=_clip(item.get("description"), 20_000),
                intention=_clip(item.get("intention"), 20_000),
                dialogue=_clip(item.get("dialogue"), 20_000),
                shot_size=_clip(item.get("shotSize"), 80),
                camera=_clip(item.get("camera"), 20_000),
                approach=approach if approach in SHOT_APPROACHES else "image_to_video",
            )
            db.add(shot)
            db.flush()
            names = {key: [str(n) for n in item.get(key) or []][:20] for key in ENTRY_KINDS}
            _link_by_names(db, shot.id, names, entries)
            applied[str(shot.id)] = names
    job.outputs = {**job.outputs, "appliedAt": datetime.now(UTC).isoformat(), "applied": applied}
    db.commit()
    return storyboard(project_id, current, db)


@router.post("/projects/{project_id}/bible/apply", response_model=list[BibleEntryOut])
def apply_bible(
    project_id: uuid.UUID, body: ApplyIn, current: CurrentSessionDep, db: DbDep
) -> list[BibleEntry]:
    """Ajoute les éléments proposés absents de la bible, puis les relie aux plans découpés."""
    project, _access = project_access(db, current.user, project_id, Role.EDITOR, lock=True)
    job = _completed_job(db, project, body.job_id, "bible_from_script")
    result = job.outputs["result"]
    proposals: list[tuple[str, dict[str, Any]]] = []
    if isinstance(result.get("look"), dict):
        proposals.append(("look", result["look"]))
    for key, kind in ENTRY_KINDS.items():
        proposals += [(kind, item) for item in result.get(key) or [] if isinstance(item, dict)]
    taken = {(e.kind, normalize_name(e.name)) for e in project_bible(db, project.id)}
    counts: dict[str, int] = {}
    for kind, item in proposals:
        name = _clip(item.get("name"), 200) or ("LOOK du film" if kind == "look" else "")
        if not name or (kind, normalize_name(name)) in taken:
            continue
        taken.add((kind, normalize_name(name)))
        counts[kind] = counts.get(kind, 0) + 1
        db.add(
            BibleEntry(
                project_id=project.id,
                kind=kind,
                name=name,
                description=_clip(item.get("description"), 20_000),
                prompt=_clip(item.get("prompt"), 20_000),
                order_index=1000 + counts[kind],
            )
        )
    db.flush()
    # Les plans déjà découpés retrouvent leurs personnages, décors et accessoires par leur nom.
    entries = project_bible(db, project.id)
    breakdowns = db.scalars(
        select(GenerationJob).where(
            GenerationJob.project_id == project.id,
            GenerationJob.mode == "script_breakdown",
            GenerationJob.status == "completed",
        )
    )
    shot_ids = set(
        db.scalars(
            select(Shot.id)
            .join(Sequence, Sequence.id == Shot.sequence_id)
            .where(Sequence.project_id == project.id)
        )
    )
    for breakdown in breakdowns:
        for shot_id, names in (breakdown.outputs.get("applied") or {}).items():
            if uuid.UUID(shot_id) in shot_ids:
                _link_by_names(db, uuid.UUID(shot_id), names, entries)
    job.outputs = {**job.outputs, "appliedAt": datetime.now(UTC).isoformat()}
    db.commit()
    return project_bible(db, project.id)
