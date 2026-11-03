"""Validation serveur des scènes : fixtures valides, cas invalides partagés avec TypeScript."""

import copy
import json
from pathlib import Path
from typing import Any

import pytest

from ass_api.scenes.validation import (
    SceneValidationError,
    canonical_json,
    parse_snapshot,
    scene_issues,
)

ROOT = Path(__file__).resolve().parents[3]
FIXTURES = ROOT / "tests/fixtures/scenes"
SHARED = json.loads((FIXTURES / "invalid-cases.json").read_text(encoding="utf-8"))
EMBEDDED_SCHEMA = ROOT / "apps/api/src/ass_api/scenes/scene.v1.schema.json"
GENERATED_SCHEMA = ROOT / "packages/scene-schema/schema/scene.v1.schema.json"


def _load(name: str) -> dict[str, Any]:
    data: dict[str, Any] = json.loads((FIXTURES / name).read_text(encoding="utf-8"))
    return data


def test_embedded_schema_matches_generated_one() -> None:
    assert EMBEDDED_SCHEMA.read_bytes() == GENERATED_SCHEMA.read_bytes(), "pnpm schema:generate"


@pytest.mark.parametrize("name", ["empty.v1.json", "cube-camera-animated.v1.json"])
def test_valid_fixtures(name: str) -> None:
    assert scene_issues(_load(name)) == []


@pytest.mark.parametrize("case", SHARED["cases"], ids=lambda case: case["name"])
def test_shared_invalid_cases(case: dict[str, Any]) -> None:
    scene = copy.deepcopy(_load(SHARED["base"]))
    for mutation in case["set"]:
        target: Any = scene
        for key in mutation["path"][:-1]:
            target = target[key]
        target[mutation["path"][-1]] = mutation["value"]
    paths = [issue.path for issue in scene_issues(scene)]
    assert case["expectedPath"] in paths


def test_non_finite_numbers_are_rejected() -> None:
    with pytest.raises(SceneValidationError, match="invalide"):
        parse_snapshot(b'{"durationFrames": NaN}')


def test_oversized_snapshot_is_rejected() -> None:
    with pytest.raises(SceneValidationError):
        parse_snapshot(b" " * (5 * 1024 * 1024 + 1))


def test_canonical_json_is_order_independent() -> None:
    assert canonical_json({"b": 1, "a": [1, 2]}) == canonical_json({"a": [1, 2], "b": 1})
    assert canonical_json({"a": "é"}) == '{"a":"é"}'.encode()
