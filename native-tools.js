// The map tools in native 3D (iPhone app only, alex only for now; native 3D parity step 4, alex 2026-11-20): Plan a
// route (MTB, Moto), Plan a tour (Skiing), Plan a hike, Record (Ride mode, every sport), Compass and Measure (Hunting).
// Each one is the page's own tool, with its own bar: while one is on, the native 3D screen (ios-app/.../NativeTools.swift)
// shrinks to the space between that bar and the top (or bottom) of the screen, and the bar shows and works there as on
// the web. A tap on the native map comes here as a tap on the flat map (a planned point, a picked trail, a measured
// point, the compass's target), and what the tool draws (window.tfToolLayers: the route, the recorded track, the sight
// line...) goes back to be drawn over the trails, left out of the trails sent by native-map.js.
// The native screen's "Tools" button lists the sport's tools; the one picked is started here with its own button.
// On the website tfNative doesn't exist and this file does nothing; in an Android build without native tools yet
// (tfNative.draws("tools") false) the tools stay in the trails native-map.js sends, and nothing here runs.
(() => {
  "use strict";
  const N = window.tfNative, map = window.tfLeaflet, L = window.L;
  if (!N || !N.addLayer || !N.send || !N.on || !map || !L) return;
  const t = (s) => (window.tfLang && window.tfLang.t ? window.tfLang.t(s) : s);
  const body = document.body.classList, $ = (s) => document.querySelector(s);
  const sport = () => ["ski", "hunt", "fish", "moto", "hike"].find((s) => body.contains("sport-" + s)) || "mtb";
  const click = (sel) => () => { const b = $(sel); if (b) b.click(); };
  const record = () => { if (window.tfRide && window.tfRide.start && !(window.tfRide.riding && window.tfRide.riding())) window.tfRide.start(); };

  // Each sport's tools, as the page names them, and what starts them (the same buttons as on the web).
  const MENU = {
    mtb: [["Plan a route", click("#planMapBtn")], ["Ride", record]],
    ski: [["Plan a tour", click("#skPlanBtn")], ["Record", record]],
    moto: [["Plan a route", click('#motoPane [data-act="plan"]')], ["Record", record]],
    hike: [["Plan a hike", click('#hikePane [data-act="plan"]')], ["Record", record]],
    hunt: [["Compass", click("#hnCompass")], ["Measure", click("#hnMeasure")], ["Record", record]],
    fish: [["Record", record]],
  };
  // The tool that's on, first that matches: whether it takes map taps, and how the map follows you.
  const TOOLS = [
    { k: "measure", on: () => body.contains("hn-measuring"), taps: true, follow: "none" },
    { k: "compass", on: () => body.contains("cp-on"), taps: true, follow: () => ($('.cp-card [data-c="lock"][aria-pressed="true"]') ? "none" : "heading") },
    { k: "plan", on: () => body.contains("planning") || body.contains("mt-planning") || body.contains("hk-planning") || map.getContainer().classList.contains("sk-planning"), taps: true, follow: "none" },
    { k: "ride", on: () => !!$(".app.riding"), taps: false, follow: "follow" },
    // Sun and shade's time bar (shade.js) works over native 3D the same way: the map shrinks under it, the slider moves
    // the moment, and native-ground.js sends the new shade. It takes no taps and leaves how the map follows you alone.
    { k: "sun", on: () => !!(window.tfSunShade && window.tfSunShade.isOn()) && !!$("#sunBar:not([hidden])"), taps: false },
  ];
  const current = () => TOOLS.find((x) => { try { return x.on(); } catch { return false; } }) || null;

  // ---------- where the tool's bar is: the screen's rows that aren't the map, from the top and from the bottom ----------
  // Looked at down the middle of the screen: the map is the flat map's container or its Leaflet panes; anything else
  // there (the tool's bar, the sheet it opened, a banner) is the page's and stays visible.
  const mapEl = map.getContainer();
  // A see-through holder (the row the map's buttons sit in) is map too: only something with a background of its own is UI.
  const solid = (el) => {
    for (let e = el, n = 0; e && e !== document.body && n < 6; e = e.parentElement, n++) {
      const cs = getComputedStyle(e);
      if (cs.backgroundImage !== "none" || !/^(?:transparent|rgba\(\d+,\s*\d+,\s*\d+,\s*0\))$/.test(cs.backgroundColor)) return true;
    }
    return false;
  };
  const isMap = (el) => !el || el === mapEl || el === document.body || el === document.documentElement ||
    (mapEl.contains(el) && !!el.closest(".leaflet-pane, .leaflet-control-container")) || !!el.closest(".maplibregl-canvas-container") || !solid(el);
  // A bar floats a little off the edge (the plan bar sits 8 px up, Measure's under the map's buttons): small gaps of map between the edge and the bar, or
  // inside the bar's rows, still count as the bar's.
  function insets() {
    const h = innerHeight, x = Math.round(innerWidth / 2), step = 6, GAP = 30, FIRST = 140;   // FIRST: the map's own buttons may sit between the edge and the bar
    const edge = (from, to, dir) => {
      let found = null, gap = 0;
      for (let y = from; dir > 0 ? y < to : y > to; y += dir * step) {
        if (!isMap(document.elementFromPoint(x, y))) { found = y; gap = 0; } else if ((gap += step) > (found == null ? FIRST : GAP)) break;
      }
      return found;
    };
    const t = edge(1, h * 0.6, 1), b = edge(h - 2, h * 0.25, -1);
    return { top: t == null ? 0 : Math.round(t + step), bottom: b == null ? 0 : Math.round(h - b + step) };
  }


  // ---------- what the tools draw ----------
  const leaves = () => {
    const out = [], reg = window.tfToolLayers || {};
    const walk = (l) => { if (l instanceof L.LayerGroup) l.eachLayer(walk); else out.push(l); };
    for (const groups of Object.values(reg)) for (const g of groups || []) if (g && map.hasLayer(g)) walk(g);
    return out;
  };
  let memo = null, memoAt = 0;
  const toolSet = () => { const now = Date.now(); if (!memo || now - memoAt > 100) { memo = new Set(leaves()); memoAt = now; } return memo; };
  // native-map.js leaves these out of the trails (an older cached copy without skip just draws them twice).
  if (N.skip) N.skip((l) => toolSet().has(l), "tools");

  const r5 = (v) => Math.round(v * 1e5) / 1e5;
  const textOf = (h) => { const d = document.createElement("div"); d.innerHTML = String(h || ""); return d.textContent.replace(/\s+/g, " ").trim(); };
  const colourIn = (h) => { const m = /(?:color|fill|background(?:-color)?)\s*[:=]\s*"?(#[0-9a-f]{6}|#[0-9a-f]{3})\b/i.exec(h); return m ? m[1] : null; };
  const SKIP_ICON = /\b(?:nav-you|cp-you)\b/;   // you: the native map shows you itself
  // Direction arrows along a planned route or the route being followed (planner.js "plan-arrow": turned by its compass
  // bearing; navigate.js "oneway-arrow": by its angle on the flat map's screen, 0 = east): sent with their bearing from
  // north and their colour, and drawn flat on the ground, turning with the map.
  const ARROW = /\b(plan-arrow|oneway-arrow)\b/;
  const arrowOf = (cls, html) => {
    const m = /rotate\((-?[\d.]+)deg\)/.exec(html);
    if (!m) return null;
    const plan = cls === "plan-arrow", fill = /fill="(#(?:[0-9a-f]{6}|[0-9a-f]{3}))"/i.exec(html);
    const b = ((+m[1] + (plan ? 0 : 90)) % 360 + 360) % 360;
    return { b: Math.round(b), c: plan ? "#ffffff" : fill ? fill[1] : "#4b0fb0", e: plan ? "#4b1aa0" : "#ffffff" };
  };
  function shapes() {
    const lines = [], dots = [], labels = [], arrows = [];
    for (const l of leaves()) {
      const o = l.options || {};
      if (l instanceof L.CircleMarker) {
        const p = l.getLatLng();
        dots.push({ type: "Feature", geometry: { type: "Point", coordinates: [r5(p.lng), r5(p.lat)] },
          properties: { r: l.getRadius(), c: o.color || "#fff", w: o.stroke === false ? 0 : o.weight || 0, f: o.fillColor || o.color || "#fff", fo: o.fill === false ? 0 : o.fillOpacity == null ? 0.2 : o.fillOpacity } });
      } else if (l instanceof L.Polyline) {
        if (o.stroke === false || !(o.opacity > 0)) continue;
        let lls = l.getLatLngs();
        if (!lls.length) continue;
        if (!Array.isArray(lls[0])) lls = [lls]; else if (Array.isArray(lls[0][0])) lls = lls.flat();
        const parts = lls.map((p) => p.map((q) => [r5(q.lng), r5(q.lat)])).filter((p) => p.length > 1);
        if (l instanceof L.Polygon) parts.forEach((p) => p.push(p[0]));
        if (!parts.length) continue;
        lines.push({ type: "Feature", geometry: { type: "MultiLineString", coordinates: parts },
          properties: { c: o.color || "#3388ff", w: o.weight || 3, o: o.opacity == null ? 1 : o.opacity, d: o.dashArray ? 1 : 0 } });
      } else if (l instanceof L.Marker && o.icon) {
        const io = o.icon.options || {}, h = io.html, html = (io.className || "") + " " + (h && h.outerHTML != null ? h.outerHTML : String(h || ""));
        if (SKIP_ICON.test(html)) continue;
        const arrow = ARROW.exec(html);
        if (arrow) {
          const a = arrowOf(arrow[1], html), q = l.getLatLng();
          if (a) arrows.push({ type: "Feature", geometry: { type: "Point", coordinates: [r5(q.lng), r5(q.lat)] }, properties: { ...a, img: `tfta:${a.c}:${a.e}` } });
          continue;
        }
        const p = l.getLatLng(), at = [r5(p.lng), r5(p.lat)], c = colourIn(html), txt = textOf(h && h.outerHTML != null ? h.outerHTML : h).slice(0, 24);
        if (txt) {
          const col = c || "#14211a";
          labels.push({ type: "Feature", geometry: { type: "Point", coordinates: at }, properties: { t: txt, c: col, img: `tftl:${col}:${txt}` } });
        } else dots.push({ type: "Feature", geometry: { type: "Point", coordinates: at }, properties: { r: 6, c: "#fff", w: 2, f: c || "#e03131", fo: 1 } });
      }
    }
    const fc = (f) => ({ type: "FeatureCollection", features: f });
    return JSON.stringify({ lines: fc(lines), dots: fc(dots), labels: fc(labels), arrows: fc(arrows) });
  }
  // A cheap fingerprint of what the tools draw: the shapes are only rebuilt and sent when it changes.
  function sig() {
    let s = "";
    for (const l of leaves()) {
      const o = l.options || {};
      s += L.stamp(l) + ":";
      if (l.getLatLngs) { const a = l.getLatLngs().flat(2), z = a[a.length - 1]; s += a.length + (z ? z.lat.toFixed(5) + z.lng.toFixed(5) : ""); }
      else if (l.getLatLng) { const p = l.getLatLng(); s += p.lat.toFixed(5) + p.lng.toFixed(5); }
      if (o.icon && o.icon.options) { const h = o.icon.options.html; s += String(h && h.outerHTML != null ? h.outerHTML : h || "").length; }
      s += (o.color || "") + (o.opacity == null ? "" : o.opacity) + (o.weight || "") + "|";
    }
    return s;
  }

  // ---------- sent to the native screen ----------
  let ver = 0, geo = "", lastSig = null, lastState = "", sentAt = 0;
  // A sheet of the page's own over everything (a dialog: the trip terms before the first plan, a Save box...): the
  // native screen steps aside until it's answered.
  // Only a dialog really showing: on the screen, not see-through, and on top at its middle (alex 2026-11-21: native 3D
  // stepped aside for one nobody could see). The page's Layers counts too (native-map.js opens it over native 3D).
  const covered = () => {
    const lm = document.getElementById("layersMenu");
    if (lm && !lm.hidden) return true;
    return [...document.querySelectorAll('dialog[open], [role="dialog"][aria-modal="true"]')].some((el) => {
      const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      if (r.width <= innerWidth / 2 || r.height <= innerHeight / 3 || cs.visibility === "hidden" || +cs.opacity < 0.1) return false;
      if (r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight) return false;
      // A few points inside it: any of them showing the dialog (or something of it) on top counts.
      const pts = [[0.5, 0.5], [0.5, 0.25], [0.5, 0.75], [0.25, 0.5], [0.75, 0.5]];
      return pts.some(([fx, fy]) => {
        const x = Math.min(innerWidth - 1, Math.max(0, r.left + r.width * fx)), y = Math.min(innerHeight - 1, Math.max(0, r.top + r.height * fy));
        const hits = document.elementsFromPoint(x, y);
        const i = hits.findIndex((h) => el.contains(h) || h.contains(el));
        // On top, or under only things that let it show (see-through or a bit of the page's frame over it).
        return i === 0 || (i > 0 && hits.slice(0, i).every((h) => +getComputedStyle(h).opacity < 0.1 || getComputedStyle(h).pointerEvents === "none"));
      });
    });
  };
  const state = () => {
    const tool = N.isOpen() ? current() : null, cover = N.isOpen() && covered();
    const box = tool && !cover ? insets() : { top: 0, bottom: 0 };
    const menu = (MENU[sport()] || []).map(([name]) => t(name));
    const words = { Tools: t("Tools"), Cancel: t("Cancel") };
    const follow = tool ? (typeof tool.follow === "function" ? tool.follow() : tool.follow) : "none";
    return JSON.stringify({ tool: tool ? tool.k : "", cover, top: box.top, bottom: box.bottom, taps: !!(tool && tool.taps), follow, menu, words });
  };
  const refreshGeo = () => { const s = sig(); if (s !== lastSig) { lastSig = s; geo = shapes(); ver++; return true; } return false; };
  N.addLayer("tools", () => { refreshGeo(); lastState = state(); sentAt = Date.now(); return `${lastState}\u0001${ver}\u0001${geo}`; });

  // While the native screen is open: a look every 0.3 s (a few hundred tiny lookups, nothing when it's closed). A long
  // recorded track is sent at most every 3 s.
  setInterval(() => {
    if (!N.isOpen() || (N.draws && !N.draws("tools"))) { lastSig = null; return; }
    const was = ver, st = state();
    const geoNew = lastSig === null || (sig() !== lastSig && (geo.length < 100000 || Date.now() - sentAt > 3000));
    if (geoNew) { lastSig = null; refreshGeo(); }
    if (st === lastState && ver === was) return;
    N.send("tools");
  }, 300);

  // ---------- from the native screen ----------
  N.on("toolStart", (e) => {
    const item = (MENU[sport()] || [])[e.i | 0];
    if (item) try { item[1](); } catch {}
  });
  N.on("toolTap", (e) => {
    const tool = current();
    if (!tool || !tool.taps || !isFinite(e.lat) || !isFinite(e.lon)) return;
    const latlng = L.latLng(e.lat, e.lon);
    // Planning a ski tour: a freeride or slackcountry line asks whether to add the whole line, as on the web 3D map.
    const layer = e.i >= 0 && N.hit ? N.hit(e.i) : null;
    if (tool.k === "plan" && map.getContainer().classList.contains("sk-planning") && layer && layer.options && layer.options.planOffer) {
      layer.fire("click", { latlng });
      return;
    }
    // A line of the tool's own with a tap of its own (Skiing's two ways, A or B: "tap one on the map") gets the tap when
    // it's close to it, as on the web map.
    const own = nearOwn(latlng);
    if (own) { own.fire("click", { latlng }); return; }
    map.fire("click", { latlng, layerPoint: map.latLngToLayerPoint(latlng), containerPoint: map.latLngToContainerPoint(latlng), from3d: true });
  });
  function nearOwn(latlng) {
    const p = map.latLngToContainerPoint(latlng);
    let best = null, bd = 18;
    for (const l of leaves()) {
      if (!(l instanceof L.Polyline) || l.options.interactive === false || !l.listens("click")) continue;
      let lls = l.getLatLngs();
      if (!lls.length) continue;
      if (!Array.isArray(lls[0])) lls = [lls]; else if (Array.isArray(lls[0][0])) lls = lls.flat();
      for (const part of lls) for (let i = 1; i < part.length; i++) {
        const d = L.LineUtil.pointToSegmentDistance(p, map.latLngToContainerPoint(part[i - 1]), map.latLngToContainerPoint(part[i]));
        if (d < bd) { bd = d; best = l; }
      }
    }
    return best;
  }
})();
