#!/usr/bin/env bash
# Загружает инструменты сборки из Maven Central (Android SDK не требуется).
set -euo pipefail
T="${1:-$(dirname "$0")/.tools}"; mkdir -p "$T"; M=https://repo.maven.apache.org/maven2
get() { [ -f "$T/$(basename "$1")" ] || curl -sSfL -o "$T/$(basename "$1")" "$M/$1"; }
get org/robolectric/android-all/9-robolectric-4913185-2/android-all-9-robolectric-4913185-2.jar
get com/jakewharton/android/repackaged/dalvik-dx/16.0.1/dalvik-dx-16.0.1.jar
get com/android/tools/build/apksig/2.3.0/apksig-2.3.0.jar
