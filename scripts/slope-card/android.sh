#!/bin/bash
# Inside the Android simulator of slope-card.yml, from the repository root (as scripts/side-by-side/android.sh).
APP=com.allduf.trailfinder
adb wait-for-device
for i in $(seq 1 60); do [ "$(adb shell getprop sys.boot_completed | tr -d '\r')" = 1 ] && break; sleep 2; done
sleep 10
adb install -r android-app/android/app/build/outputs/apk/debug/app-debug.apk
for p in ACCESS_FINE_LOCATION ACCESS_COARSE_LOCATION; do adb shell pm grant $APP android.permission.$p || true; done
adb reverse tcp:8080 tcp:8080
adb emu geo fix -122.95 50.11 700
PLATFORM=android node scripts/slope-card/check.mjs
