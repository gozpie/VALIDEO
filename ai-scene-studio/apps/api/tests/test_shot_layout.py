"""Plateau d'un plan : chaque élément doit retomber sur ses pixels, vu de la caméra du plan."""

import math
from typing import Any

import pytest

from ass_api.ai.shot_layout import CameraPlan, plateau_vers_operations

CAMERA = {"focaleMm": 50, "hauteurM": 1.05, "horizonY": 188}
IMAGE = (1024, 576)


def _plan() -> CameraPlan:
    return CameraPlan(*IMAGE, 50, 1.05, 188)


def _coins(operation: dict[str, Any], camera: CameraPlan) -> tuple[float, float, float, float]:
    """Pixels de la face avant d'une boîte alignée sur la caméra."""
    x, y, z = operation["position"]
    largeur, hauteur, profondeur = operation["scale"]
    c, s = math.cos(camera.bascule), math.sin(camera.bascule)
    # Du centre à la face avant : vers la caméra, le long de son axe.
    avant = [x, y + profondeur / 2 * s, z + profondeur / 2 * c]
    haut_gauche = [
        avant[0] - largeur / 2,
        avant[1] + hauteur / 2 * c,
        avant[2] - hauteur / 2 * s,
    ]
    bas_droit = [
        avant[0] + largeur / 2,
        avant[1] - hauteur / 2 * c,
        avant[2] + hauteur / 2 * s,
    ]
    return (*camera.pixel(haut_gauche), *camera.pixel(bas_droit))


def test_pixel_is_the_inverse_of_placement() -> None:
    camera = _plan()
    for px, py, d in ((0, 0, 1.0), (512, 288, 2.0), (1000, 500, 7.5), (265, 182, 2.05)):
        x, y = camera.dans_camera(px, py, d)
        assert camera.pixel(camera.monde(x, y, d)) == pytest.approx((px, py), abs=1e-6)


def test_horizon_stays_at_camera_height() -> None:
    camera = _plan()
    x, y = camera.dans_camera(512, 188, 40)
    assert camera.monde(x, y, 40)[1] == pytest.approx(1.05, abs=1e-6)


@pytest.mark.parametrize("distance", [1.0, 2.05, 3.7, 40.0])
def test_a_box_falls_exactly_on_its_pixels_whatever_its_distance(distance: float) -> None:
    plateau = {
        "camera": CAMERA,
        "elements": [
            {
                "nom": "Cadre",
                "forme": "boite",
                "x0": 378,
                "y0": 10,
                "x1": 497,
                "y1": 165,
                "distanceM": distance,
                "profondeurM": 0.1,
                "couleur": [0.5, 0.4, 0.3],
            }
        ],
    }
    operations, ignored = plateau_vers_operations(plateau, *IMAGE)
    assert ignored == []
    boite = next(op for op in operations if op.get("name") == "Cadre")
    assert boite["rotationDegrees"][0] == pytest.approx(-math.degrees(_plan().bascule))
    assert _coins(boite, _plan()) == pytest.approx((378, 10, 497, 165), abs=1e-6)


def test_a_desk_lies_flat_at_its_height_and_covers_its_corners() -> None:
    plateau = {
        "camera": CAMERA,
        "elements": [
            {
                "nom": "Bureau",
                "forme": "plateau",
                "coins": [[450, 375], [1000, 435], [1000, 340], [500, 340]],
                "hauteurM": 0.77,
                "jusquAuSol": True,
                "couleur": [0.1, 0.1, 0.1],
            }
        ],
    }
    operations, ignored = plateau_vers_operations(plateau, *IMAGE)
    assert ignored == []
    dessus = next(op for op in operations if op.get("name") == "Bureau")
    caisson = next(op for op in operations if op.get("name") == "Bureau - caisson")
    assert dessus["position"][1] + dessus["scale"][1] / 2 == pytest.approx(0.77)
    assert caisson["position"][1] - caisson["scale"][1] / 2 == pytest.approx(0)
    # Son centre tombe entre ses coins, dans l'image.
    px, py = _plan().pixel([dessus["position"][0], 0.77, dessus["position"][2]])
    assert 450 < px < 1000
    assert 340 < py < 435


def test_a_corner_above_the_horizon_is_refused_not_invented() -> None:
    plateau = {
        "camera": CAMERA,
        "elements": [
            {
                "nom": "Impossible",
                "forme": "plateau",
                "coins": [[0, 10], [10, 10], [10, 20], [0, 20]],
                "hauteurM": 0.5,
                "couleur": [0, 0, 0],
            },
            {"nom": "Sans boîte", "forme": "boite", "couleur": [0, 0, 0]},
        ],
    }
    operations, ignored = plateau_vers_operations(plateau, *IMAGE)
    assert not any(op.get("name") == "Impossible" for op in operations)
    assert any("Sans boîte" in message for message in ignored)


def test_scene_has_camera_and_floor_and_no_light() -> None:
    operations, _ = plateau_vers_operations({"camera": CAMERA, "elements": []}, *IMAGE)
    assert [op["op"] for op in operations] == ["add_camera", "set_active_camera", "add_primitive"]
    assert operations[0]["focalLengthMm"] == 50
