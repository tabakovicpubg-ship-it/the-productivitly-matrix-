"""Draws the app icons (a tiny version of the board) as PNGs, no dependencies.

Run from the project root:  python3 tools/make_icons.py
"""

import math
import struct
import zlib
from pathlib import Path

BOARD = (28, 26, 24)
RED, GREEN, YELLOW, BLUE = (236, 107, 130), (76, 191, 98), (241, 218, 114), (125, 158, 227)
OUT = Path(__file__).resolve().parent.parent / "icons"


def quads(m):
    """Four slightly misaligned sheets of paper inside a margin m (0..0.5)."""
    a, b = m, 1 - m
    return [
        (RED, a, a + 0.006, 0.504, 0.504),
        (GREEN, 0.497, a - 0.004, b, 0.502),
        (YELLOW, a + 0.004, 0.5, 0.502, b),
        (BLUE, 0.5, 0.498, b - 0.004, b + 0.004),
    ]


def sample(u, v, sheets, tape):
    colour = BOARD
    for c, x0, y0, x1, y1 in sheets:
        if x0 <= u < x1 and y0 <= v < y1:
            colour = c
    cx, cy, hw, hh, ang = tape
    du, dv = u - cx, v - cy
    tu = du * math.cos(ang) + dv * math.sin(ang)
    tv = -du * math.sin(ang) + dv * math.cos(ang)
    if abs(tu) < hw and abs(tv) < hh:
        colour = tuple(round(ch + (255 - ch) * 0.45) for ch in colour)
    return colour


def render(size, margin):
    sheets = quads(margin)
    tape = (0.5, 0.5, 0.1 * (1 - margin * 2) / 0.76, 0.034 * (1 - margin * 2) / 0.76, math.radians(14))
    offsets = (0.25, 0.75)
    rows = []
    for y in range(size):
        row = bytearray(b"\x00")
        for x in range(size):
            acc = [0, 0, 0]
            for oy in offsets:
                for ox in offsets:
                    c = sample((x + ox) / size, (y + oy) / size, sheets, tape)
                    acc[0] += c[0]
                    acc[1] += c[1]
                    acc[2] += c[2]
            grain = ((x * 73856093) ^ (y * 19349663)) % 13 - 6
            row += bytes(max(0, min(255, ch // 4 + grain)) for ch in acc) + b"\xff"
        rows.append(bytes(row))
    return png(size, size, b"".join(rows))


def png(w, h, raw):
    def chunk(kind, data):
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    for name, size, margin in [
        ("icon-192.png", 192, 0.12),
        ("icon-512.png", 512, 0.12),
        ("icon-maskable-512.png", 512, 0.22),  # stays inside Android's round safe zone
        ("apple-touch-icon.png", 180, 0.12),
    ]:
        (OUT / name).write_bytes(render(size, margin))
        print("wrote", OUT / name)
