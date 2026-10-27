// Search a place: a town, a mountain, a range, a lake or a region ("Chic-Chocs", "Gaspésie", "Rogers Pass") and jump
// the map there (alex 2026-10-26: "add search a regions or area"). Used by Skiing's find box (winter.js), the "Go to a
// place" box in Hunting, Fishing and Adventure moto, and Adventure moto's Plan a route ("type where we want to go").
// Places come from OpenStreetMap's Nominatim (and Komoot's Photon when Nominatim finds nothing in Canada), asked only
// when the person presses Go or Enter (Nominatim's rules: no search-as-you-type, at most one ask a second), Canada
// before elsewhere. A sport can add its
// own places that show while typing (Skiing: the backcountry areas of data/ski-areas.json). GPS points ("50.1, -122.9")
// work too.
(() => {
  "use strict";
  const map = window.tfLeaflet;
  if (!map || !window.L || window.tfPlaceSearch) return;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  // For alex's usage page (usage.js): what is asked or searched, and how many answers came back.
  const logUse = (...a) => (window.tfUse ? window.tfUse(...a) : (window.tfUseQ = window.tfUseQ || []).push(a));

  const css = document.createElement("style");
  css.textContent = `
.ps-box { display: flex; flex-direction: column; gap: 6px; }
.ps-row { display: flex; gap: 6px; }
.ps-in { flex: 1; min-width: 0; font: inherit; font-size: 16px; box-sizing: border-box; padding: 9px 12px 9px 34px; border: 1px solid var(--line); border-radius: 12px; color: var(--fg);
  background: var(--panel) no-repeat 11px 50% / 16px url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2.2'%3E%3Cpath d='M12 21.5s6.5-5.8 6.5-11.2a6.5 6.5 0 1 0-13 0c0 5.4 6.5 11.2 6.5 11.2z'/%3E%3Ccircle cx='12' cy='10.3' r='2.4'/%3E%3C/svg%3E"); }
.ps-go { font: inherit; font-size: .88rem; font-weight: 700; padding: 0 14px; border-radius: 12px; border: 1px solid var(--line); background: var(--chip); color: var(--fg); cursor: pointer; }
.ps-msg { margin: 0; color: var(--muted); font-size: .78rem; }
.ps-msg:empty { display: none; }
ul.ps-hits { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; border: 1px solid var(--line); border-radius: 12px; overflow: hidden; background: var(--panel); }
ul.ps-hits:empty { display: none; }
.ps-hits li + li { border-top: 1px solid var(--line); }
.ps-hits button, .ps-place { all: unset; box-sizing: border-box; width: 100%; display: flex; align-items: center; gap: 10px; padding: 10px 10px; cursor: pointer; min-height: 44px; }
.ps-hits button:hover, .ps-hits button:focus-visible, .ps-place:hover, .ps-place:focus-visible { background: var(--chip); }
.ps-ic { width: 24px; height: 24px; flex: none; border-radius: 50%; display: grid; place-items: center; font-size: 13px; background: var(--chip); }
.ps-tx { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.ps-tx b { font-weight: 650; font-size: .92rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ps-tx small { color: var(--muted); font-size: .76rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ps-more { color: #1f5fe0; font-weight: 700; font-size: .88rem; }
`;
  document.head.append(css);

  // ---------- GPS points ----------
  function parseGps(q) {
    const m = String(q).trim().match(/^(-?\d{1,2}(?:\.\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:\.\d+)?)$/);
    if (!m) return null;
    const lat = +m[1], lon = +m[2];
    return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [lat, lon] : null;
  }

  // ---------- Nominatim ----------
  // One plain word for what a place is, from Nominatim's kind of place.
  const KIND = {
    city: ["Town", "🏘"], town: ["Town", "🏘"], village: ["Village", "🏘"], hamlet: ["Hamlet", "🏘"], municipality: ["Town", "🏘"], suburb: ["Neighbourhood", "🏘"], neighbourhood: ["Neighbourhood", "🏘"], locality: ["Place", "📍"],
    peak: ["Mountain", "▲"], volcano: ["Mountain", "▲"], mountain_range: ["Mountain range", "⛰"], ridge: ["Ridge", "⛰"], saddle: ["Pass", "⛰"], mountain_pass: ["Pass", "⛰"], glacier: ["Glacier", "❄"], valley: ["Valley", "⛰"], plateau: ["Plateau", "⛰"],
    state: ["Province", "🗺"], region: ["Region", "🗺"], county: ["Region", "🗺"], state_district: ["Region", "🗺"], district: ["Region", "🗺"],
    lake: ["Lake", "💧"], water: ["Lake", "💧"], reservoir: ["Lake", "💧"], river: ["River", "💧"], bay: ["Bay", "💧"], strait: ["Water", "💧"], island: ["Island", "🏝"],
    national_park: ["Park", "🌲"], protected_area: ["Park", "🌲"], park: ["Park", "🌲"], nature_reserve: ["Park", "🌲"], forest: ["Forest", "🌲"], wood: ["Forest", "🌲"],
    ski: ["Ski area", "⛷"], winter_sports: ["Ski area", "⛷"], alpine_hut: ["Hut", "🛖"], wilderness_hut: ["Hut", "🛖"], camp_site: ["Campground", "⛺"],
  };
  // Shops, bars, streets and buildings aren't places to go to: "Chic-Chocs" found a bar in Cyprus first.
  const JUNK = /^(amenity|shop|highway|building|office|craft|railway|man_made|emergency|healthcare|club|aeroway|power|telecom)$/;
  const kindOf = (...ks) => { for (const x of ks) if (x && KIND[x]) return KIND[x]; const t = ks.find(Boolean); return [t ? t.replace(/_/g, " ").replace(/^./, (x) => x.toUpperCase()) : "Place", "📍"]; };
  const cache = new Map();
  const turn = { nom: { last: 0, q: Promise.resolve() }, pho: { last: 0, q: Promise.resolve() } };
  // At most one ask a second to each service.
  function ask(who, url, headers) {
    const t = turn[who];
    const p = t.q.then(async () => {
      const wait = t.last + 1100 - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      t.last = Date.now();
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    });
    t.q = p.catch(() => {});
    return p;
  }
  // OpenStreetMap's Nominatim: exact names, with outlines.
  async function nominatim(q, b) {
    const hits = await ask("nom", "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=10&addressdetails=1&viewbox="
      + [b.getWest(), b.getNorth(), b.getEast(), b.getSouth()].map((v) => v.toFixed(2)).join(",") + "&q=" + encodeURIComponent(q), { "Accept-Language": "en,fr" });
    return hits.filter((h) => !JUNK.test(h.category)).map((h) => {
      const a = h.address || {}, bb = (h.boundingbox || []).map(Number), name = h.name || (h.display_name || "").split(",")[0];
      return { name, kind: kindOf(h.type, h.addresstype, h.category), where: [[a.city, a.town, a.village, a.municipality, a.county, a.state_district, a.region].find((x) => x && x !== name), a.state, a.country_code !== "ca" && a.country],
        lat: +h.lat, lon: +h.lon, bb: bb.length === 4 ? bb : null, ca: a.country_code === "ca" };
    });
  }
  // Komoot's Photon (also OpenStreetMap): forgiving with half names and missing accents ("Chic-Chocs" finds the
  // Réserve faunique des Chic-Chocs). Asked when Nominatim finds nothing in Canada.
  async function photon(q, c) {
    const j = await ask("pho", `https://photon.komoot.io/api/?limit=10&lat=${c.lat.toFixed(2)}&lon=${c.lng.toFixed(2)}&q=` + encodeURIComponent(q));
    return (j.features || []).filter((f) => !JUNK.test(f.properties.osm_key) && f.properties.name).map((f) => {
      const p = f.properties, e = p.extent, ll = f.geometry.coordinates;
      return { name: p.name, kind: kindOf(p.osm_value, p.type, p.osm_key), where: [[p.city, p.district, p.county].find((x) => x && x !== p.name), p.state, p.countrycode !== "CA" && p.country],
        lat: ll[1], lon: ll[0], bb: e && e.length === 4 ? [e[3], e[1], e[0], e[2]] : null, ca: p.countrycode === "CA" };
    });
  }
  // Places: { name, sub, ic, lat, lon, bb: [south, north, west, east] }, Canada first.
  function search(q) {
    q = String(q || "").trim();
    if (!q) return Promise.resolve([]);
    const gps = parseGps(q);
    if (gps) return Promise.resolve([{ name: `${gps[0].toFixed(5)}, ${gps[1].toFixed(5)}`, sub: "GPS point", ic: "📍", lat: gps[0], lon: gps[1], bb: null }]);
    const k = q.toLowerCase();
    if (cache.has(k)) return cache.get(k);
    const c = map.getCenter(), b = map.getBounds().pad(1);
    const p = (async () => {
      let hits = await nominatim(q, b).catch(() => null);
      if (!hits || !hits.some((h) => h.ca)) {
        const more = await photon(q, c).catch(() => null);
        if (!hits && !more) throw new Error("offline");
        hits = [...(hits || []), ...(more || [])];
      }
      const kept = [];
      return hits.map((h, i) => {
        const far = Math.hypot(h.lat - c.lat, (h.lon - c.lng) * Math.cos((c.lat * Math.PI) / 180));
        const where = h.where.filter((x) => x && x !== h.name).slice(-2);
        return { name: h.name, sub: [h.kind[0], ...where].join(" · "), kind: h.kind[0], ic: h.kind[1], lat: h.lat, lon: h.lon, bb: h.bb, ca: h.ca, far, i };
      })
        // Canada first; then the service's own order, except that a place much closer to the map goes up.
        .sort((x, y) => (y.ca - x.ca) || (x.far < y.far / 4 && x.far < 3 ? -1 : y.far < x.far / 4 && y.far < 3 ? 1 : x.i - y.i))
        // The same name and kind close together once (a range is often mapped as several peaks, "Monts Chic-Chocs").
        .filter((x) => { if (kept.some((y) => y.name === x.name && y.kind === x.kind && Math.abs(y.lat - x.lat) + Math.abs(y.lon - x.lon) < 1)) return false; kept.push(x); return true; })
        .slice(0, 6);
    })();
    cache.set(k, p);
    p.catch(() => cache.delete(k));   // no signal: ask again next time
    return p;
  }

  // ---------- jump the map ----------
  // A town, range or region fits its outline; a peak or a point zooms in around it.
  function go(p, o = {}) {
    const maxZoom = o.maxZoom || 13;
    if (p.bb && (p.bb[1] - p.bb[0] > 0.01 || p.bb[3] - p.bb[2] > 0.01)) map.fitBounds([[p.bb[0], p.bb[2]], [p.bb[1], p.bb[3]]], { maxZoom, padding: [10, 10] });
    else map.setView([p.lat, p.lon], Math.max(Math.min(map.getZoom(), maxZoom), o.zoom || p.zoom || 12));
    if (o.sheet !== false && window.tfSnapTo) window.tfSnapTo(o.sheet || "half");
  }

  const hitHtml = (p, i) => `<li><button type="button" data-i="${i}"><span class="ps-ic" aria-hidden="true">${esc(p.ic || "📍")}</span><span class="ps-tx"><b>${esc(p.name)}</b><small>${esc(p.sub || "")}</small></span></button></li>`;

  // ---------- a search box ----------
  // box({ placeholder, label, local(q) -> places shown while typing, onPick(place) (default: go there) })
  function box(o = {}) {
    const el = document.createElement("form");
    el.className = "ps-box";
    el.setAttribute("role", "search");
    el.innerHTML = `<div class="ps-row"><input type="search" class="ps-in" placeholder="${esc(o.placeholder || "Go to a town, mountain, lake or region")}" aria-label="${esc(o.label || o.placeholder || "Search a place")}" autocomplete="off" spellcheck="false" enterkeyhint="search"><button type="submit" class="ps-go">${esc(o.button || "Go")}</button></div>
      <p class="ps-msg" role="status"></p><ul class="ps-hits"></ul>`;
    const input = el.querySelector("input"), msg = el.querySelector(".ps-msg"), ul = el.querySelector("ul");
    let rows = [];
    const show = (list, note) => {
      rows = list;
      ul.innerHTML = list.map(hitHtml).join("");
      msg.textContent = note || "";
    };
    const pick = (p) => {
      logUse("pick", "Place");
      input.value = ""; input.blur(); show([]);
      if (o.onPick) o.onPick(p); else go(p);
    };
    ul.addEventListener("click", (e) => { const b = e.target.closest("button[data-i]"); if (b) pick(rows[+b.dataset.i]); });
    input.addEventListener("input", () => {
      const q = input.value.trim();
      const loc = q.length >= 2 && o.local ? o.local(q) || [] : [];
      show(loc.slice(0, 5), q.length >= 2 ? "Press Go to search every place with that name." : "");
    });
    el.addEventListener("submit", async (e) => {
      e.preventDefault();
      const q = input.value.trim();
      if (!q) return;
      const loc = o.local ? o.local(q) || [] : [];
      msg.textContent = `Finding ${q}…`;
      try {
        const found = await search(q);
        if (input.value.trim() !== q) return;
        const all = [...loc.slice(0, 3), ...found];
        logUse("search", "Place:" + q, all.length);
        if (!all.length) { show([], `Couldn't find “${q}”. Try a town or mountain name.`); return; }
        if (all.length === 1) { pick(all[0]); return; }
        input.blur();   // the phone keyboard out of the way of the list
        show(all, "Tap the one you mean.");
      } catch { show(loc.slice(0, 5), "Couldn't reach the place search. Check your signal, or move the map yourself."); }
    });
    el.tfInput = input;
    return el;
  }

  window.tfPlaceSearch = { search, go, box, parseGps, hitHtml };
})();
