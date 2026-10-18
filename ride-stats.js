// Ride numbers shared by Ride mode (navigate.js) and My rides (ride.html), so a ride gives the same numbers in both.
// A point is [lat, lon, altitude or null, time ms, accuracy m, filled?]. filled = 1: the point was not from the GPS but
// drawn along the trails between two fixes, after the phone stopped the GPS (screen locked, page closed).
// breaks: indexes of points that start a new piece after Pause, so the jump across a pause doesn't count.
(() => {
  "use strict";
  const CLIMB_STEP_M = 4;      // count climbing only in steps of 4 m (GPS height is noisy)
  const MOVING_MS = 0.6;       // slower than ~2 km/h counts as stopped
  const MAX_SPEED_MS = 33;     // 120 km/h: faster than this is a GPS glitch
  const GAP_S = 45;            // no fix for this long: the GPS was stopped (locked phone, page closed)

  function metres(a, b) {
    const R = 6371008.8, rad = Math.PI / 180;
    const dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  // Climb and descent from heights, in 4 m steps so GPS noise doesn't add up.
  function upDown(alts) {
    let up = 0, down = 0, ref = null;
    alts.forEach((a) => {
      if (a == null) return;
      if (ref == null) ref = a;
      else if (a - ref >= CLIMB_STEP_M) { up += a - ref; ref = a; }
      else if (ref - a >= CLIMB_STEP_M) { down += ref - a; ref = a; }
    });
    return { up, down };
  }
  const climbOf = (alts) => upDown(alts).up;

  function statsOf(pts, start, end, breaks) {
    const brk = new Set(breaks || []);
    let dist = 0, moving = 0, max = 0;
    const cum = [0];
    for (let i = 1; i < pts.length; i++) {
      if (brk.has(i)) { cum.push(dist); continue; }        // after Pause: no distance or time across it
      const d = metres(pts[i - 1], pts[i]), dt = (pts[i][3] - pts[i - 1][3]) / 1000;
      dist += d; cum.push(dist);
      // A long gap with no GPS (a locked phone) counts as riding when you got somewhere at riding pace.
      if (dt > 0 && d / dt >= MOVING_MS) moving += dt;
    }
    // Max speed over stretches of 5 to 30 s of real GPS fixes, so one jumpy fix or a filled gap can't set it.
    for (let i = 1, j = 0; i < pts.length; i++) {
      while (j < i - 1 && pts[i][3] - pts[j + 1][3] >= 5000) j++;
      const dt = (pts[i][3] - pts[j][3]) / 1000;
      if (dt < 5 || dt > 30 || pts[i][5] || pts[j][5]) continue;
      let cross = false;
      for (let k = j + 1; k <= i; k++) if (brk.has(k)) { cross = true; break; }
      if (!cross) max = Math.max(max, (cum[i] - cum[j]) / dt);
    }
    const real = pts.filter((p) => !p[5]), withAlt = real.filter((p) => p[2] != null).length;
    const ud = real.length > 1 && withAlt >= real.length / 2 ? upDown(real.map((p) => p[2])) : null;
    return { dist, moving, elapsed: Math.max(0, (end - start) / 1000), max: Math.min(max, MAX_SPEED_MS), climb: ud ? ud.up : null, descent: ud ? ud.down : null };
  }

  // Gaps: stretches with no GPS fix for GAP_S or more (not Pause). filled: drawn along trails.
  function gapsOf(pts, breaks) {
    const brk = new Set(breaks || []), out = [];
    for (let i = 1; i < pts.length; i++) {
      if (brk.has(i)) continue;
      if (pts[i][5] && !pts[i - 1][5]) {                    // the start of a filled stretch
        let j = i; while (j < pts.length && pts[j][5]) j++;
        out.push({ from: i - 1, to: Math.min(j, pts.length - 1), s: (pts[Math.min(j, pts.length - 1)][3] - pts[i - 1][3]) / 1000, filled: true });
        i = j; continue;
      }
      const dt = (pts[i][3] - pts[i - 1][3]) / 1000;
      if (!pts[i][5] && !pts[i - 1][5] && dt >= GAP_S && metres(pts[i - 1], pts[i]) > 30) out.push({ from: i - 1, to: i, s: dt, filled: false });
    }
    return out;
  }

  // Heights along the ride for a profile: [{ m: metres from the start, a: height }], real GPS heights only.
  function profileOf(pts, breaks) {
    const brk = new Set(breaks || []), out = [];
    let run = 0;
    pts.forEach((p, i) => {
      if (i && !brk.has(i)) run += metres(pts[i - 1], p);
      if (p[2] != null && !p[5]) out.push({ m: run, a: p[2] });
    });
    return out;
  }

  window.tfRideStats = { metres, climbOf, upDown, statsOf, gapsOf, profileOf, MOVING_MS, GAP_S, MAX_SPEED_MS };
})();
