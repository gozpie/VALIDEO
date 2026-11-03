"""Validation des GLB (sans base ni stockage)."""

import io
import struct

import pytest

from ass_api.assets.glb import InvalidModelError, inspect_glb

from .glb_factory import build_glb, cube_glb


def _inspect(data: bytes) -> dict[str, object]:
    return inspect_glb(io.BytesIO(data), len(data))


def test_cube_is_accepted_with_metadata() -> None:
    metadata = _inspect(cube_glb())
    assert metadata["meshCount"] == 1
    assert metadata["materialCount"] == 1
    assert metadata["generator"] == "ai-scene-studio tests"


@pytest.mark.parametrize(
    ("data", "message"),
    [
        (b"PK\x03\x04" + b"\x00" * 40, "pas un GLB"),
        (b"glTF" + struct.pack("<II", 1, 20) + b"\x00" * 8, "Version"),
        (cube_glb()[:-4], "Longueur"),
        (build_glb({"asset": {"version": "1.0"}}), "glTF 2.0"),
        (
            build_glb({"asset": {"version": "2.0"}, "buffers": [{"uri": "http://x/y.bin"}]}),
            "externes",
        ),
        (
            build_glb({"asset": {"version": "2.0"}, "images": [{"uri": "../secret.png"}]}),
            "externes",
        ),
        (
            build_glb(
                {"asset": {"version": "2.0"}, "extensionsRequired": ["KHR_draco_mesh_compression"]}
            ),
            "KHR_draco_mesh_compression",
        ),
    ],
)
def test_invalid_files_are_rejected(data: bytes, message: str) -> None:
    with pytest.raises(InvalidModelError, match=message):
        _inspect(data)


def test_corrupted_json_chunk_is_rejected() -> None:
    data = bytearray(cube_glb())
    data[20:24] = b"\xff\xfe\xfd\xfc"
    with pytest.raises(InvalidModelError):
        _inspect(bytes(data))
