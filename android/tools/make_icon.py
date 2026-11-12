"""Пиксельная иконка «Цитадели» (без внешних библиотек)."""
import struct
import sys
import zlib

ART = [
    "................................",
    "................................",
    "................................",
    "..............r.................",
    "..............rrr...............",
    "..............rrrr..............",
    "..............l.................",
    "..............l.................",
    "....s.s.s.....l.......s.s.s.....",
    "....sssss....sss......sssss.....",
    "....sdsds...sssss.....sdsds.....",
    "....sssss..s.s.s.s....sssss.....",
    "....ssdss..sssssss....ssdss.....",
    "....sssss..sssdsss....sssss.....",
    "....sssss..sssssss....sssss.....",
    "....ssssssssssssssssssssssss....",
    "....ssssssssssssssssssssssss....",
    "....sssdssssssssssssssdsssss....",
    "....ssssssssssyyysssssssssss....",
    "....ssssssssssyyysssssssssss....",
    "....sssssssssbbbbbssssssssss....",
    "....sssssssssbbbbbssssssssss....",
    "..gggggggggggbbbbbgggggggggggg..",
    ".ggfggggggfgggggggggfgggggfgggg.",
    "gggggggfgggggggfgggggggggggggfgg",
    "ggfggggggggggggggggfggggfggggggg",
    "gggggfgggggfggggggggggggggggfggg",
    "gggggggggggggggggfgggggfgggggggg",
    "gfgggggfggggggggggggggggggfggggg",
    "gggggggggggfggggggfggggggggggfgg",
    "gggfggggggggggggggggggfggggggggg",
    "gggggggggfgggggfgggggggggggggggg",
]

PAL = {
    ".": (40, 46, 40),
    "s": (138, 132, 108),
    "d": (34, 32, 28),
    "r": (170, 36, 30),
    "l": (90, 80, 64),
    "y": (230, 190, 90),
    "b": (60, 50, 40),
    "g": (62, 70, 48),
    "f": (78, 88, 58),
}


def write_png(path, size):
    scale = size // len(ART)
    rows = []
    for y in range(size):
        row = bytearray([0])
        line = ART[min(y // scale, len(ART) - 1)]
        for x in range(size):
            c = PAL[line[min(x // scale, len(line) - 1)]]
            # лёгкая виньетка
            row += bytes(c)
        rows.append(bytes(row))
    raw = b"".join(rows)

    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


if __name__ == "__main__":
    write_png(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 192)
