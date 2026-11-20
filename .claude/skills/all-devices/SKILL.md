---
name: all-devices
description: Use whenever a Trail Finder feature is added or changed, to make sure the website, iPhone (incl. native 3D) and Android all get it and stay in step.
---

# Every change reaches every device

alex's rule (see "Every change reaches every device" in `CLAUDE.md`): every change reaches every device, so all users
get every feature. The end goal is every web feature working the same on phones, in native 3D, as smooth as possible.

## Devices
1. Website (trailfinderapp.ca): live with the next website publish.
2. iPhone app (Capacitor shell + native 3D, TestFlight).
3. Android app (Capacitor shell, Google Play closed test).

## Before opening the pull request
- Decide where the change runs: web only, iPhone native, Android native, or several.
- If it shows in 3D, check whether native 3D draws it. If not yet, add it to `webOnly()` in `native-map.js` so turning
  it on opens the full web 3D, and note the gap in the native 3D plan.
- New native 3D features use the split from PR #847: `ios-app/plugins/TrailMap/ios/Sources/TrailMap/NativeXxx.swift`
  (a `NativeLayer`, one line in `NativeLayers.all`, alphabetical) plus a page side `native-xxx.js` that calls
  `window.tfNative.addLayer(key, get)` and `window.tfNative.send(key)`, guarded
  (`window.tfNative && window.tfNative.addLayer`). The screen file `TrailMapPlugin.swift` stays feature-free.
- Test at iPhone size; at Android size too when Android code is touched. Nothing may make the phone app slower
  (`/check-lag` for native 3D).
- In the pull request text: Website / iPhone / Android = included, needs a build, or not needed (and why).

## After merging
- Web-only: goes live with the next publish; no app build needed.
- Native code (`ios-app/`, `android-app/`, plugins, push, deep links, native 3D): tell alex before opening the pull
  request. After merge, start the "iPhone app" and "Android app" builds in the same round and tell alex both build
  numbers and what to do (update in TestFlight; upload the Android build in Play Console until there is an upload key).

## Never
- Never leave a feature on one device only without telling alex and writing down the plan for the others.
- Never draw avalanche natively unless it matches Avalanche Canada exactly (`avalanche-rules`).
