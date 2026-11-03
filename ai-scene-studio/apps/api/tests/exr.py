"""Lecture minimale de l'en-tête d'un fichier OpenEXR (noms des canaux), sans dépendance."""

import struct
from typing import IO


def exr_channels(stream: IO[bytes]) -> list[str]:
    if stream.read(4) != b"\x76\x2f\x31\x01":
        raise ValueError("Pas un fichier OpenEXR")
    flags = struct.unpack("<I", stream.read(4))[0]
    multipart = bool(flags & 0x1000)
    channels: list[str] = []

    def read_string() -> bytes:
        value = b""
        while (byte := stream.read(1)) not in (b"\x00", b""):
            value += byte
        return value

    while True:
        name = read_string()
        if not name:
            if multipart and channels:
                break
            if multipart:
                continue
            break
        kind = read_string()
        size = struct.unpack("<I", stream.read(4))[0]
        data = stream.read(size)
        if kind == b"chlist":
            offset = 0
            while offset < len(data) and data[offset] != 0:
                end = data.index(b"\x00", offset)
                channels.append(data[offset:end].decode())
                offset = end + 1 + 16
    return channels
