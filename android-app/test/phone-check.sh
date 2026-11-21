#!/bin/bash
# Run inside the Android simulator job of android-app.yml, from android-app/. See phone-check.mjs.
set -e
APP=com.allduf.trailfinder
mkdir -p shots
adb wait-for-device
# The live site's Whistler data files (not in the repo), so the test site shows and names the trails
for f in mtb trails names roads access; do curl -sf --max-time 60 "https://trailfinderapp.ca/data/$f-wh.json" -o "../data/$f-wh.json" || echo "(no $f-wh.json)"; done
# Wait for the phone to finish starting (launcher up), or the app can open before it and be closed again.
for i in $(seq 1 60); do [ "$(adb shell getprop sys.boot_completed | tr -d '\r')" = 1 ] && break; sleep 2; done
sleep 10
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
for p in ACCESS_FINE_LOCATION ACCESS_COARSE_LOCATION POST_NOTIFICATIONS; do adb shell pm grant $APP android.permission.$p || true; done
adb emu geo fix -122.95 50.11 700
adb shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS || true
adb shell am start -W -n $APP/.MainActivity
sleep 20
# Not in front (closed, or a system popup took over)? Open it once more.
if ! adb shell dumpsys activity activities | grep -E "topResumedActivity|mResumedActivity" | grep -q $APP; then
  echo "(the app wasn't open: opening it again)"
  adb shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS || true
  adb shell am start -W -n $APP/.MainActivity
  sleep 20
fi
status=0
node test/phone-check.mjs || status=$?
timeout 30 adb logcat -d -v time | grep -E "AndroidRuntime|$APP|chromium|Capacitor|TrailGps|MapLibre|Mbgl|libc|DEBUG|Fatal" | tail -400 > shots/logcat.txt || true
# A failed check: the app's crashes and the map engine's own lines in the log too (no artifact download needed).
[ $status = 0 ] || grep -E "FATAL|Fatal signal|AndroidRuntime|MapLibre|Mbgl|backtrace|#0[0-9] pc" shots/logcat.txt | tail -60 || true
[ $status = 0 ] && { node test/fgs-video.mjs || true; }
exit $status
