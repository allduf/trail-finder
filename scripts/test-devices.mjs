// Test and review devices, left out as usage.html leaves them out (its reviewDevices): the phone check's Android emulator,
// Google Play's review phones (screen 435x725, an old web viewer: 195 "Script error." rows of 16-23 Nov 2026), the
// side-by-side check's iPhone simulator (iOS 18.5 · iPhone17,2 at 440x956, 22-25 Nov 2026) and the "console check".
// Shared by the daily app errors issue (app-errors.mjs) and the quick crash and error alert (app-alert.mjs), so both
// count only what usage.html shows (alex 2026-11-23). d = the tf_use_devices row ({ os, screen }), at = the event time.
export function isTestDevice(d, at) {
  const os = (d && d.os) || "", screen = d && d.screen, t = String(at || "");
  return /sdk_gphone|emulator/i.test(os) || screen === "435x725" || /^Web · console check/.test(os)
    || (os === "iOS 18.5 · iPhone17,2" && screen === "440x956" && t >= "2026-11-22" && t < "2026-11-26");
}
