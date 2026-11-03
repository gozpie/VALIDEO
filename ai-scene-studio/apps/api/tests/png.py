"""Décodage minimal d'un PNG 8 bits RGBA/RGB non entrelacé (tests de cohérence), sans dépendance."""

import struct
import zlib
from pathlib import Path


def read_png(path: Path) -> tuple[int, int, int, list[bytes]]:
    """(largeur, hauteur, canaux, lignes de pixels)."""
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("Pas un PNG")
    offset, idat = 8, b""
    width = height = channels = 0
    while offset < len(data):
        length, kind = struct.unpack(">I4s", data[offset : offset + 8])
        chunk = data[offset + 8 : offset + 8 + length]
        if kind == b"IHDR":
            width, height, depth, color, _c, _f, interlace = struct.unpack(">IIBBBBB", chunk)
            if depth != 8 or interlace != 0 or color not in (2, 6):
                raise ValueError("PNG 8 bits RGB/RGBA non entrelacé attendu")
            channels = 4 if color == 6 else 3
        elif kind == b"IDAT":
            idat += chunk
        offset += 12 + length
    raw = zlib.decompress(idat)
    stride = width * channels
    rows: list[bytes] = []
    previous = bytearray(stride)
    for y in range(height):
        start = y * (stride + 1)
        kind = raw[start]
        line = bytearray(raw[start + 1 : start + 1 + stride])
        for i in range(stride):
            left = line[i - channels] if i >= channels else 0
            up = previous[i]
            corner = previous[i - channels] if i >= channels else 0
            if kind == 1:
                line[i] = (line[i] + left) & 0xFF
            elif kind == 2:
                line[i] = (line[i] + up) & 0xFF
            elif kind == 3:
                line[i] = (line[i] + (left + up) // 2) & 0xFF
            elif kind == 4:
                p = left + up - corner
                pa, pb, pc = abs(p - left), abs(p - up), abs(p - corner)
                predictor = left if pa <= pb and pa <= pc else up if pb <= pc else corner
                line[i] = (line[i] + predictor) & 0xFF
        rows.append(bytes(line))
        previous = line
    return width, height, channels, rows


def alpha_centroid(path: Path) -> tuple[float, float, int]:
    """Barycentre (x, y) en pixels des pixels couverts (alpha > 127) et leur nombre."""
    width, _height, channels, rows = read_png(path)
    assert channels == 4
    sx = sy = 0.0
    n = 0
    for y, row in enumerate(rows):
        for x in range(width):
            if row[x * 4 + 3] > 127:
                sx += x + 0.5
                sy += y + 0.5
                n += 1
    if n == 0:
        raise AssertionError(f"Aucun pixel couvert dans {path.name}")
    return sx / n, sy / n, n
