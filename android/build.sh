#!/usr/bin/env bash
# Сборка APK без Android SDK: javac -> dx -> ручной манифест/arsc -> apksig.
# Требует: JDK 17+, python3, и jar-файлы в $TOOLS (см. android/README.md).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$HERE")"
TOOLS="${TOOLS:-$HERE/.tools}"
"$HERE/fetch-tools.sh" "$TOOLS"
ANDROID_JAR="$TOOLS/android-all-9-robolectric-4913185-2.jar"
DX="$TOOLS/dalvik-dx-16.0.1.jar"
APKSIG="$TOOLS/apksig-2.3.0.jar"
B="$HERE/build"
VCODE="${VCODE:-1}"; VNAME="${VNAME:-0.1.0}"
rm -rf "$B"; mkdir -p "$B/classes" "$B/signer"

javac -nowarn --release 8 -cp "$ANDROID_JAR" \
  -d "$B/classes" $(find "$HERE/src" -name '*.java')
java -cp "$DX" com.android.dx.command.Main --dex --min-sdk-version=24 --output="$B/classes.dex" "$B/classes"

python3 "$HERE/tools/package.py" "$B/unsigned.apk" "$B/classes.dex" "$ROOT/game/dist" "$B" "$VCODE" "$VNAME"

KS="$HERE/citadel-debug.p12"
if [ ! -f "$KS" ]; then
  keytool -genkeypair -keystore "$KS" -storetype PKCS12 -storepass citadel -keypass citadel \
    -alias citadel -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Citadel Debug" >/dev/null 2>&1
fi
javac -nowarn -cp "$APKSIG" -d "$B/signer" "$HERE/tools/Sign.java"
java --add-exports java.base/sun.security.x509=ALL-UNNAMED --add-exports java.base/sun.security.pkcs=ALL-UNNAMED --add-exports java.base/sun.security.util=ALL-UNNAMED -cp "$APKSIG:$B/signer" Sign "$B/unsigned.apk" "$ROOT/dist/Citadel-$VNAME.apk" "$KS" citadel citadel
