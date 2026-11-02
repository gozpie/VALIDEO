"""Contrat inter-langages : le JSON Schema généré côté TypeScript valide les fixtures partagées."""

import json
from pathlib import Path
from typing import Any

import pytest
from jsonschema import Draft202012Validator, FormatChecker

ROOT = Path(__file__).resolve().parents[3]
SCHEMA_PATH = ROOT / "packages/scene-schema/schema/scene.v1.schema.json"
FIXTURES = sorted((ROOT / "tests/fixtures/scenes").glob("*.v1.json"))


@pytest.fixture(scope="module")
def validator() -> Draft202012Validator:
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema, format_checker=FormatChecker())


def _load(path: Path) -> dict[str, Any]:
    data: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    return data


def test_fixtures_exist() -> None:
    assert len(FIXTURES) >= 2


@pytest.mark.parametrize("fixture", FIXTURES, ids=lambda p: p.name)
def test_fixture_matches_schema(validator: Draft202012Validator, fixture: Path) -> None:
    errors = [error.message for error in validator.iter_errors(_load(fixture))]
    assert errors == []


def test_rejects_float_frame(validator: Draft202012Validator) -> None:
    scene = _load(ROOT / "tests/fixtures/scenes/cube-camera-animated.v1.json")
    scene["animations"][0]["keyframes"][0]["frame"] = 1.5
    assert not validator.is_valid(scene)


def test_rejects_other_up_axis(validator: Draft202012Validator) -> None:
    scene = _load(ROOT / "tests/fixtures/scenes/empty.v1.json")
    scene["coordinateSystem"]["upAxis"] = "+Z"
    assert not validator.is_valid(scene)
