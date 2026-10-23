// window.tfGps: the GPS that records rides (navigate.js Ride mode, ride.html).
// In the iPhone app (ios-app/) it's the app's own GPS (plugins/TrailGps), which keeps going with the phone locked and
// keeps every fix, so the ones the page missed while iOS held it asleep come back with catchUp(). Anywhere else, or
// if the app's GPS can't start, it's the browser's watchPosition, which stops when the phone locks.
//   const w = tfGps.watch(onFix, onError, { after })   // onFix gets a browser-style position; after = ms, older fixes skipped
//   w.catchUp()   // the fixes missed since the last one passed on (call when the page shows again)
//   w.stop()      // stop the GPS (the app also forgets the kept fixes)
(() => {
  const C = window.Capacitor;
  const native = !!(C && C.isNativePlatform && C.isNativePlatform() && C.nativePromise && C.addListener &&
    (C.PluginHeaders || []).some((h) => h.name === "TrailGps"));
  const WEB_OPTS = { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 };

  function webWatch(onFix, onError) {
    const id = navigator.geolocation.watchPosition(onFix, onError, WEB_OPTS);
    return { native: false, stop: () => navigator.geolocation.clearWatch(id), catchUp: async () => {} };
  }

  function watch(onFix, onError, opts = {}) {
    if (!native) return webWatch(onFix, onError);
    let last = opts.after || 0, web = null, stopped = false;
    const take = (f) => {
      if (!f || stopped || !(f.time > last)) return;   // in order, each fix once (live and caught up ones overlap)
      last = f.time;
      onFix({ coords: { latitude: f.lat, longitude: f.lon, accuracy: f.acc, altitude: f.alt ?? null, altitudeAccuracy: null,
        speed: f.speed ?? null, heading: f.heading ?? null }, timestamp: f.time });
    };
    const subs = [C.addListener("TrailGps", "fix", take),
      C.addListener("TrailGps", "error", () => onError({ code: 1, message: "Location is turned off for Trail Finder" }))];
    const catchUp = async () => {
      if (stopped || web) return;
      try { const r = await C.nativePromise("TrailGps", "fixes", { after: last }); (r && r.fixes || []).forEach(take); } catch {}
    };
    const w = {
      native: true,
      stop() {
        stopped = true;
        subs.forEach((s) => s.remove());
        if (web) web.stop(); else C.nativePromise("TrailGps", "stop", {}).catch(() => {});
      },
      catchUp,
    };
    C.nativePromise("TrailGps", "start", {}).then(catchUp, (err) => {
      if (stopped) return;
      subs.forEach((s) => s.remove());
      if (err && err.code === "DENIED") { onError({ code: 1, message: err.message }); return; }
      web = webWatch(onFix, onError);   // the app's GPS failed some other way: the page's GPS still works unlocked
      w.native = false;
    });
    return w;
  }

  window.tfGps = { native, watch };
})();
