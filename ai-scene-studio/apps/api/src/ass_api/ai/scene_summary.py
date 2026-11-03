"""Description textuelle d'une scène pour un modèle de langage (Claude), via le moteur Python."""

import math
from typing import Any

from ass_api.animation.evaluate import evaluate_frame, translation, world_matrix


def _vec(values: Any) -> str:
    return "(" + ", ".join(f"{v:.2f}" for v in values) + ")"


def _euler_degrees(q: list[float]) -> tuple[float, float, float]:
    x, y, z, w = q
    # Ordre XYZ (comme l'éditeur).
    m11 = 1 - 2 * (y * y + z * z)
    m12 = 2 * (x * y - z * w)
    m13 = 2 * (x * z + y * w)
    m23 = 2 * (y * z - x * w)
    m33 = 1 - 2 * (x * x + y * y)
    m22 = 1 - 2 * (x * x + z * z)
    m32 = 2 * (y * z + x * w)
    ry = math.asin(max(-1.0, min(1.0, m13)))
    if abs(m13) < 0.9999999:
        rx = math.atan2(-m23, m33)
        rz = math.atan2(-m12, m11)
    else:
        rx = math.atan2(m32, m22)
        rz = 0.0
    return (math.degrees(rx), math.degrees(ry), math.degrees(rz))


def describe_scene(scene: dict[str, Any], frame_start: int, frame_end: int) -> str:
    start = evaluate_frame(scene, frame_start)
    end = evaluate_frame(scene, frame_end)
    fps = scene["fps"]["numerator"] / scene["fps"]["denominator"]
    render = scene["renderSettings"]
    lines = [
        f"Plan de {scene['durationFrames']} frames à {fps:.3f} i/s, rendu {render['width']}x"
        f"{render['height']}. Frames considérées : {frame_start} à {frame_end}.",
        "Objets (nom — type — position monde au début → à la fin — échelle) :",
    ]
    materials = {m["id"]: m for m in scene["materials"]}
    for node in start["nodes"]:
        a = translation(world_matrix(start, node["id"]))
        b = translation(world_matrix(end, node["id"]))
        kind = node["primitive"] if node["type"] == "primitive" else node["type"]
        override = next((o for o in node["materialOverrides"] if o["slot"] == "*"), None)
        color = materials.get(override["materialId"]) if override else None
        extra = f", couleur linéaire {_vec(color['baseColor'])}" if color else ""
        hidden = "" if node["visible"] else " [masqué]"
        mode = " [proxy : non rendu]" if node["renderMode"] == "proxy" else ""
        lines.append(
            f"- {node['name']} — {kind} — {_vec(a)} → {_vec(b)} — "
            f"{_vec(node['transform']['scale'])}{extra}{hidden}{mode}"
        )
    for camera in start["cameras"]:
        later = next(c for c in end["cameras"] if c["id"] == camera["id"])
        a = translation(world_matrix(start, camera["id"]))
        b = translation(world_matrix(end, camera["id"]))
        active = " (caméra ACTIVE)" if camera["id"] == scene["activeCameraId"] else ""
        lines.append(
            f"Caméra « {camera['name']} »{active} : {camera['focalLengthMm']:.0f} → "
            f"{later['focalLengthMm']:.0f} mm, capteur {camera['sensorWidthMm']:.0f} mm, position "
            f"{_vec(a)} → {_vec(b)}, rotation locale (°) "
            f"{_vec(_euler_degrees(camera['transform']['rotation']))} → "
            f"{_vec(_euler_degrees(later['transform']['rotation']))}"
        )
    for light in start["lights"]:
        lines.append(
            f"Lumière « {light['name']} » ({light['kind']}, {light['intensity']:.1f}) en "
            f"{_vec(translation(world_matrix(start, light['id'])))}"
        )
    if scene["markers"]:
        marks = ", ".join(f"{m['label']} @ {m['frame']}" for m in scene["markers"])
        lines.append(f"Marqueurs : {marks}")
    return "\n".join(lines)
