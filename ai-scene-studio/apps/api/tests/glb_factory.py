"""Fabrique de fichiers GLB pour les tests (glTF 2.0 binaire minimal, sans dépendance)."""

import json
import struct
from typing import Any


def _pad(data: bytes, filler: bytes) -> bytes:
    return data + filler * (-len(data) % 4)


def build_glb(document: dict[str, Any], binary: bytes = b"") -> bytes:
    json_chunk = _pad(json.dumps(document, separators=(",", ":")).encode(), b" ")
    chunks = struct.pack("<II", len(json_chunk), 0x4E4F534A) + json_chunk
    if binary:
        bin_chunk = _pad(binary, b"\x00")
        chunks += struct.pack("<II", len(bin_chunk), 0x004E4942) + bin_chunk
    return b"glTF" + struct.pack("<II", 2, 12 + len(chunks)) + chunks


def cube_glb(color: tuple[float, float, float, float] = (0.8, 0.2, 0.1, 1.0)) -> bytes:
    """Cube de 1 m centré à l'origine (24 sommets, normales, 12 triangles), un matériau PBR."""
    faces = [
        ((1, 0, 0), (0, 1, 0), (0, 0, 1)),
        ((-1, 0, 0), (0, 1, 0), (0, 0, -1)),
        ((0, 1, 0), (0, 0, -1), (1, 0, 0)),
        ((0, -1, 0), (0, 0, 1), (1, 0, 0)),
        ((0, 0, 1), (0, 1, 0), (-1, 0, 0)),
        ((0, 0, -1), (0, 1, 0), (1, 0, 0)),
    ]
    positions: list[float] = []
    normals: list[float] = []
    indices: list[int] = []
    for normal, up, right in faces:
        base = len(positions) // 3
        for su, sr in ((-1, -1), (-1, 1), (1, 1), (1, -1)):
            positions += [0.5 * (normal[i] + su * up[i] + sr * right[i]) for i in range(3)]
            normals += list(normal)
        indices += [base, base + 1, base + 2, base, base + 2, base + 3]
    pos = struct.pack(f"<{len(positions)}f", *positions)
    nor = struct.pack(f"<{len(normals)}f", *normals)
    idx = struct.pack(f"<{len(indices)}H", *indices)
    document = {
        "asset": {"version": "2.0", "generator": "ai-scene-studio tests"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": "Cube"}],
        "meshes": [
            {
                "primitives": [
                    {"attributes": {"POSITION": 0, "NORMAL": 1}, "indices": 2, "material": 0}
                ]
            }
        ],
        "materials": [
            {"pbrMetallicRoughness": {"baseColorFactor": list(color), "metallicFactor": 0}}
        ],
        "buffers": [{"byteLength": len(pos) + len(nor) + len(idx)}],
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0, "byteLength": len(pos), "target": 34962},
            {"buffer": 0, "byteOffset": len(pos), "byteLength": len(nor), "target": 34962},
            {
                "buffer": 0,
                "byteOffset": len(pos) + len(nor),
                "byteLength": len(idx),
                "target": 34963,
            },
        ],
        "accessors": [
            {
                "bufferView": 0,
                "componentType": 5126,
                "count": 24,
                "type": "VEC3",
                "min": [-0.5, -0.5, -0.5],
                "max": [0.5, 0.5, 0.5],
            },
            {"bufferView": 1, "componentType": 5126, "count": 24, "type": "VEC3"},
            {"bufferView": 2, "componentType": 5123, "count": 36, "type": "SCALAR"},
        ],
    }
    return build_glb(document, pos + nor + idx)


if __name__ == "__main__":
    import sys
    from pathlib import Path

    Path(sys.argv[1]).write_bytes(cube_glb())
