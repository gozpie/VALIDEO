"""Liste de montage d'un projet : les plans dans l'ordre du film, avec le média à monter.

Pour chaque plan, le média est la version retenue, sinon la dernière version générée ; un plan sans
version garde sa place (`media` vide) pour que la durée du film reste juste. Cette liste alimente
le pont gozCut, l'écran Montage et les exports.
"""

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ass_api.db.models import Asset, Project, Sequence, Shot, ShotVersion


def build_edit_list(db: Session, project: Project) -> dict[str, Any]:
    default_fps = project.fps_numerator / project.fps_denominator
    rows = db.execute(
        select(Shot, Sequence)
        .join(Sequence, Sequence.id == Shot.sequence_id)
        .where(Sequence.project_id == project.id)
        .order_by(Sequence.order_index, Shot.order_index)
    ).all()
    shot_ids = [shot.id for shot, _sequence in rows]
    versions: dict[uuid.UUID, list[ShotVersion]] = {}
    for version in db.scalars(
        select(ShotVersion)
        .where(ShotVersion.shot_id.in_(shot_ids))
        .order_by(ShotVersion.number.desc())
    ):
        versions.setdefault(version.shot_id, []).append(version)
    assets = {
        asset.id: asset
        for asset in db.scalars(
            select(Asset).where(
                Asset.id.in_([v.asset_id for items in versions.values() for v in items])
            )
        )
    }
    items: list[dict[str, Any]] = []
    sequence_numbers: dict[uuid.UUID, int] = {}
    position = 0
    for shot, sequence in rows:
        if sequence.id not in sequence_numbers:
            sequence_numbers[sequence.id] = len(sequence_numbers) + 1
            position = 0
        position += 1
        candidates = versions.get(shot.id, [])
        chosen = next(
            (v for v in candidates if v.id == shot.selected_version_id),
            candidates[0] if candidates else None,
        )
        fps = (
            shot.fps_numerator / shot.fps_denominator
            if shot.fps_numerator and shot.fps_denominator
            else default_fps
        )
        media = None
        if chosen is not None and chosen.asset_id in assets:
            asset = assets[chosen.asset_id]
            media = {
                "assetId": str(asset.id),
                "kind": chosen.kind,
                "mimeType": asset.mime_type,
                "versionNumber": chosen.number,
                "retained": chosen.id == shot.selected_version_id,
            }
        items.append(
            {
                "shotId": str(shot.id),
                "label": f"{sequence_numbers[sequence.id]}.{position}",
                "name": shot.name,
                "sequence": sequence.name,
                "status": shot.status,
                "seconds": shot.duration_frames / fps,
                "media": media,
            }
        )
    return {
        "project": project.name,
        "fps": default_fps,
        "width": project.resolution_width,
        "height": project.resolution_height,
        "items": items,
    }
