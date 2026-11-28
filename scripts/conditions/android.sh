#!/bin/bash
# Inside the Android simulator of conditions.yml, from the repository root. See native.mjs.
APP=com.allduf.trailfinder
adb wait-for-device
for i in $(seq 1 60); do [ "$(adb shell getprop sys.boot_completed | tr -d '\r')" = 1 ] && break; sleep 2; done
sleep 10
adb install -r android-app/android/app/build/outputs/apk/debug/app-debug.apk
for p in ACCESS_FINE_LOCATION ACCESS_COARSE_LOCATION POST_NOTIFICATIONS; do adb shell pm grant $APP android.permission.$p || true; done
adb reverse tcp:8080 tcp:8080
adb emu geo fix -122.95 50.11 700
adb shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS || true
adb logcat -c -b crash || true
status=0
PLATFORM=android node scripts/conditions/native.mjs || status=$?
mkdir -p out/conditions-android
timeout 30 adb logcat -d -v time | grep -E "AndroidRuntime|$APP|chromium|Capacitor|TrailMap|MapLibre|Mbgl|Fatal|ANR" | tail -800 > out/conditions-android/logcat.txt || true
exit $status
