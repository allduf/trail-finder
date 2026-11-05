// Routes never double back (alex 2026-11-05, a Skiing tour that climbed to a high spot near the Spearhead and came back
// down the same way before going on: "make sure it never does that", "everywhere"). Every way the app draws between two
// points (Skiing tours, Plan a route, Hiking, Fishing, Moto, Directions) goes through here:
//  - find(pts, o): the places a line doubles back, [{ i, j, m, kind }] (i, j: indexes in pts, m: metres wasted).
//      "back":   it turns round and comes back on top of itself (heading the other way, within 5 m, 60 m or more on).
//      "loop":   it comes back within 15 m of where it was 100 m or more before (a knot), only with o.loops (a drawn
//                line; a road network crosses itself at overpasses and ramps).
//      "detour": with o.hAt(lat, lon) (the height there): within 100 m of where it was, after going 3x as far, and it
//                went 25 m or more higher (or lower) than both ends on the way: up to a high spot and back down.
//  - clean(pts, o): the same line with those stretches cut (straight across from where it left to where it came back).
//  - check(what, pts, o): find, and send what's left to the app's error list (usage.js, the daily "App errors" issue),
//    so a route that still doubles back somewhere is seen and fixed.
// o.keep: indexes of points the person put in (a stop, a summit), or o.stops: those places: a cut never goes past one, so
// going to a point and back from it is kept (an out and back to a summit is a real tour).
// Works in the page (window.tfNoBack) and in Node (scripts/check-routes.mjs, the data check on every pull request).
(function (root) {
  "use strict";
  const RAD = Math.PI / 180;
  const NEAR = 15, BACK_NEAR = 5, BACK_M = 60, LOOP_M = 100, DET_NEAR = 100, DET_RISE = 25, STEP = 8;
  const dist = (a, b) => {
    const x = (b[1] - a[1]) * Math.cos(((a[0] + b[0]) / 2) * RAD), y = b[0] - a[0];
    return Math.sqrt(x * x + y * y) * 111195;
  };
  const head = (a, b) => Math.atan2((b[1] - a[1]) * Math.cos(a[0] * RAD), b[0] - a[0]);
  // Points every STEP m (so far-apart corners of a drawn line still meet), each with the index of the point it came from.
  function dense(pts) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      out.push({ p: [a[0], a[1]], src: i, orig: true });
      if (i + 1 < pts.length) {
        const b = pts[i + 1], n = Math.floor(dist(a, b) / STEP);
        for (let k = 1; k < n; k++) out.push({ p: [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n], src: i, orig: false });
      }
    }
    let d = 0;
    out.forEach((q, i) => { if (i) d += dist(out[i - 1].p, q.p); q.d = d; q.h = i + 1 < out.length ? head(q.p, out[i + 1].p) : i ? head(out[i - 1].p, q.p) : 0; });
    return out;
  }
  // The doubling-back stretches of a dense line, biggest first from each start, none overlapping: [{ a, b, kind }].
  function cuts(D, o) {
    const keep = new Set(o.keep || []), hAt = o.hAt;
    // o.stops: the points put in, as places ([lat, lon]): the line's point nearest each one (within 50 m) is kept.
    for (const s of o.stops || []) {
      if (!s) continue;
      const q = Array.isArray(s) ? s : [s.lat, s.lng != null ? s.lng : s.lon];
      let bi = -1, bd = 50;
      D.forEach((x, i) => { if (x.orig) { const d = dist(x.p, q); if (d < bd) { bd = d; bi = x.src; } } });
      if (bi >= 0) keep.add(bi);
    }
    if (hAt) for (const q of D) { const v = hAt(q.p[0], q.p[1]); q.e = v == null || v !== v ? null : v; }
    // A grid of ~100 m squares, for the points near each one.
    const G = new Map(), cs = DET_NEAR / 111195, at = (p) => [Math.floor(p[0] / cs), Math.floor(p[1] / (cs / Math.max(0.2, Math.cos(p[0] * RAD))))];
    D.forEach((q, i) => { const [y, x] = at(q.p), k = y + ":" + x; if (!G.has(k)) G.set(k, []); G.get(k).push(i); });
    // Index of the next point someone put in, from each dense point (a cut can't go past it).
    const nextKeep = new Array(D.length);
    for (let i = D.length - 1, nk = Infinity; i >= 0; i--) { if (D[i].orig && keep.has(D[i].src)) nk = i; nextKeep[i] = nk; }
    const out = [];
    for (let i = 0; i < D.length - 1; ) {
      const a = D[i], [y, x] = at(a.p);
      let best = null;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const j of G.get(y + dy + ":" + (x + dx)) || []) {
        if (j <= i + 1 || (best && j <= best.b)) continue;
        if (nextKeep[i + 1] < j) continue;   // a point someone put in is in between
        const b = D[j], gap = dist(a.p, b.p), along = b.d - a.d;
        let kind = null;
        if (gap <= NEAR) {
          // Back along itself: on top of where it went (a switchback's two arms open up as they leave the turn).
          let turn = Math.abs(a.h - b.h); if (turn > Math.PI) turn = 2 * Math.PI - turn;
          if (gap <= BACK_NEAR && along >= BACK_M && turn >= 120 * RAD) kind = "back";
          else if (o.loops && along >= LOOP_M) kind = "loop";
        }
        if (!kind && hAt && gap <= DET_NEAR && along >= Math.max(150, 3 * gap) && a.e != null && b.e != null) {
          let hi = -Infinity, lo = Infinity;
          for (let k = i + 1; k < j; k++) { const e = D[k].e; if (e != null) { if (e > hi) hi = e; if (e < lo) lo = e; } }
          if (hi >= Math.max(a.e, b.e) + DET_RISE || lo <= Math.min(a.e, b.e) - DET_RISE) kind = "detour";
        }
        if (kind) best = { a: i, b: j, kind, m: Math.round(along - gap) };
      }
      if (best) { out.push(best); i = best.b; } else i++;
    }
    return out;
  }
  function find(pts, o = {}) {
    if (!pts || pts.length < 3) return [];
    const D = dense(pts);
    return cuts(D, o).map((c) => ({ i: D[c.a].src, j: D[c.b].src + (D[c.b].orig ? 0 : 1), m: c.m, kind: c.kind, at: D[c.a].p }));
  }
  // The line with its doubling-back stretches cut out. Returns the same array when there's nothing to cut.
  function clean(pts, o = {}) {
    if (!pts || pts.length < 3) return pts;
    const D = dense(pts), cs = cuts(D, o);
    if (!cs.length) return pts;
    const out = [], extra = (q, src) => (src.length > 2 ? [...q.p, ...src.slice(2)] : q.p);
    let k = 0;
    for (const c of cs) {
      for (; k < c.a; k++) if (D[k].orig) out.push(pts[D[k].src]);
      out.push(D[c.a].orig ? pts[D[c.a].src] : extra(D[c.a], pts[D[c.a].src]));
      out.push(D[c.b].orig ? pts[D[c.b].src] : extra(D[c.b], pts[D[c.b].src]));
      k = c.b + 1;
    }
    for (; k < D.length; k++) if (D[k].orig) out.push(pts[D[k].src]);
    clean.last = cs;
    return out.filter((q, i) => !i || dist(out[i - 1], q) > 0.3);
  }
  // A route about to be shown: what still doubles back goes to the error list (once per place a session).
  const told = new Set();
  function check(what, pts, o = {}) {
    let hits = [];
    try { hits = find(pts, o); } catch { return []; }
    for (const h of hits) {
      const key = `${what}|${h.at[0].toFixed(3)},${h.at[1].toFixed(3)}`;
      if (told.has(key)) continue;
      told.add(key);
      const msg = `Route doubles back (${what}, ${h.kind}, ${h.m} m) at ${h.at[0].toFixed(5)},${h.at[1].toFixed(5)}`;
      try { if (typeof console !== "undefined") console.warn(msg); } catch {}
      try { if (root.dispatchEvent && root.CustomEvent) root.dispatchEvent(new root.CustomEvent("tf:route-back", { detail: { msg, what, ...h } })); } catch {}
    }
    return hits;
  }
  const api = { find, clean, check, dist };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.tfNoBack = api;
})(typeof window !== "undefined" ? window : globalThis);
