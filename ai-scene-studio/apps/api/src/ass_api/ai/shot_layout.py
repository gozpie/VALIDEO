"""Plateau d'un plan : de la description en pixels (image du plan) aux opérations de scène.

Chaque élément est donné par sa place dans l'image et sa distance à la caméra. Le calcul ci-dessous
est
le seul à décider des positions : vu de la caméra du plan, chaque élément retombe sur ses pixels,
même
si sa distance est approximative. Aucune lumière : l'éclairage neutre par défaut de l'éditeur et du
rendu garde le plateau lisible. Fonctions pures, sans navigateur ni service.
"""

import math
from dataclasses import dataclass
from typing import Any, Final

CAPTEUR_MM: Final = 36.0
PRIMITIVES: Final = {"boite": "cube", "boule": "sphere", "cylindre": "cylinder"}
MAX_OPERATIONS: Final = 150


@dataclass(frozen=True)
class CameraPlan:
    largeur: int
    hauteur: int
    focale_mm: float
    hauteur_m: float
    horizon_y: float

    @property
    def k(self) -> float:
        """Demi-largeur du cadre à 1 m."""
        return (CAPTEUR_MM / 2) / self.focale_mm

    @property
    def bascule(self) -> float:
        """Inclinaison vers le bas, en radians : l'horizon apparaît au-dessus du centre."""
        return math.atan((self.hauteur / 2 - self.horizon_y) / (self.largeur / 2) * self.k)

    def dans_camera(self, px: float, py: float, d: float) -> tuple[float, float]:
        """Point du pixel à la distance d de l'axe, en mètres, dans le repère de la caméra."""
        echelle = d * self.k / (self.largeur / 2)
        return (px - self.largeur / 2) * echelle, (self.hauteur / 2 - py) * echelle

    def monde(self, x: float, y: float, d: float) -> list[float]:
        """Repère de la scène : Y vers le haut, -Z vers l'avant."""
        c, s = math.cos(self.bascule), math.sin(self.bascule)
        return [x, self.hauteur_m + y * c - d * s, -(d * c + y * s)]

    def pixel(self, point: list[float]) -> tuple[float, float]:
        """Inverse de `monde` puis `dans_camera` : où un point de la scène tombe dans l'image."""
        c, s = math.cos(self.bascule), math.sin(self.bascule)
        x, y, z = point[0], point[1] - self.hauteur_m, -point[2]
        d = z * c - y * s
        cam_y = y * c + z * s
        echelle = d * self.k / (self.largeur / 2)
        return x / echelle + self.largeur / 2, self.hauteur / 2 - cam_y / echelle


def _couleur(valeur: Any) -> list[float]:
    if isinstance(valeur, list) and len(valeur) == 3:
        return [max(0.0, min(1.0, float(c))) for c in valeur]
    return [0.5, 0.5, 0.5]


def _volume(element: dict[str, Any], camera: CameraPlan) -> dict[str, Any]:
    """Boîte, boule ou cylindre dont la face avant couvre exactement sa boîte de pixels."""
    x0, y0, x1, y1 = (float(element[k]) for k in ("x0", "y0", "x1", "y1"))
    d = max(0.2, float(element["distanceM"]))
    gauche, haut = camera.dans_camera(x0, y0, d)
    droite, bas = camera.dans_camera(x1, y1, d)
    largeur, hauteur = max(droite - gauche, 0.005), max(haut - bas, 0.005)
    forme = PRIMITIVES.get(str(element.get("forme")), "cube")
    # Sans épaisseur donnée : mince pour une boîte, ronde pour une boule ou un cylindre.
    defaut = 0.1 if forme == "cube" else (largeur + hauteur) / 2
    profondeur = max(0.01, float(element.get("profondeurM") or defaut))
    # Une boîte part de sa face avant vers l'arrière ; une boule et un cylindre sont centrés.
    centre_d = d + profondeur / 2 if forme == "cube" else d
    return {
        "op": "add_primitive",
        "primitive": forme,
        "name": str(element["nom"])[:200],
        "position": camera.monde((gauche + droite) / 2, (haut + bas) / 2, centre_d),
        "rotationDegrees": [-math.degrees(camera.bascule), 0, 0],
        "scale": [largeur, hauteur, profondeur],
        "color": _couleur(element.get("couleur")),
    }


def _volume_de_biais(element: dict[str, Any], camera: CameraPlan) -> dict[str, Any]:
    """Boîte vue de biais : ses bords gauche et droit restent sur leurs pixels."""
    x0, y0, x1, y1 = (float(element[k]) for k in ("x0", "y0", "x1", "y1"))
    d_gauche = max(0.2, float(element["distanceM"]))
    d_droite = max(0.2, float(element["distanceDroiteM"]))
    y_milieu = (y0 + y1) / 2
    a = camera.monde(*camera.dans_camera(x0, y_milieu, d_gauche), d_gauche)
    b = camera.monde(*camera.dans_camera(x1, y_milieu, d_droite), d_droite)
    largeur = max(math.dist(a, b), 0.005)
    # Hauteur à mi-distance : la perspective fait converger le haut et le bas d'elle-même.
    d = (d_gauche + d_droite) / 2
    _, haut = camera.dans_camera(x0, y0, d)
    _, bas = camera.dans_camera(x0, y1, d)
    hauteur = max((haut - bas) * math.cos(camera.bascule), 0.005)
    profondeur = max(0.01, float(element.get("profondeurM") or 0.1))
    lacet = math.atan2(-(b[2] - a[2]), b[0] - a[0])
    # La face avant passe par A et B ; le volume s'étend derrière elle, loin de la caméra.
    normale = (-math.sin(lacet), -math.cos(lacet))
    return {
        "op": "add_primitive",
        "primitive": "cube",
        "name": str(element["nom"])[:200],
        "position": [
            (a[0] + b[0]) / 2 + normale[0] * profondeur / 2,
            (a[1] + b[1]) / 2,
            (a[2] + b[2]) / 2 + normale[1] * profondeur / 2,
        ],
        "rotationDegrees": [0, math.degrees(lacet), 0],
        "scale": [largeur, hauteur, profondeur],
        "color": _couleur(element.get("couleur")),
    }


def _sur_le_plan(camera: CameraPlan, px: float, py: float, y_plan: float) -> list[float] | None:
    """Point du sol ou d'un plateau horizontal vu à ce pixel : la ligne de vue coupe le plan."""
    # La distance où la ligne de vue atteint la hauteur voulue se résout directement.
    x1, y1 = camera.dans_camera(px, py, 1.0)
    c, s = math.cos(camera.bascule), math.sin(camera.bascule)
    pente = y1 * c - s
    if pente >= -1e-6:
        return None
    d = (y_plan - camera.hauteur_m) / pente
    return camera.monde(x1 * d, y1 * d, d)


def _plateau(element: dict[str, Any], camera: CameraPlan) -> list[dict[str, Any]]:
    """Table ou bureau : quatre coins dans l'image et une hauteur réelle, d'où un volume."""
    hauteur = float(element["hauteurM"])
    coins = [_sur_le_plan(camera, float(p[0]), float(p[1]), hauteur) for p in element["coins"][:4]]
    if len(coins) != 4 or any(c is None for c in coins):
        return []
    a, b, c, d = [point for point in coins if point is not None]
    # Grand côté : donne l'orientation ; les dimensions sont la moyenne des côtés opposés.
    longueur = (math.dist(a, b) + math.dist(d, c)) / 2
    largeur = (math.dist(b, c) + math.dist(a, d)) / 2
    lacet = math.atan2(-(b[2] - a[2] + c[2] - d[2]), b[0] - a[0] + c[0] - d[0])
    centre = [sum(p[i] for p in (a, b, c, d)) / 4 for i in range(3)]
    epaisseur = max(0.02, float(element.get("epaisseurM", 0.05)))
    couleur = _couleur(element.get("couleur"))
    nom = str(element["nom"])[:190]
    operations = [
        {
            "op": "add_primitive",
            "primitive": "cube",
            "name": nom,
            "position": [centre[0], hauteur - epaisseur / 2, centre[2]],
            "rotationDegrees": [0, math.degrees(lacet), 0],
            "scale": [longueur, epaisseur, largeur],
            "color": couleur,
        }
    ]
    if element.get("jusquAuSol") and hauteur - epaisseur > 0.02:
        pied = hauteur - epaisseur
        operations.append(
            {
                "op": "add_primitive",
                "primitive": "cube",
                "name": f"{nom} - caisson",
                "position": [centre[0], pied / 2, centre[2]],
                "rotationDegrees": [0, math.degrees(lacet), 0],
                "scale": [longueur * 0.98, pied, largeur * 0.98],
                "color": [v * 0.8 for v in couleur],
            }
        )
    return operations


def plateau_vers_operations(
    plateau: dict[str, Any], largeur: int, hauteur: int
) -> tuple[list[dict[str, Any]], list[str]]:
    """Opérations de la scène et, à part, ce qui a dû être ignoré."""
    cam = plateau["camera"]
    camera = CameraPlan(
        largeur,
        hauteur,
        max(8.0, float(cam["focaleMm"])),
        max(0.1, float(cam["hauteurM"])),
        float(cam["horizonY"]),
    )
    operations: list[dict[str, Any]] = [
        {
            "op": "add_camera",
            "name": "Caméra du plan",
            "position": [0, camera.hauteur_m, 0],
            "rotationDegrees": [-math.degrees(camera.bascule), 0, 0],
            "focalLengthMm": camera.focale_mm,
        },
        {"op": "set_active_camera", "target": "Caméra du plan"},
        {
            "op": "add_primitive",
            "primitive": "plane",
            "name": "Sol",
            "position": [0, 0, -6],
            "scale": [30, 1, 30],
            "color": _couleur(plateau.get("couleurSol", [0.25, 0.22, 0.2])),
        },
    ]
    ignores: list[str] = []
    for element in plateau.get("elements", []):
        try:
            if element.get("forme") == "plateau":
                operations += _plateau(element, camera)
            elif element.get("forme") == "boite" and element.get("distanceDroiteM"):
                operations.append(_volume_de_biais(element, camera))
            else:
                operations.append(_volume(element, camera))
        except (KeyError, TypeError, ValueError) as exc:
            ignores.append(f"{element.get('nom', '?')} : {exc}")
    return operations[:MAX_OPERATIONS], ignores
