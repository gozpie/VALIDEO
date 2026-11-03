"""Le portage Python de l'évaluation reproduit les références produites par TypeScript."""

import json
from pathlib import Path
from typing import Any

import pytest

from ass_api.animation.evaluate import evaluate_frame, translation, world_matrix

FIXTURES = Path(__file__).resolve().parents[3] / "tests/fixtures"


def _load(path: str) -> Any:
    return json.loads((FIXTURES / path).read_text(encoding="utf-8"))


def _flat(value: Any) -> list[float]:
    if isinstance(value, bool):
        return [float(value)]
    if isinstance(value, int | float):
        return [float(value)]
    if isinstance(value, list):
        return [x for item in value for x in _flat(item)]
    return [x for item in value.values() for x in _flat(item)]


def test_cube_camera_reference() -> None:
    scene = _load("scenes/cube-camera-animated.v2.json")
    expected = _load("animation/cube-camera-animated.expected.json")
    for frame, values in expected.items():
        evaluated = evaluate_frame(scene, float(frame))
        got = {
            "cube": evaluated["nodes"][1]["transform"],
            "camera": {
                "transform": evaluated["cameras"][0]["transform"],
                "focalLengthMm": evaluated["cameras"][0]["focalLengthMm"],
            },
        }
        assert _flat(got) == pytest.approx(_flat(values), abs=1e-9), frame


def test_look_at_reference() -> None:
    scene = _load("scenes/look-at.v2.json")
    expected = _load("animation/look-at.expected.json")
    for frame, entities in expected.items():
        evaluated = evaluate_frame(scene, float(frame))
        by_id = {e["id"]: e for key in ("nodes", "cameras", "lights") for e in evaluated[key]}
        for entity_id, values in entities.items():
            entity = by_id[entity_id]
            got: dict[str, Any] = {
                "transform": entity["transform"],
                "world": list(translation(world_matrix(evaluated, entity_id))),
            }
            if "visible" in entity:
                got["visible"] = entity["visible"]
            if "focalLengthMm" in entity:
                got["focalLengthMm"] = entity["focalLengthMm"]
                got["rollRadians"] = entity["rollRadians"]
            assert list(got) == list(values), (frame, entity_id)
            assert _flat(got) == pytest.approx(_flat(values), abs=1e-9), (frame, entity_id)


def test_input_is_not_modified() -> None:
    scene = _load("scenes/look-at.v2.json")
    before = json.dumps(scene, sort_keys=True)
    evaluate_frame(scene, 30)
    assert json.dumps(scene, sort_keys=True) == before


def test_long_bezier_handles_are_scaled_like_blender() -> None:
    from ass_api.animation.evaluate import evaluate_track

    def track(offset: float) -> dict[str, Any]:
        return {
            "valueType": "scalar",
            "extrapolation": "constant",
            "keyframes": [
                {
                    "frame": 0,
                    "value": 0,
                    "interpolation": "bezier",
                    "inHandle": None,
                    "outHandle": {"frameOffset": offset, "valueOffset": [offset]},
                },
                {
                    "frame": 30,
                    "value": 30,
                    "interpolation": "linear",
                    "inHandle": {"frameOffset": -offset, "valueOffset": [-offset]},
                    "outHandle": None,
                },
            ],
        }

    assert evaluate_track(track(30), 7) == pytest.approx(evaluate_track(track(15), 7), abs=1e-12)
    assert evaluate_track(track(30), 10) == pytest.approx(10, abs=1e-9)
