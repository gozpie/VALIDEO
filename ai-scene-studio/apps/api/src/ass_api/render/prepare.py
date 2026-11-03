"""Description de scène pour Blender, produite à partir du document canonique.

Le script Blender (`workers/render-worker/blender/build_scene.py`) ne fait que traduire cette
description : toutes les décisions de correspondance sont prises ici, en Python testé.

- Clés natives (courbes Blender) pour la position, l'échelle, la focale, l'ouverture, la mise au
  point, l'intensité des lumières, l'opacité et la visibilité : le .blend reste éditable dans
  Blender. Équivalences exactes : step = CONSTANT, linear = LINEAR, Bézier = BEZIER (poignées
  libres), ease_* = CUBIC + easing, cycle = modificateur Cycles.
- Rotations animées et caméras contraintes (visée, roulis) : une clé par frame, calculée par le
  portage Python du moteur (`ass_api.animation`), car Blender n'interpole pas par slerp.
- Unités des lumières (comme l'importeur glTF de Blender) : soleil = lux / 683 (W/m2) ;
  ponctuelle et projecteur = candela x 4 pi / 683 (W).
"""

import math
from typing import Any, Final

from ass_api.animation.evaluate import evaluate_frame

LUMENS_PER_WATT: Final = 683.0
NATIVE_PATHS: Final = {
    "transform.position": ("location", 1.0),
    "transform.scale": ("scale", 1.0),
    "visible": ("visible", 1.0),
    "camera.focalLengthMm": ("lens", 1.0),
    "camera.aperture": ("fstop", 1.0),
    "camera.focusDistance": ("focus_distance", 1.0),
    "material.opacity": ("alpha", 1.0),
}
VIEW_TRANSFORMS: Final = {
    "srgb": "Standard",
    "rec709": "Standard",
    "agx": "AgX",
    "filmic": "Filmic",
}


def light_factor(kind: str) -> float:
    return 1 / LUMENS_PER_WATT if kind == "directional" else 4 * math.pi / LUMENS_PER_WATT


def _bakes_rotation(scene: dict[str, Any], entity: dict[str, Any], kind: str) -> bool:
    animated = any(
        t["targetId"] == entity["id"] and t["propertyPath"] == "transform.rotation"
        for t in scene["animations"]
    )
    return animated or (kind == "camera" and entity.get("lookAtTargetId") is not None)


def _native_track(track: dict[str, Any], factor: float) -> dict[str, Any] | None:
    """Courbe native, ou None si la piste doit être échantillonnée (pas d'équivalent exact)."""
    keys = track["keyframes"]
    if track["extrapolation"] == "linear" and any(
        k["interpolation"] == "bezier" for k in (keys[0], keys[-2] if len(keys) > 1 else keys[0])
    ):
        # Blender extrapole une Bézier selon sa poignée, le moteur selon le segment.
        return None
    return {
        "extrapolation": track["extrapolation"],
        "factor": factor,
        "keyframes": keys,
    }


def build_description(
    scene: dict[str, Any],
    settings: dict[str, Any],
    asset_paths: dict[str, str],
) -> dict[str, Any]:
    frame_start, frame_end = settings["frameStart"], settings["frameEnd"]
    # Frames explicites (préparation IA : première et dernière image), sinon toute la plage.
    frames = sorted(set(settings.get("frames") or range(frame_start, frame_end + 1)))
    evaluated = {frame: evaluate_frame(scene, frame) for frame in frames}
    tracks: dict[str, dict[str, Any]] = {}
    for track in scene["animations"]:
        tracks.setdefault(track["targetId"], {})[track["propertyPath"]] = track

    def sampled(entity_id: str, kind: str, getter: Any) -> dict[str, Any]:
        collection = {"node": "nodes", "camera": "cameras", "light": "lights"}[kind]
        return {
            str(frame): getter(
                next(e for e in evaluated[frame][collection] if e["id"] == entity_id)
            )
            for frame in frames
        }

    def animation(entity: dict[str, Any], kind: str) -> dict[str, Any]:
        result: dict[str, Any] = {"native": {}, "sampled": {}}
        own = tracks.get(entity["id"], {})
        for path, track in own.items():
            if path == "transform.rotation" or path == "camera.rollRadians":
                continue
            if path in ("light.intensity", "light.color"):
                factor = light_factor(entity["kind"]) if path == "light.intensity" else 1.0
                name = "energy" if path == "light.intensity" else "color"
            elif path in NATIVE_PATHS:
                name, factor = NATIVE_PATHS[path]
            else:
                continue
            native = _native_track(track, factor)
            if native is not None:
                result["native"][name] = native
            else:
                field = path.split(".")[-1]
                result["sampled"][name] = sampled(
                    entity["id"],
                    kind,
                    lambda e, f=field, p=path, k=factor: (
                        [v * k for v in e["transform"][f]]
                        if p.startswith("transform.")
                        else e[f] * k
                    ),
                )
        if _bakes_rotation(scene, entity, kind):
            result["sampled"]["rotation"] = sampled(
                entity["id"], kind, lambda e: e["transform"]["rotation"]
            )
        return result

    materials = {m["id"]: m for m in scene["materials"]}
    nodes = []
    for node in scene["nodes"]:
        override = next((o for o in node["materialOverrides"] if o["slot"] == "*"), None)
        nodes.append(
            {
                **{
                    k: node[k] for k in ("id", "name", "type", "parentId", "primitive", "transform")
                },
                "visible": node["visible"],
                "castShadow": node["castShadow"],
                "passIndex": node["passIndex"],
                # Un objet « proxy » guide la composition sans être rendu.
                "rendered": node["renderMode"] != "proxy",
                "material": materials.get(override["materialId"]) if override else None,
                "modelPath": asset_paths.get(node["assetId"]) if node["assetId"] else None,
                "animation": animation(node, "node"),
            }
        )
    width = scene["renderSettings"]["width"]
    height = scene["renderSettings"]["height"]
    cameras = [
        {
            **camera,
            # Ajustement horizontal : en orthographique, l'échelle Blender couvre la largeur.
            "orthoScale": (camera["orthographicHeight"] or 1) * width / height,
            "animation": animation(camera, "camera"),
        }
        for camera in scene["cameras"]
    ]
    lights = [
        {
            **light,
            "energy": light["intensity"] * light_factor(light["kind"]),
            "animation": animation(light, "light"),
        }
        for light in scene["lights"]
    ]
    render = scene["renderSettings"]
    return {
        "format": "ai-scene-studio/blender-scene@1",
        "fps": scene["fps"],
        "frameStart": frame_start,
        "frameEnd": frame_end,
        "renderFrames": frames,
        "conditioningMaps": bool(settings.get("conditioningMaps")),
        "activeCameraId": scene["activeCameraId"],
        "render": {
            "width": width,
            "height": height,
            "resolutionPercent": settings["resolutionPercent"],
            "samples": settings["samples"],
            "transparentBackground": render["transparentBackground"],
            "motionBlur": render["motionBlur"],
            "antiAliasing": render["antiAliasing"],
            "viewTransform": VIEW_TRANSFORMS[render["colorManagement"]["displayTransform"]],
            "passes": settings["passes"],
        },
        "previewLighting": not any(light["visible"] for light in scene["lights"]),
        "nodes": nodes,
        "cameras": cameras,
        "lights": lights,
    }
