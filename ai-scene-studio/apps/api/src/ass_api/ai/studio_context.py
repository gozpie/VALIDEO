"""Documents du studio transmis aux modèles : brief du projet, script, bible, fiche d'un plan.

Les images de référence d'un plan sont les images clés des éléments de bible liés au plan, dans un
ordre stable (LOOK, personnages, décors, accessoires) : `plan.md` les annonce comme @image1,
@image2… et la génération d'image ou de vidéo les envoie dans ce même ordre.
"""

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from ass_api.db.models import (
    BibleEntry,
    Project,
    ProjectScript,
    Sequence,
    Shot,
    ShotBibleLink,
)

KIND_LABELS = {"look": "LOOK", "character": "Personnages", "set": "Décors", "prop": "Accessoires"}
KIND_ORDER = {"look": 0, "character": 1, "set": 2, "prop": 3}


def _sorted(entries: list[BibleEntry]) -> list[BibleEntry]:
    return sorted(entries, key=lambda e: (KIND_ORDER[e.kind], e.order_index, e.name.lower()))


def project_brief(project: Project) -> str:
    fps = project.fps_numerator / project.fps_denominator
    lines = [
        f"Projet « {project.name} » : {project.resolution_width} x "
        f"{project.resolution_height}, {fps:g} images/s."
    ]
    if project.description.strip():
        lines.append(f"Note du projet : {project.description.strip()}")
    return "\n".join(lines)


def latest_script(
    db: Session, project_id: uuid.UUID, script_id: uuid.UUID | None = None
) -> ProjectScript | None:
    query = select(ProjectScript).where(ProjectScript.project_id == project_id)
    if script_id is not None:
        query = query.where(ProjectScript.id == script_id)
    return db.scalars(query.order_by(ProjectScript.version.desc()).limit(1)).first()


def bible_document(entries: list[BibleEntry]) -> str:
    if not entries:
        return ""
    parts = ["# Bible du film"]
    current = ""
    for entry in _sorted(entries):
        if entry.kind != current:
            current = entry.kind
            parts.append(f"\n## {KIND_LABELS[entry.kind]}")
        parts.append(f"\n### {entry.name}")
        if entry.description.strip():
            parts.append(entry.description.strip())
        if entry.prompt.strip():
            parts.append(f"Prompt : {entry.prompt.strip()}")
    return "\n".join(parts) + "\n"


def shot_reference_entries(db: Session, shot: Shot) -> list[BibleEntry]:
    """Éléments liés au plan qui ont une image clé, dans l'ordre des @imageN."""
    entries = list(
        db.scalars(
            select(BibleEntry)
            .join(ShotBibleLink, ShotBibleLink.entry_id == BibleEntry.id)
            .where(ShotBibleLink.shot_id == shot.id)
        )
    )
    return [entry for entry in _sorted(entries) if entry.key_asset_id is not None]


def shot_document(db: Session, shot: Shot) -> str:
    sequence = db.get(Sequence, shot.sequence_id)
    assert sequence is not None  # noqa: S101
    siblings = list(
        db.scalars(select(Shot).where(Shot.sequence_id == sequence.id).order_by(Shot.order_index))
    )
    index = next(i for i, s in enumerate(siblings) if s.id == shot.id)
    linked = list(
        db.scalars(
            select(BibleEntry)
            .join(ShotBibleLink, ShotBibleLink.entry_id == BibleEntry.id)
            .where(ShotBibleLink.shot_id == shot.id)
        )
    )
    look = db.scalars(
        select(BibleEntry).where(
            BibleEntry.project_id == sequence.project_id, BibleEntry.kind == "look"
        )
    ).first()
    references = shot_reference_entries(db, shot)
    lines = [
        f"# Plan « {shot.name} » — séquence « {sequence.name} » "
        f"(plan {index + 1} sur {len(siblings)})",
        f"Valeur : {shot.shot_size or '—'}",
        f"Caméra : {shot.camera or '—'}",
        f"Mode de fabrication : {shot.approach}",
        "",
        "## Description",
        shot.description or "(vide)",
        "",
        f"## Intention\n{shot.intention or '—'}",
    ]
    if shot.dialogue.strip():
        lines += ["", f"## Dialogue / voix off\n{shot.dialogue}"]
    for label, neighbor in (
        ("Plan précédent", siblings[index - 1] if index > 0 else None),
        ("Plan suivant", siblings[index + 1] if index + 1 < len(siblings) else None),
    ):
        if neighbor is not None:
            lines += ["", f"## {label} : « {neighbor.name} »", neighbor.description[:1500]]
    if look is not None:
        lines += ["", "## LOOK du film (à recopier en tête du prompt image)", look.prompt]
    if linked:
        lines += ["", "## Éléments de bible présents dans le plan"]
        for entry in _sorted(linked):
            lines.append(f"- {KIND_LABELS[entry.kind]} « {entry.name} » : {entry.prompt}")
    if references:
        lines += ["", "## Images de référence envoyées avec la génération"]
        for number, entry in enumerate(references, start=1):
            lines.append(f"- @image{number} = {entry.name}")
    return "\n".join(lines) + "\n"
