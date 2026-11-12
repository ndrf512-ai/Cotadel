"""Минимальный кодировщик бинарного AndroidManifest.xml и resources.arsc.

В окружении сборки нет aapt2, поэтому бинарные форматы Android
собираются вручную. Поддерживается ровно то, что нужно игре:
манифест с литеральными значениями и одна ресурсная запись (иконка).
"""
import struct

ANDROID_NS = "http://schemas.android.com/apk/res/android"

# Идентификаторы атрибутов android:* (android.R.attr)
ATTR_IDS = {
    "theme": 0x01010000,
    "label": 0x01010001,
    "icon": 0x01010002,
    "name": 0x01010003,
    "hasCode": 0x0101000C,
    "exported": 0x01010010,
    "screenOrientation": 0x0101001E,
    "configChanges": 0x0101001F,
    "launchMode": 0x0101001D,
    "minSdkVersion": 0x0101020C,
    "versionCode": 0x0101021B,
    "versionName": 0x0101021C,
    "targetSdkVersion": 0x01010270,
    "hardwareAccelerated": 0x010102D3,
    "glEsVersion": 0x01010281,
    "required": 0x0101028E,
    "roundIcon": 0x0101052C,
}

T_REFERENCE = 0x01
T_STRING = 0x03
T_INT_DEC = 0x10
T_INT_HEX = 0x11
T_BOOL = 0x12


class Str(str):
    pass


class Ref(int):
    pass


class Hex(int):
    pass


def _pad4(b: bytes) -> bytes:
    return b + b"\0" * ((4 - len(b) % 4) % 4)


def string_pool(strings, utf8=False):
    offsets, data = [], b""
    for s in strings:
        offsets.append(len(data))
        if utf8:
            enc = s.encode("utf-8")
            n = len(s)
            u = len(enc)
            def ln(v):
                return bytes([v]) if v < 0x80 else bytes([(v >> 8) | 0x80, v & 0xFF])
            data += ln(n) + ln(u) + enc + b"\0"
        else:
            enc = s.encode("utf-16-le")
            n = len(enc) // 2
            assert n < 0x8000
            data += struct.pack("<H", n) + enc + b"\0\0"
    data = _pad4(data)
    header_size = 28
    strings_start = header_size + 4 * len(strings)
    body = b"".join(struct.pack("<I", o) for o in offsets) + data
    size = header_size + len(body)
    flags = 0x100 if utf8 else 0
    hdr = struct.pack("<HHIIIIII", 0x0001, header_size, size, len(strings), 0, flags, strings_start, 0)
    return hdr + body


class Element:
    def __init__(self, tag, attrs=None, children=None):
        self.tag = tag
        self.attrs = attrs or {}
        self.children = children or []


def encode_manifest(root: Element) -> bytes:
    # Порядок пула: сначала android-атрибуты (для карты ресурсов), затем прочее.
    attr_names = []

    def collect(e):
        for k in e.attrs:
            if k.startswith("android:"):
                n = k[8:]
                if n not in attr_names:
                    attr_names.append(n)
        for c in e.children:
            collect(c)

    collect(root)
    attr_names.sort(key=lambda n: ATTR_IDS[n])
    pool = list(attr_names)

    def idx(s):
        if s not in pool:
            pool.append(s)
        return pool.index(s)

    for s in ("android", ANDROID_NS):
        idx(s)

    chunks = []
    line = [1]

    def emit(e):
        attrs = []
        for k, v in e.attrs.items():
            if k.startswith("android:"):
                ns, name = idx(ANDROID_NS), idx(k[8:])
                rid = ATTR_IDS[k[8:]]
            else:
                ns, name, rid = 0xFFFFFFFF, idx(k), 0xFFFFFFFF
            if isinstance(v, bool):
                raw, t, d = 0xFFFFFFFF, T_BOOL, 0xFFFFFFFF if v else 0
            elif isinstance(v, Ref):
                raw, t, d = 0xFFFFFFFF, T_REFERENCE, int(v)
            elif isinstance(v, Hex):
                raw, t, d = 0xFFFFFFFF, T_INT_HEX, int(v)
            elif isinstance(v, int):
                raw, t, d = 0xFFFFFFFF, T_INT_DEC, int(v)
            else:
                si = idx(str(v))
                raw, t, d = si, T_STRING, si
            attrs.append((rid, ns, name, raw, t, d))
        attrs.sort(key=lambda a: a[0])
        body = b"".join(struct.pack("<IIIHBBI", ns, name, raw, 8, 0, t, d) for _, ns, name, raw, t, d in attrs)
        tag = idx(e.tag)
        hdr = struct.pack("<HHIII", 0x0102, 16, 36 + len(body), line[0], 0xFFFFFFFF)
        ext = struct.pack("<IIHHHHHH", 0xFFFFFFFF, tag, 20, 20, len(attrs), 0, 0, 0)
        chunks.append(hdr + ext + body)
        line[0] += 1
        for c in e.children:
            emit(c)
        chunks.append(struct.pack("<HHIIIII", 0x0103, 16, 24, line[0], 0xFFFFFFFF, 0xFFFFFFFF, tag))
        line[0] += 1

    emit(root)
    ns_start = struct.pack("<HHIIIII", 0x0100, 16, 24, 1, 0xFFFFFFFF, idx("android"), idx(ANDROID_NS))
    ns_end = struct.pack("<HHIIIII", 0x0101, 16, 24, line[0], 0xFFFFFFFF, idx("android"), idx(ANDROID_NS))
    sp = string_pool(pool)
    resmap_body = b"".join(struct.pack("<I", ATTR_IDS[n]) for n in attr_names)
    resmap = struct.pack("<HHI", 0x0180, 8, 8 + len(resmap_body)) + resmap_body
    body = sp + resmap + ns_start + b"".join(chunks) + ns_end
    return struct.pack("<HHI", 0x0003, 8, 8 + len(body)) + body


def encode_arsc(package: str, files):
    """resources.arsc с одним типом «mipmap»: files = [(entry_name, path)]. ID: 0x7f01NNNN."""
    gpool = string_pool([p for _, p in files], utf8=True)
    type_pool = string_pool(["mipmap"], utf8=True)
    key_pool = string_pool([n for n, _ in files], utf8=True)
    n = len(files)
    spec = struct.pack("<HHIBBHI", 0x0202, 16, 16 + 4 * n, 1, 0, 0, n) + b"\0\0\0\0" * n
    config = struct.pack("<I", 64) + b"\0" * 60
    entries = b""
    offs = []
    for i in range(n):
        offs.append(len(entries))
        entries += struct.pack("<HHI", 8, 0, i) + struct.pack("<HBBI", 8, 0, T_STRING, i)
    type_hdr_size = 20 + len(config)
    entries_start = type_hdr_size + 4 * n
    tchunk = struct.pack("<HHIBBHII", 0x0201, type_hdr_size, entries_start + len(entries), 1, 0, 0, n, entries_start)
    tchunk += config + b"".join(struct.pack("<I", o) for o in offs) + entries
    name = package.encode("utf-16-le")[:254]
    name += b"\0" * (256 - len(name))
    pkg_hdr_size = 288
    type_off = pkg_hdr_size
    key_off = type_off + len(type_pool)
    pkg_body = type_pool + key_pool + spec + tchunk
    pkg = struct.pack("<HHII", 0x0200, pkg_hdr_size, pkg_hdr_size + len(pkg_body), 0x7F) + name
    pkg += struct.pack("<IIIII", type_off, 1, key_off, n, 0) + pkg_body
    body = gpool + pkg
    return struct.pack("<HHII", 0x0002, 12, 12 + len(body), 1) + body
