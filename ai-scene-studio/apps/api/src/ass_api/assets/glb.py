"""Validation des fichiers GLB (glTF 2.0 binaire) avant stockage.

Un GLB accepté est autonome : aucune ressource externe (``uri``) n'est autorisée, ce qui empêche le
navigateur ou un worker d'aller chercher des fichiers arbitraires. Les extensions obligatoires qui
exigent un décodeur non fourni (Draco, meshopt…) sont refusées avec un message explicite. Un GLB ne
contient pas de script ; rien n'est jamais exécuté.
"""

import json
import struct
from typing import Any, BinaryIO, Final

GLB_MAGIC: Final = b"glTF"
CHUNK_JSON: Final = 0x4E4F534A
CHUNK_BIN: Final = 0x004E4942
MAX_JSON_CHUNK_BYTES: Final = 64 * 1024 * 1024
# Extensions obligatoires prises en charge par le chargeur du navigateur sans décodeur additionnel.
SUPPORTED_REQUIRED_EXTENSIONS: Final = frozenset(
    {
        "KHR_materials_unlit",
        "KHR_materials_emissive_strength",
        "KHR_materials_ior",
        "KHR_materials_specular",
        "KHR_materials_transmission",
        "KHR_materials_volume",
        "KHR_materials_clearcoat",
        "KHR_materials_sheen",
        "KHR_texture_transform",
        "KHR_mesh_quantization",
    }
)


class InvalidModelError(ValueError):
    pass


def _uris(document: dict[str, Any]) -> list[str]:
    found: list[str] = []
    for collection in ("buffers", "images"):
        for index, item in enumerate(document.get(collection) or []):
            if isinstance(item, dict) and "uri" in item:
                found.append(f"{collection}[{index}]")
    return found


def inspect_glb(stream: BinaryIO, size: int) -> dict[str, Any]:
    """Vérifie l'en-tête, les chunks et le contenu JSON ; renvoie des métadonnées descriptives."""
    stream.seek(0)
    header = stream.read(12)
    if len(header) < 12 or header[:4] != GLB_MAGIC:
        raise InvalidModelError("Ce fichier n'est pas un GLB (en-tête glTF absent)")
    version, declared_length = struct.unpack("<II", header[4:12])
    if version != 2:
        raise InvalidModelError(f"Version glTF {version} non prise en charge (2 attendue)")
    if declared_length != size:
        raise InvalidModelError("Longueur déclarée incohérente : fichier tronqué ou corrompu")

    chunk_header = stream.read(8)
    if len(chunk_header) < 8:
        raise InvalidModelError("Chunk JSON absent")
    json_length, json_type = struct.unpack("<II", chunk_header)
    if json_type != CHUNK_JSON or json_length > MAX_JSON_CHUNK_BYTES or 20 + json_length > size:
        raise InvalidModelError("Chunk JSON invalide")
    try:
        document = json.loads(stream.read(json_length).decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as exc:
        raise InvalidModelError("JSON glTF illisible") from exc
    if not isinstance(document, dict) or (document.get("asset") or {}).get("version") != "2.0":
        raise InvalidModelError('Document glTF 2.0 attendu (asset.version = "2.0")')

    position = 20 + json_length
    if position < size:
        stream.seek(position)
        bin_header = stream.read(8)
        if len(bin_header) < 8:
            raise InvalidModelError("Chunk binaire tronqué")
        bin_length, bin_type = struct.unpack("<II", bin_header)
        if bin_type != CHUNK_BIN or position + 8 + bin_length > size:
            raise InvalidModelError("Chunk binaire invalide")

    external = _uris(document)
    if external:
        raise InvalidModelError(
            "Le GLB doit être autonome : ressources externes refusées (" + ", ".join(external) + ")"
        )
    required = set(document.get("extensionsRequired") or [])
    unsupported = sorted(required - SUPPORTED_REQUIRED_EXTENSIONS)
    if unsupported:
        raise InvalidModelError("Extensions non prises en charge : " + ", ".join(unsupported))

    def count(key: str) -> int:
        value = document.get(key)
        return len(value) if isinstance(value, list) else 0

    generator = (document.get("asset") or {}).get("generator")
    return {
        "format": "glb",
        "generator": generator if isinstance(generator, str) else None,
        "nodeCount": count("nodes"),
        "meshCount": count("meshes"),
        "materialCount": count("materials"),
        "textureCount": count("textures"),
        "animationCount": count("animations"),
        "extensionsUsed": sorted(set(document.get("extensionsUsed") or [])),
    }
