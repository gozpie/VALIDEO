"""Évaluation d'une scène à une frame : animation puis contrainte de visée (comme en TypeScript)."""

import copy
import math
from typing import Any

from ass_api.animation.math3d import (
    Mat4,
    compose,
    look_at_quaternion,
    multiply,
    quat_from_axis_angle,
    quat_inverse,
    quat_multiply,
    quat_normalize,
    rotation_quaternion,
    translation,
)

__all__ = ["evaluate_frame", "evaluate_track", "slerp", "translation", "world_matrix"]

COMPONENTS = {"scalar": 1, "vec3": 3, "quaternion": 4, "boolean": 1}


def _ease(name: str, t: float) -> float:
    if name == "ease_in":
        return t * t * t
    if name == "ease_out":
        return 1 - (1 - t) ** 3
    return 4 * t * t * t if t < 0.5 else 1 - (-2 * t + 2) ** 3 / 2


def _progress(interpolation: str, t: float) -> float:
    if interpolation == "step":
        return 0.0
    if interpolation in ("linear", "bezier"):
        return t
    return _ease(interpolation, t)


def slerp(a: list[float], b: list[float], t: float) -> list[float]:
    bx, by, bz, bw = b
    cos = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw
    if cos < 0:
        bx, by, bz, bw = -bx, -by, -bz, -bw
        cos = -cos
    if cos > 0.9995:
        wa, wb = 1 - t, t
    else:
        angle = math.acos(cos)
        sin = math.sin(angle)
        wa = math.sin((1 - t) * angle) / sin
        wb = math.sin(t * angle) / sin
    q = [wa * a[0] + wb * bx, wa * a[1] + wb * by, wa * a[2] + wb * bz, wa * a[3] + wb * bw]
    norm = math.hypot(*q)
    return [c / norm for c in q]


def _to_list(value: Any, n: int) -> list[float]:
    if isinstance(value, bool):
        return [1.0 if value else 0.0]
    if isinstance(value, int | float):
        return [float(value)]
    return [float(v) for v in value[:n]]


def _cubic(p0: float, p1: float, p2: float, p3: float, t: float) -> float:
    u = 1 - t
    return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3


def bezier_segment(start: dict[str, Any], end: dict[str, Any], frame: float, n: int) -> list[float]:
    span = end["frame"] - start["frame"]
    v0 = _to_list(start["value"], n)
    v1 = _to_list(end["value"], n)
    out, inn = start["outHandle"], end["inHandle"]
    x1 = start["frame"] + min(max(out["frameOffset"] if out else span / 3, 0), span)
    x2 = end["frame"] + max(min(inn["frameOffset"] if inn else -span / 3, 0), -span)
    lo, hi = 0.0, 1.0
    for _ in range(50):
        mid = (lo + hi) / 2
        if _cubic(start["frame"], x1, x2, end["frame"], mid) < frame:
            lo = mid
        else:
            hi = mid
    t = (lo + hi) / 2
    result = []
    for index, a in enumerate(v0):
        b = v1[index] if index < len(v1) else 0.0
        c1 = a + (out["valueOffset"][index] if out else (b - a) / 3)
        c2 = b + (inn["valueOffset"][index] if inn else (a - b) / 3)
        result.append(_cubic(a, c1, c2, b, t))
    return result


def _as_value(track: dict[str, Any], numbers: list[float]) -> Any:
    kind = track["valueType"]
    if kind == "scalar":
        return numbers[0]
    if kind == "boolean":
        return numbers[0] >= 0.5
    return list(numbers)


def _segment(track: dict[str, Any], a: dict[str, Any], b: dict[str, Any], frame: float) -> Any:
    t = (frame - a["frame"]) / (b["frame"] - a["frame"])
    if track["valueType"] == "boolean" or a["interpolation"] == "step":
        return a["value"]
    if track["valueType"] == "quaternion":
        return slerp(a["value"], b["value"], _progress(a["interpolation"], t))
    n = COMPONENTS[track["valueType"]]
    if a["interpolation"] == "bezier":
        return _as_value(track, bezier_segment(a, b, frame, n))
    k = _progress(a["interpolation"], t)
    va, vb = _to_list(a["value"], n), _to_list(b["value"], n)
    return _as_value(track, [x + (vb[i] - x) * k for i, x in enumerate(va)])


def evaluate_track(track: dict[str, Any], frame: float) -> Any:
    keys = track["keyframes"]
    first, last = keys[0], keys[-1]
    if len(keys) == 1:
        return first["value"]
    f = frame
    if track["extrapolation"] == "cycle" and (f < first["frame"] or f > last["frame"]):
        span = last["frame"] - first["frame"]
        f = first["frame"] + ((f - first["frame"]) % span + span) % span
    if f <= first["frame"] or f >= last["frame"]:
        before = f <= first["frame"]
        edge = first if before else last
        neighbour = keys[1] if before else keys[-2]
        if track["extrapolation"] == "linear" and track["valueType"] in ("scalar", "vec3"):
            n = COMPONENTS[track["valueType"]]
            ve, vn = _to_list(edge["value"], n), _to_list(neighbour["value"], n)
            slope = [(ve[i] - vn[i]) / (edge["frame"] - neighbour["frame"]) for i in range(n)]
            return _as_value(track, [ve[i] + slope[i] * (f - edge["frame"]) for i in range(n)])
        return edge["value"]
    lo, hi = 0, len(keys) - 1
    while hi - lo > 1:
        mid = (lo + hi) >> 1
        if keys[mid]["frame"] <= f:
            lo = mid
        else:
            hi = mid
    return _segment(track, keys[lo], keys[hi], f)


def _entities(scene: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {e["id"]: e for key in ("nodes", "cameras", "lights") for e in scene[key]}


def _assign(scene: dict[str, Any], track: dict[str, Any], value: Any) -> None:
    target_id = track["targetId"]
    target = _entities(scene).get(target_id)
    path = track["propertyPath"]
    if path.startswith("transform.") and target is not None:
        target["transform"][path.split(".")[1]] = list(value)
    elif path == "visible" and target is not None and "visible" in target:
        target["visible"] = bool(value)
    elif path.startswith("camera.") and target is not None:
        key = path.split(".")[1]
        target[key] = value if key == "rollRadians" else max(value, 1e-6)
    elif path == "light.intensity" and target is not None:
        target["intensity"] = max(value, 0)
    elif path == "light.color" and target is not None:
        target["color"] = [max(c, 0) for c in value]
    elif path == "material.opacity":
        for material in scene["materials"]:
            if material["id"] == target_id:
                material["opacity"] = min(max(value, 0), 1)


def world_matrix(scene: dict[str, Any], entity_id: str) -> Mat4:
    entity = _entities(scene)[entity_id]
    t = entity["transform"]
    local = compose(t["position"], t["rotation"], t["scale"])
    parent = entity["parentId"]
    return local if parent is None else multiply(world_matrix(scene, parent), local)


def _apply_look_at(scene: dict[str, Any], camera: dict[str, Any]) -> None:
    target_id = camera["lookAtTargetId"]
    if target_id is None or target_id not in _entities(scene):
        return
    eye = translation(world_matrix(scene, camera["id"]))
    target = translation(world_matrix(scene, target_id))
    direction = [target[i] - eye[i] for i in range(3)]
    distance = math.hypot(*direction)
    if distance * distance < 1e-12:
        return
    up = (0.0, 0.0, -1.0) if abs(direction[1] / distance) > 0.9999 else (0.0, 1.0, 0.0)
    world = look_at_quaternion(eye, target, up)
    world = quat_multiply(world, quat_from_axis_angle((0.0, 0.0, 1.0), camera["rollRadians"]))
    parent = camera["parentId"]
    parent_rotation = (
        (0.0, 0.0, 0.0, 1.0) if parent is None else rotation_quaternion(world_matrix(scene, parent))
    )
    local = quat_normalize(quat_multiply(quat_inverse(parent_rotation), world))
    camera["transform"] = {**camera["transform"], "rotation": list(local)}


def evaluate_frame(scene: dict[str, Any], frame: float) -> dict[str, Any]:
    """Nouvelle scène évaluée à la frame (l'entrée n'est pas modifiée)."""
    if not math.isfinite(frame):
        raise ValueError("Frame non finie")
    evaluated = copy.deepcopy(scene)
    for track in scene["animations"]:
        _assign(evaluated, track, evaluate_track(track, frame))
    for camera in evaluated["cameras"]:
        _apply_look_at(evaluated, camera)
    return evaluated
