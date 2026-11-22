#!/bin/bash
# Inside the Android simulator of side-by-side.yml, from the repository root. See run.mjs.
APP=com.allduf.trailfinder
adb wait-for-device
for i in $(seq 1 60); do [ "$(adb shell getprop sys.boot_completed | tr -d '\r')" = 1 ] && break; sleep 2; done
sleep 10
if [ "$TF_LANG" = fr ]; then   # a phone set to French (Canada), as a Quebec tester's
  adb root; sleep 3; adb wait-for-device
  adb shell setprop persist.sys.locale fr-CA; adb shell stop; sleep 2; adb shell start
  sleep 5; adb wait-for-device
  for i in $(seq 1 60); do [ "$(adb shell getprop sys.boot_completed | tr -d '\r')" = 1 ] && break; sleep 2; done
  sleep 15
fi
adb install -r android-app/android/app/build/outputs/apk/debug/app-debug.apk
# Location allowed, as after "Allow location"; notifications NOT allowed, so the phone's own prompt shows like on the iPhone.
for p in ACCESS_FINE_LOCATION ACCESS_COARSE_LOCATION; do adb shell pm grant $APP android.permission.$p || true; done
adb reverse tcp:8080 tcp:8080
adb emu geo fix -122.95 50.11 700
adb shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS || true
adb logcat -c -b crash || true
PLATFORM=android node scripts/side-by-side/run.mjs || true
timeout 30 adb logcat -d -v time | grep -E "AndroidRuntime|$APP|chromium|Capacitor|TrailMap|MapLibre|Mbgl|Fatal|ANR" | tail -800 > "out/android-$TF_LANG/logcat.txt" || true
exit 0
