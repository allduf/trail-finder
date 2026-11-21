#!/bin/bash
# Run inside the Android simulator job "deep-check" of android-app.yml, from android-app/. See deep-check.mjs.
APP=com.allduf.trailfinder
mkdir -p shots
adb wait-for-device
for i in $(seq 1 60); do [ "$(adb shell getprop sys.boot_completed | tr -d '\r')" = 1 ] && break; sleep 2; done
sleep 10
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
for p in ACCESS_FINE_LOCATION ACCESS_COARSE_LOCATION POST_NOTIFICATIONS; do adb shell pm grant $APP android.permission.$p || true; done
adb emu geo fix -122.95 50.11 700
adb shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS || true
adb shell am start -W -n $APP/.MainActivity
sleep 25
if ! adb shell dumpsys activity activities | grep -E "topResumedActivity|mResumedActivity" | grep -q $APP; then
  adb shell am start -W -n $APP/.MainActivity
  sleep 20
fi
node test/deep-check.mjs || true
timeout 30 adb logcat -d -v time | grep -E "AndroidRuntime|$APP|chromium|Capacitor|TrailMap|MapLibre|Mbgl|libc|DEBUG|Fatal|ANR" | tail -800 > shots/$SPORT-logcat.txt || true
exit 0
