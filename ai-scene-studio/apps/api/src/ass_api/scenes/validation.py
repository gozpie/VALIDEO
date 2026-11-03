"""Validation des scènes côté serveur : structure (JSON Schema généré depuis Zod) et intégrité.

Les règles d'intégrité reproduisent ``packages/scene-schema/src/validate.ts`` ; les deux
implémentations sont testées sur les mêmes cas (``tests/fixtures/scenes/invalid-cases.json``).
Les chemins d'erreur ont la même forme qu'en TypeScript : ``nodes.0.parentId``.
"""

import json
import math
from dataclasses import dataclass
from functools import cache
from importlib.resources import files
from typing import Any, Final

from jsonschema import Draft202012Validator, FormatChecker

QUATERNION_NORM_TOLERANCE: Final = 1e-4
MAX_SNAPSHOT_BYTES: Final = 5 * 1024 * 1024

ANIMATABLE_PROPERTIES: Final[dict[str, tuple[str, tuple[str, ...]]]] = {
    "transform.position": ("vec3", ("node", "camera", "light")),
    "transform.rotation": ("quaternion", ("node", "camera", "light")),
    "transform.scale": ("vec3", ("node", "camera", "light")),
    "visible": ("boolean", ("node", "light")),
    "camera.focalLengthMm": ("scalar", ("camera",)),
    "camera.focusDistance": ("scalar", ("camera",)),
    "camera.aperture": ("scalar", ("camera",)),
    "light.intensity": ("scalar", ("light",)),
    "light.color": ("vec3", ("light",)),
    "material.opacity": ("scalar", ("material",)),
}
VALUE_DIMENSIONS: Final = {"scalar": 1, "vec3": 3, "quaternion": 4, "boolean": 1}


@dataclass(frozen=True, slots=True)
class SceneIssue:
    path: str
    message: str


class SceneValidationError(ValueError):
    def __init__(self, issues: list[SceneIssue]) -> None:
        super().__init__(f"Scène invalide ({len(issues)} problème(s))")
        self.issues = issues


@cache
def _validator() -> Draft202012Validator:
    schema = json.loads(
        files("ass_api.scenes").joinpath("scene.v1.schema.json").read_text(encoding="utf-8")
    )
    return Draft202012Validator(schema, format_checker=FormatChecker())


def _path(*parts: object) -> str:
    return ".".join(str(part) for part in parts)


def _is_unit_quaternion(value: object) -> bool:
    return (
        isinstance(value, list)
        and len(value) == 4
        and all(isinstance(c, int | float) and not isinstance(c, bool) for c in value)
        and abs(math.hypot(*value) - 1) <= QUATERNION_NORM_TOLERANCE
    )


def _is_value_of_type(value: object, value_type: str) -> bool:
    if value_type == "scalar":
        return isinstance(value, int | float) and not isinstance(value, bool)
    if value_type == "boolean":
        return isinstance(value, bool)
    if value_type == "vec3":
        return isinstance(value, list) and len(value) == 3
    return _is_unit_quaternion(value)


class _Checker:
    def __init__(self, scene: dict[str, Any]) -> None:
        self.scene = scene
        self.issues: list[SceneIssue] = []

    def add(self, path: str, message: str) -> None:
        self.issues.append(SceneIssue(path, message))

    def run(self) -> list[SceneIssue]:
        kinds = self._unique_ids()
        self._quaternions()
        self._hierarchy()
        self._nodes()
        self._cameras_and_lights()
        for index, track in enumerate(self.scene["animations"]):
            self._track(track, index, kinds)
        self._render_settings()
        return self.issues

    def _unique_ids(self) -> dict[str, str]:
        kinds: dict[str, str] = {}
        for key, kind in (
            ("nodes", "node"),
            ("cameras", "camera"),
            ("lights", "light"),
            ("materials", "material"),
            ("animations", "other"),
            ("references", "other"),
        ):
            for index, item in enumerate(self.scene[key]):
                if item["id"] in kinds:
                    self.add(
                        _path(key, index, "id"),
                        f"Identifiant dupliqué dans la scène : {item['id']}",
                    )
                kinds[item["id"]] = kind
        return kinds

    def _quaternions(self) -> None:
        # Le JSON Schema ne porte pas la contrainte de norme (raffinement Zod).
        for key in ("nodes", "cameras", "lights"):
            for index, item in enumerate(self.scene[key]):
                if not _is_unit_quaternion(item["transform"]["rotation"]):
                    self.add(
                        _path(key, index, "transform", "rotation"),
                        "Le quaternion doit être normalisé (norme = 1)",
                    )

    def _hierarchy(self) -> None:
        parent_of = {node["id"]: node["parentId"] for node in self.scene["nodes"]}

        def check_parent(key: str, index: int, parent_id: str | None) -> None:
            if parent_id is not None and parent_id not in parent_of:
                self.add(_path(key, index, "parentId"), f"Parent inexistant : {parent_id}")

        for index, node in enumerate(self.scene["nodes"]):
            check_parent("nodes", index, node["parentId"])
            seen = {node["id"]}
            current = node["parentId"]
            while current is not None:
                if current in seen:
                    self.add(
                        _path("nodes", index, "parentId"),
                        f"Cycle de parentage détecté pour le nœud {node['id']}",
                    )
                    break
                seen.add(current)
                current = parent_of.get(current)
        for key in ("cameras", "lights"):
            for index, item in enumerate(self.scene[key]):
                check_parent(key, index, item["parentId"])

    def _nodes(self) -> None:
        material_ids = {material["id"] for material in self.scene["materials"]}
        pass_indices: dict[int, int] = {}
        for index, node in enumerate(self.scene["nodes"]):
            if (node["type"] == "primitive") != (node["primitive"] is not None):
                self.add(
                    _path("nodes", index, "primitive"),
                    'Le champ primitive est requis pour type="primitive" et interdit sinon',
                )
            if node["type"] in ("model", "image_plane") and node["assetId"] is None:
                self.add(
                    _path("nodes", index, "assetId"),
                    f"Un nœud de type {node['type']} doit référencer un asset",
                )
            for override_index, override in enumerate(node["materialOverrides"]):
                if override["materialId"] not in material_ids:
                    self.add(
                        _path("nodes", index, "materialOverrides", override_index, "materialId"),
                        f"Matériau inexistant : {override['materialId']}",
                    )
            pass_index = node["passIndex"]
            if pass_index > 0:
                if pass_index in pass_indices:
                    self.add(
                        _path("nodes", index, "passIndex"),
                        f"passIndex {pass_index} déjà utilisé par le nœud "
                        f"#{pass_indices[pass_index]}",
                    )
                pass_indices[pass_index] = index

    def _cameras_and_lights(self) -> None:
        for index, camera in enumerate(self.scene["cameras"]):
            if camera["farClip"] <= camera["nearClip"]:
                self.add(
                    _path("cameras", index, "farClip"),
                    "farClip doit être strictement supérieur à nearClip",
                )
            if (camera["projection"] == "orthographic") != (
                camera["orthographicHeight"] is not None
            ):
                self.add(
                    _path("cameras", index, "orthographicHeight"),
                    "orthographicHeight est requis en projection orthographique et interdit sinon",
                )
        for index, light in enumerate(self.scene["lights"]):
            inner, outer = light["innerConeAngle"], light["outerConeAngle"]
            if light["kind"] != "spot":
                if inner is not None or outer is not None:
                    self.add(
                        _path("lights", index, "outerConeAngle"),
                        "Les angles de cône sont réservés aux lumières de type spot",
                    )
            elif inner is None or outer is None:
                self.add(
                    _path("lights", index, "outerConeAngle"),
                    "Les angles de cône sont requis pour un spot",
                )
            elif inner > outer:
                self.add(
                    _path("lights", index, "innerConeAngle"),
                    "innerConeAngle doit être inférieur ou égal à outerConeAngle",
                )

    def _track(self, track: dict[str, Any], index: int, kinds: dict[str, str]) -> None:
        base = ("animations", index)
        target_kind = kinds.get(track["targetId"])
        if target_kind is None or target_kind == "other":
            self.add(_path(*base, "targetId"), f"Cible inexistante : {track['targetId']}")
        prop = ANIMATABLE_PROPERTIES.get(track["propertyPath"])
        if prop is None:
            self.add(
                _path(*base, "propertyPath"), f"Propriété non animable : {track['propertyPath']}"
            )
            return
        expected_type, targets = prop
        if expected_type != track["valueType"]:
            self.add(
                _path(*base, "valueType"), f"{track['propertyPath']} attend le type {expected_type}"
            )
        if target_kind not in (None, "other") and target_kind not in targets:
            self.add(
                _path(*base, "propertyPath"),
                f"{track['propertyPath']} n'est pas applicable à une cible de type {target_kind}",
            )
        dims = VALUE_DIMENSIONS[track["valueType"]]
        previous: dict[str, Any] | None = None
        for key_index, key in enumerate(track["keyframes"]):
            key_base = (*base, "keyframes", key_index)
            if previous is not None and key["frame"] <= previous["frame"]:
                self.add(
                    _path(*key_base, "frame"),
                    "Les keyframes doivent être triés par frame strictement croissante",
                )
            if not _is_value_of_type(key["value"], track["valueType"]):
                self.add(
                    _path(*key_base, "value"),
                    f"Valeur incompatible avec le type {track['valueType']}",
                )
            if track["valueType"] == "boolean" and key["interpolation"] != "step":
                self.add(
                    _path(*key_base, "interpolation"),
                    "Une piste booléenne n'accepte que l'interpolation \"step\"",
                )
            if track["valueType"] == "quaternion" and key["interpolation"] == "bezier":
                self.add(
                    _path(*key_base, "interpolation"),
                    "Bézier non supporté sur une rotation : utiliser linear (slerp) ou ease_*",
                )
            for handle_key in ("inHandle", "outHandle"):
                handle = key[handle_key]
                if handle is None:
                    continue
                if key["interpolation"] != "bezier" and handle_key == "outHandle":
                    self.add(
                        _path(*key_base, handle_key),
                        'outHandle n\'est autorisé que pour une interpolation "bezier"',
                    )
                if len(handle["valueOffset"]) != dims:
                    self.add(
                        _path(*key_base, handle_key, "valueOffset"),
                        f"valueOffset doit avoir {dims} composante(s)",
                    )
            previous = key

    def _render_settings(self) -> None:
        settings = self.scene["renderSettings"]
        if settings["frameEnd"] < settings["frameStart"]:
            self.add("renderSettings.frameEnd", "frameEnd doit être supérieur ou égal à frameStart")
        if settings["frameEnd"] >= self.scene["durationFrames"]:
            self.add(
                "renderSettings.frameEnd",
                "frameEnd doit être strictement inférieur à durationFrames",
            )


def _reject_constant(value: str) -> float:
    raise ValueError(f"Valeur numérique non finie interdite : {value}")


def parse_snapshot(raw: bytes) -> object:
    """Décode un snapshot JSON en refusant NaN et Infinity (absents du JSON standard)."""
    if len(raw) > MAX_SNAPSHOT_BYTES:
        raise SceneValidationError([SceneIssue("", "Scène trop volumineuse (5 Mo maximum)")])
    try:
        return json.loads(raw, parse_constant=_reject_constant)
    except ValueError as exc:
        raise SceneValidationError([SceneIssue("", f"JSON invalide : {exc}")]) from exc


def scene_issues(scene: object) -> list[SceneIssue]:
    """Problèmes de structure, puis d'intégrité si la structure est correcte."""
    structural = sorted(_validator().iter_errors(scene), key=lambda error: list(error.path))
    if structural:
        return [SceneIssue(_path(*error.path), error.message) for error in structural]
    assert isinstance(scene, dict)  # noqa: S101 (garanti par le schéma : type object)
    return _Checker(scene).run()


def validate_scene(scene: object) -> dict[str, Any]:
    issues = scene_issues(scene)
    if issues:
        raise SceneValidationError(issues)
    assert isinstance(scene, dict)  # noqa: S101
    return scene


def asset_references(scene: dict[str, Any]) -> list[tuple[str, str]]:
    """Couples (chemin, assetId) de tous les assets référencés par la scène."""
    found: list[tuple[str, str]] = []
    for index, node in enumerate(scene["nodes"]):
        if node["assetId"] is not None:
            found.append((_path("nodes", index, "assetId"), node["assetId"]))
    for index, material in enumerate(scene["materials"]):
        for key in ("baseColorTextureAssetId", "normalTextureAssetId"):
            if material[key] is not None:
                found.append((_path("materials", index, key), material[key]))
    for index, reference in enumerate(scene["references"]):
        found.append((_path("references", index, "assetId"), reference["assetId"]))
    return found


def canonical_json(scene: dict[str, Any]) -> bytes:
    """Sérialisation canonique (clés triées, sans espaces) : base de l'empreinte SHA-256."""
    return json.dumps(scene, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
