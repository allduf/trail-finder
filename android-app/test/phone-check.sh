#!/bin/bash
# Run inside the Android simulator job of android-app.yml, from android-app/. See phone-check.mjs.
set -e
APP=com.allduf.trailfinder
adb wait-for-device
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
for p in ACCESS_FINE_LOCATION ACCESS_COARSE_LOCATION POST_NOTIFICATIONS; do adb shell pm grant $APP android.permission.$p || true; done
adb emu geo fix -122.95 50.11 700
adb shell am start -n $APP/.MainActivity
sleep 20
node test/phone-check.mjs
node test/fgs-video.mjs || true
