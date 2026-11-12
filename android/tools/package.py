"""Собирает неподписанный APK: манифест, resources.arsc, иконка, classes.dex, assets/."""
import os
import sys
import zipfile

sys.path.insert(0, os.path.dirname(__file__))
from axml import Element, Ref, Hex, encode_manifest, encode_arsc  # noqa: E402
from make_icon import write_png  # noqa: E402

PKG = "ru.citadel.game"


def manifest(version_code, version_name):
    act = Element("activity", {
        "android:name": PKG + ".MainActivity",
        "android:exported": True,
        "android:screenOrientation": 6,          # sensorLandscape
        "android:configChanges": Hex(0x04A0 | 0x0800 | 0x0100 | 0x2000),
        "android:launchMode": 2,                 # singleTask
        "android:hardwareAccelerated": True,
    }, [Element("intent-filter", {}, [
        Element("action", {"android:name": "android.intent.action.MAIN"}),
        Element("category", {"android:name": "android.intent.category.LAUNCHER"}),
    ])])
    app = Element("application", {
        "android:label": "Цитадель",
        "android:icon": Ref(0x7F010000),
        "android:theme": Ref(0x01030007),        # Theme.NoTitleBar.Fullscreen
        "android:hardwareAccelerated": True,
    }, [act])
    return Element("manifest", {
        "android:versionCode": version_code,
        "android:versionName": version_name,
        "package": PKG,
    }, [
        Element("uses-sdk", {"android:minSdkVersion": 24, "android:targetSdkVersion": 34}),
        Element("uses-feature", {"android:glEsVersion": Hex(0x00020000), "android:required": True}),
        app,
    ])


def add(zf, name, data, store=False):
    zi = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
    zi.compress_type = zipfile.ZIP_STORED if store else zipfile.ZIP_DEFLATED
    if store:
        off = zf.fp.tell() + 30 + len(name.encode())
        zi.extra = b"\0" * ((4 - off % 4) % 4)
    zf.writestr(zi, data)


def main(out, dex, assets_dir, build_dir, vcode, vname):
    icon = os.path.join(build_dir, "icon.png")
    write_png(icon, 192)
    with zipfile.ZipFile(out, "w") as zf:
        add(zf, "AndroidManifest.xml", encode_manifest(manifest(int(vcode), vname)))
        add(zf, "resources.arsc", encode_arsc(PKG, [("icon", "res/mipmap/icon.png")]), store=True)
        add(zf, "classes.dex", open(dex, "rb").read())
        add(zf, "res/mipmap/icon.png", open(icon, "rb").read(), store=True)
        for root, _, files in sorted(os.walk(assets_dir)):
            for f in sorted(files):
                p = os.path.join(root, f)
                rel = os.path.relpath(p, assets_dir).replace(os.sep, "/")
                add(zf, "assets/" + rel, open(p, "rb").read())
    print("unsigned:", out)


if __name__ == "__main__":
    main(*sys.argv[1:])
