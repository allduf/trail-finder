// Bike parks: lift-served bike parks, other bike parks, MTB centres, skills and jump parks, and pump and BMX tracks
// across Canada, from the nightly ca/bike-parks.json (scripts/build-bike-parks.mjs, OpenStreetMap). alex: "add data of
// all the bike park or the bike pump or every mtb center". A Layers button ("Bike parks", on by default) pins them on the
// map; tapping a pin shows what it is, whether it is lift-served, its website, hours, fee and links. Lift-served and other
// bike parks show from zoom 6, the small city places (skills parks, pump tracks) from zoom 11. Hidden in Skiing.
// index.html provides window.tfLeaflet and tfRenderKey (and the .rf-pin / .road-pop styles).
(() => {
  const map = window.tfLeaflet, btn = document.getElementById("parkBtn");
  if (!map || !window.L || !btn) return;

  const svg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const BIKE = `<circle cx="5.5" cy="16" r="3.5"/><circle cx="18.5" cy="16" r="3.5"/><path d="M5.5 16 9 9h7l2.5 7M9 9l3.5 7H5.5M14.5 5.5H17L16 9"/>`;
  const KIND = {
    lift: { svg: svg(`<path d="M2 5 22 3M12 4v5"/><rect x="7" y="9" width="10" height="7" rx="1.5"/><path d="M8.5 16v4M15.5 16v4M7 20h10"/>`), bg: "#d9480f", label: "Lift-served bike park", zoom: 5 },
    park: { svg: svg(BIKE), bg: "#7048e8", label: "Bike park", zoom: 6 },
    centre: { svg: svg(`<path d="M3 20h18M5 20V10l7-6 7 6v10"/><circle cx="9" cy="16" r="2"/><circle cx="15" cy="16" r="2"/><path d="M9 16l2-3h2l2 3"/>`), bg: "#0c8599", label: "MTB centre", zoom: 6 },
    skills: { svg: svg(`<path d="M2 19h20M3 19c2-6 5-8 8-8M13 19c1-5 4-8 8-9"/><circle cx="16.5" cy="5" r="2"/>`), bg: "#e67700", label: "Skills or jump park", zoom: 11 },
    pump: { svg: svg(`<path d="M2 16c2.5-5 5-5 7.5 0s5 5 7.5 0 3.5-4 5-2"/><path d="M2 20h20"/>`), bg: "#495057", label: "Pump track or BMX track", zoom: 11 },
  };
  const SUB = { pump: "Pump track", bmx: "BMX track", track: "Bike track (likely a pump track)" };
  const GAP = 28;   // px: below zoom 13, a pin this close to one already placed is skipped
  const pin = (k, cls = "") => `<span class="${cls}" style="background:${k.bg};color:#fff">${k.svg}</span>`;
  const kindOf = (x) => (x.lift === "yes" ? "lift" : x.k);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const ORDER = ["lift", "park", "centre", "skills", "pump"];
  // Lift-served bike parks the resort's own site confirms (checked 2026-10-22) but OpenStreetMap doesn't show as one: no lift
  // tagged for bikes and too few bike tags on the hill (Fernie, Panorama, Revelstoke), or a hill with no name (WinSport).
  // A place within 3 km becomes lift-served; with none, the park is added. Remove one once OpenStreetMap shows it.
  const KNOWN = [
    { name: "Fernie Alpine Resort", c: [49.4627, -115.0876], web: "https://skifernie.com/", src: "Fernie Alpine Resort's 2026 bike park trail list" },
    { name: "Panorama Mountain Resort", c: [50.4585, -116.2387], web: "https://www.panoramaresort.com/explore/dh-mountain-biking", src: "Panorama's 2024 DH trail map" },
    { name: "Revelstoke Mountain Resort", c: [50.9607, -118.1637], web: "https://www.revelstokemountainresort.com/mountain/conditions/trail-report/", src: "Revelstoke Mountain Resort's bike trail report" },
    { name: "WinSport Bike Park", c: [51.0794, -114.2161], web: "https://www.winsport.ca/explore-winsport/current-activities/mountain-biking/", src: "WinSport's 2026 summer trail map" },
  ];
  const metres = (a, b) => Math.hypot((b[0] - a[0]) * 110540, (b[1] - a[1]) * 111320 * Math.cos((a[0] * Math.PI) / 180));
  function addKnown(list) {
    KNOWN.forEach((h, i) => {
      const x = list.filter((x) => (x.lift || x.k === "park" || x.k === "centre") && metres(x.c, h.c) < 3000).sort((a, b) => metres(a.c, h.c) - metres(b.c, h.c))[0];
      if (!x) { list.push({ id: `h${i}`, k: "park", c: h.c, t: { name: h.name, website: h.web }, lift: "yes", known: h.src }); return; }
      x.lift = "yes"; x.known = h.src;
      x.t = { ...x.t, name: x.t.name || h.name, ...(x.t.website || x.t["contact:website"] ? {} : { website: h.web }) };
    });
    return list;
  }

  const css = document.createElement("style");
  css.textContent = `
.map-tools #parkBtn.on { background: #c2255c; border-color: #c2255c; color: #fff; }
.bp-pin span { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; border: 2.5px solid #fff; box-sizing: border-box;
  box-shadow: 0 0 0 1.5px rgba(0,0,0,.6), 0 2px 6px rgba(0,0,0,.45); cursor: pointer; }
.bp-pin span svg { width: 17px; height: 17px; }
.bp-pin.big span { width: 34px; height: 34px; } .bp-pin.big span svg { width: 21px; height: 21px; }
.legend .lg-ico.bp { border-radius: 50%; }
.bp-pop .tag { display: inline-block; font-size: .72rem; font-weight: 700; padding: 1px 6px; border-radius: 9px; margin: 2px 4px 0 0; background: #eef0f2; color: #333; }
.bp-pop .tag.lift { background: #d9480f; color: #fff; }
body.sport-ski #parkBtn, body.sport-ski .leaflet-bikeParks-pane { display: none !important; }`;
  document.head.appendChild(css);

  map.createPane("bikeParks").style.zIndex = 615;   // over trails and the other pins, under popups
  const layer = L.layerGroup().addTo(map), pins = new Map();
  let on = true, places = null, loading = null;
  try { const v = localStorage.getItem("tf:bikeParks"); if (v != null) on = JSON.parse(v); } catch {}

  function load() {
    if (!loading) loading = (/^https?:$/.test(location.protocol) ? fetch("ca/bike-parks.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)) : Promise.resolve(null))
      .catch(() => null).then((f) => {
        places = f && f.v === 1 ? addKnown(f.places).map((x) => ({ ...x, kind: kindOf(x) })).sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || (b.pay || 0) - (a.pay || 0)) : [];
        draw();
      });
    return loading;
  }

  const nameOf = (x) => x.t.name || x.t["name:en"] || x.t["name:fr"] || (x.lifts && x.lifts.length ? `${x.lifts[0]} bike lift` : null) || (x.kind === "pump" ? SUB[x.sub] || KIND.pump.label : `Unnamed ${KIND[x.kind].label.toLowerCase()}`);
  const what = (x) => (x.kind === "pump" ? SUB[x.sub] || KIND.pump.label : x.lift === "likely" ? "Bike park, likely lift-served" : KIND[x.kind].label);
  const link = (u) => { const s = String(u).trim(); return /^https?:\/\//i.test(s) ? s : /^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(s) ? `https://${s}` : null; };
  function popup(x) {
    const t = x.t, tags = [];
    if (x.lift === "likely") tags.push(`<span class="tag lift">Lifts on the hill: check they run for bikes this summer</span>`);
    else if (!x.lift && (x.kind === "park" || x.kind === "centre")) tags.push(`<span class="tag">No bike lift mapped</span>`);
    if (x.pay || t.fee === "yes") tags.push(`<span class="tag">Pay to ride</span>`);
    else if (t.fee === "no") tags.push(`<span class="tag">Free</span>`);
    if (t.lit === "yes") tags.push(`<span class="tag">Lit at night</span>`);
    const facts = [
      x.known && `Lift-served, says ${x.known}`,
      x.lifts && x.lifts.length && `Lifts open to bikes: ${x.lifts.join(", ")}`,
      x.pay && `${x.pay} pay-to-ride trail${x.pay === 1 ? "" : "s"} mapped`,
      x.mtb && !x.pay && `${x.mtb} MTB trail${x.mtb === 1 ? "" : "s"} mapped on the hill`,
      x.trails && x.trails.length && `Trails: ${x.trails.join(", ")}`,
      t.opening_hours && `Hours: ${t.opening_hours}`, t.seasonal && t.seasonal !== "no" && `Seasonal${t.seasonal === "yes" ? "" : `: ${t.seasonal}`}`,
      t.charge && `Price: ${t.charge}`, t.operator && t.operator !== t.name && `Run by ${t.operator}`,
      t.surface && `Surface: ${t.surface}`, t.access && !/^(yes|permissive|public)$/.test(t.access) && `Access: ${t.access}`,
      (t["addr:street"] || t["addr:city"]) && [t["addr:housenumber"], t["addr:street"], t["addr:city"]].filter(Boolean).join(" "),
      x.also && x.also.length && `Also mapped as ${x.also.join(", ")}`,
      t.description || t.note,
    ].filter(Boolean);
    const web = link(t.website || t["contact:website"] || t.url || ""), phone = t.phone || t["contact:phone"], fb = link(t["contact:facebook"] || t.facebook || "");
    const ll = `${x.c[0].toFixed(5)},${x.c[1].toFixed(5)}`, osm = { n: "node", w: "way", r: "relation" }[x.id[0]];
    const links = [
      web && `<a href="${esc(web)}" target="_blank" rel="noopener">Website</a>`, fb && !web && `<a href="${esc(fb)}" target="_blank" rel="noopener">Facebook</a>`,
      phone && `<a href="tel:${esc(phone.split(";")[0].replace(/[^\d+]/g, ""))}">${esc(phone.split(";")[0])}</a>`,
      `<a href="https://www.google.com/maps/dir/?api=1&destination=${ll}" target="_blank" rel="noopener">Directions</a>`,
      t.name && `<a href="https://www.trailforks.com/search/?q=${encodeURIComponent(t.name)}" target="_blank" rel="noopener">Search on Trailforks</a>`,
      osm && `<a href="https://www.openstreetmap.org/${osm}/${x.id.slice(1)}" target="_blank" rel="noopener">OpenStreetMap</a>`,
    ].filter(Boolean);
    return `<div class="road-pop bp-pop"><h4>${esc(nameOf(x))}</h4><p><span class="st">${esc(what(x))}</span><br>${tags.join("")}</p>
      ${facts.length ? `<p>${facts.map(esc).join("<br>")}</p>` : ""}<p class="src">${links.join(" · ")}</p>
      <p class="src">From OpenStreetMap. Check the website for this season's dates and prices.</p></div>`;
  }

  function draw() {
    const z = map.getZoom();
    if (!on || !places) { layer.clearLayers(); pins.clear(); return; }
    const view = map.getBounds().pad(0.2), placed = [], want = new Set();
    for (const x of places) {
      if (z < KIND[x.kind].zoom || !view.contains(x.c)) continue;
      const p = map.latLngToContainerPoint(x.c);
      if (z < 13 && placed.some((q) => q.distanceTo(p) < GAP)) continue;
      placed.push(p); want.add(x.id);
      if (!pins.has(x.id)) {
        const k = KIND[x.kind], big = x.kind === "lift";
        const m = L.marker(x.c, { pane: "bikeParks", keyboard: false, title: `${what(x)}: ${nameOf(x)}`,
          icon: L.divIcon({ className: `bp-pin${big ? " big" : ""}`, html: pin(k), iconSize: big ? [34, 34] : [28, 28] }) })
          .bindPopup(() => popup(x), { maxWidth: 290 });
        pins.set(x.id, m); layer.addLayer(m);
      }
    }
    pins.forEach((m, id) => { if (!want.has(id) && !m.isPopupOpen()) { layer.removeLayer(m); pins.delete(id); } });
  }
  map.on("moveend zoomend", draw);

  function sync() {
    btn.setAttribute("aria-pressed", String(on));
    btn.classList.toggle("on", on);
    btn.title = on ? "Hide the bike parks, pump tracks and MTB centres" : "Show bike parks, pump tracks and MTB centres across Canada";
  }
  btn.addEventListener("click", () => {
    on = !on;
    try { localStorage.setItem("tf:bikeParks", JSON.stringify(on)); } catch {}
    sync();
    if (on) load(); draw();
    if (window.tfRenderKey) window.tfRenderKey();
  });
  sync();
  if (on) load();

  // For index.html's map key and for anyone wanting the list.
  window.tfBikeParks = {
    on: () => on,
    keyItems: () => ORDER.map((k) => `<li><span class="lg-ico bp" style="background:${KIND[k].bg};color:#fff">${KIND[k].svg}</span>${KIND[k].label}${KIND[k].zoom > 6 ? " (zoom in)" : ""}</li>`).join(""),
    list: () => load().then(() => places),
  };
  if (window.tfRenderKey) window.tfRenderKey();
})();
