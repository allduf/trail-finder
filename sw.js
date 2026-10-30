// Trail Finder service worker: makes the site installable and lets it open with no signal.
// Pages, scripts and data/*.json are network first, so a fresh deploy and each nightly data build show up as soon
// as there is a connection; the cached copy is used only when the network fails. Outside APIs (Open-Meteo, Supabase)
// are not touched; map tiles only as TILES says (OpenStreetMap, heights, Winter photos), and the OpenFreeMap map and data files saved in
// Offline maps (offline.js), which are served from the OFFLINE cache when there's no connection, and the Hunting
// picture layers and terrain tiles saved by hunting.js ("Hunting maps offline"), which are served from it first.
const VERSION = "tf-1078";
const OFFLINE = "tf-offline-1";   // filled and emptied by offline.js; kept across new versions of the site
const SHELL = [
  "./", "index.html", "ride.html", "theme.css?v=14", "account.js?v=1270", "reports.js?v=1270", "grades.js?v=1270", "trail-photos.js?v=1270", "status.js?v=1270", "ask.js?v=1270", "visitors.js?v=1270", "usage.js?v=1270", "map3d.js?v=1270", "ski-terrain.js?v=1270", "winter.js?v=1270", "place-search.js?v=1270", "clouds.js?v=1270", "smoke.js?v=1270", "radar.js?v=1270", "live.js?v=1270", "ski-points.js?v=1270", "hunts.js?v=1270", "webcams.js?v=1270", "lifts.js?v=1270", "ski-areas.js?v=1270", "helicat.js?v=1270", "cabin-trip.js?v=1270", "rogers.js?v=1270", "slackcountry.js?v=1270", "crownland.js?v=1270", "hunting.js?v=1270", "fish-bait.js?v=1270", "fish-route.js?v=1270", "fishing.js?v=1270", "moto.js?v=1270", "moto-roads.js?v=1270", "compass.js?v=1270", "offline.js?v=1270", "native-gps.js?v=1270", "native.js?v=1270", "keyboard.js?v=1270", "navigate.js?v=1270", "ride-stats.js?v=1270", "ride-finds.js?v=1270", "rides.js?v=1270", "planner.js?v=1270", "rotate.js?v=1270", "photo-find.js?v=1270", "ebike.js?v=1270", "closures.js?v=1270", "loops.js?v=1270", "strava.js?v=1270", "share.js?v=1270", "community.js?v=1270", "ride-files.js?v=1270", "rider-trails.js?v=1270", "alpine.js?v=1270", "areas.js?v=1270", "bikeparks.js?v=1270", "contours.js?v=1270", "directions.js?v=1270", "notify.js?v=1270", "official.js?v=1270", "photo-slider.js?v=1270", "ratings.js?v=1270", "whats-new.js?v=1270", "app-update.js?v=1270", "welcome.js?v=1270", "manifest.webmanifest",
  "privacy.html", "support.html",
  "icons/icon-180.png", "icons/icon-192.png", "icons/icon-512.png", "icons/favicon.svg",
  "vendor/leaflet-1.9.4.js",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css",
  "vendor/leaflet-rotate-0.2.8.js",
];
// Versioned libraries and fonts: they never change at the same URL, so the cached copy is served first.
const STATIC_HOSTS = ["cdnjs.cloudflare.com", "unpkg.com", "fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => null)))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== OFFLINE && !TILES.some((t) => t.name === k)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Data files (data/*.json) on a slow connection: when the network takes longer than DATA_WAIT_MS and a saved copy is
// there, the saved copy is used and the download carries on in the background for next time (alex, 2026-10-23: the
// app took a long time to open; on weak phone signal every file waited for the network). The page itself gets
// PAGE_WAIT_MS the same way (alex, 2026-10-24: "make the app faster"; on weak signal at a trailhead the app sat on a
// blank screen for 5 s or more downloading a page it already had). A saved page only ever runs with the scripts saved
// with it (the same cache), and a fresh deploy still shows on the next open with any signal. Other files without a
// ?v= always wait for the network.
const DATA_WAIT_MS = 1500, PAGE_WAIT_MS = 2000;
async function networkFirst(req, e) {
  const cache = await caches.open(VERSION);
  try {
    // no-cache: check GitHub Pages for a newer copy instead of using the browser's 10-minute cached one, so a
    // fresh deploy shows up on the next load. (A navigation request can't take options, and reloads check anyway.)
    const net = (req.mode === "navigate" ? fetch(req) : fetch(req, { cache: "no-cache" })).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        e.waitUntil((async () => {
          await cache.put(req, copy);
          const off = await caches.open(OFFLINE);   // keep a saved area's trail data as fresh as the last visit
          if (await off.match(req)) await off.put(req, await cache.match(req));
        })().catch(() => null));
      }
      return res;
    });
    const page = req.mode === "navigate";
    if (page || /\/data\/[^?]*\.json$/.test(new URL(req.url).pathname)) {
      const home = page && /\/(index\.html)?$/.test(new URL(req.url).pathname);
      const hit = page ? await caches.match(req, { ignoreSearch: true }) || (home ? await cache.match("index.html") : null) : await caches.match(req);
      if (hit) {
        e.waitUntil(net.catch(() => null));
        // The whole file, not just its first bytes: a big file can start quickly and then crawl.
        const whole = net.then(async (r) => (r.ok ? new Response(await r.blob(), { status: r.status, statusText: r.statusText, headers: r.headers }) : null)).catch(() => null);
        const slow = new Promise((ok) => setTimeout(() => ok(null), page ? PAGE_WAIT_MS : DATA_WAIT_MS));
        return (await Promise.race([whole, slow])) || hit;
      }
    }
    return await net;
  } catch (err) {
    const hit = await caches.match(req, { ignoreSearch: req.mode === "navigate" });
    if (hit) return hit;
    if (req.mode === "navigate") { const home = await cache.match("index.html"); if (home) return home; }
    throw err;
  }
}

async function cacheFirst(req) {
  const hit = await caches.match(req);
  // A copy saved from a <script> or <link> tag is opaque, which a script's own download (CORS) can't use: the browser
  // makes that a failed download. Offline maps' 3D files (MapLibre from unpkg) stayed "Not finished" for good because
  // of it (phone-size test, 2026-10-30): those get the network, as a normal download.
  if (hit && !(hit.type === "opaque" && req.mode === "cors")) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === "opaque") (await caches.open(VERSION)).put(req, res.clone());
  return res;
}

// OpenFreeMap: tiles, fonts and sprites have fixed contents, so a saved copy is used first. The style and TileJSON
// change (each weekly map build has a new tile address), so they come from the network, or the saved copy when
// that fails or takes over 4 s. Nothing is saved here: offline.js decides what's kept.
async function openFreeMap(req) {
  const off = await caches.open(OFFLINE);
  const hit = await off.match(req.url, { ignoreVary: true });
  if (!hit) return fetch(req);
  if (/\.(pbf|png|json)$/.test(new URL(req.url).pathname) && !/\/styles\//.test(req.url)) return hit;
  try {
    return await Promise.race([fetch(req), new Promise((_, no) => setTimeout(() => no(new Error("slow")), 4000))]);
  } catch { return hit; }
}

// Hunting layers (DataBC and Alberta map images, terrain tiles) and the 3D map's heights (Mapterhorn) and Winter photos
// (the trail-finder-winter and -winter2 sites) saved with an area: the saved copy when there is one, else the network. The Winter
// photos are never put in the site's own cache (they used to be, as any same-site file: thousands of them).
const HUNT_HOSTS = ["openmaps.gov.bc.ca", "geospatial.alberta.ca", "s3.amazonaws.com", "tiles.mapterhorn.com"];
async function savedFirst(req) {
  const hit = await (await caches.open(OFFLINE)).match(req.url, { ignoreVary: true });
  return hit || fetch(req);
}

// Map pictures kept on the phone after they're seen, so the map is there at once when the app opens again and the 3D
// ground isn't blank or blurry for 1-3 s while tiles just seen come again (alex 2026-10-30). Each kind has its own
// cache with a size limit, kept across new versions of the site; the oldest go first. Esri's photos aren't kept
// (their terms), nor anything the app saves for no signal (offline.js, OFFLINE above, used first).
//  - photos: last winter's photos (our own trail-finder-winter sites; rebuilt only now and then), ~7 KB each
//  - heights: Mapterhorn's (it says keep 7 days), ~200 KB each
//  - osm: OpenStreetMap's map; shown from here at once and fetched again in the background when over a day old,
//    as OpenStreetMap asks apps to keep its tiles rather than download them on every open
const TILES = [
  { name: "tf-tiles-photos", max: 4000, days: 30, test: (u) => u.origin === self.location.origin && /\/trail-finder-winter2?\/\d+\/\d+\/\d+\.webp$/.test(u.pathname) },
  { name: "tf-tiles-heights", max: 200, days: 7, test: (u) => u.hostname === "tiles.mapterhorn.com" },
  { name: "tf-tiles-osm", max: 2000, days: 7, fresh: 1, test: (u) => u.hostname === "tile.openstreetmap.org" },
];
const DAY_MS = 864e5;
const puts = {};
async function keepTile(kind, url, res) {
  const c = await caches.open(kind.name);
  // When it was saved, for days/fresh above (the server's own date header can't be read on every answer).
  const body = await res.blob();
  await c.put(url, new Response(body, { status: 200, headers: { "content-type": res.headers.get("content-type") || "", "x-tf-saved": String(Date.now()) } }));
  if ((puts[kind.name] = (puts[kind.name] || 0) + 1) % 100) return;
  const keys = await c.keys();   // oldest first
  await Promise.all(keys.slice(0, Math.max(0, keys.length - kind.max)).map((k) => c.delete(k)));
}
async function tileFirst(req, kind, e) {
  const url = req.url, off = await (await caches.open(OFFLINE)).match(url, { ignoreVary: true });
  if (off) return off;
  const hit = await (await caches.open(kind.name)).match(url);
  const age = hit ? Date.now() - Number(hit.headers.get("x-tf-saved") || 0) : Infinity;
  // Asked again as a normal download (with CORS), not the picture's own no-cors one: a no-cors answer can't be read,
  // and browsers count each one as megabytes of storage.
  const get = () => fetch(url, { mode: "cors", credentials: "omit", signal: hit ? undefined : req.signal }).then((res) => {
    if (res.ok) { const p = keepTile(kind, url, res.clone()).catch(() => {}); try { e.waitUntil(p); } catch {} }
    return res;
  });
  if (hit && (!kind.days || age < kind.days * DAY_MS)) {
    if (kind.fresh && age > kind.fresh * DAY_MS) { const p = get().catch(() => {}); try { e.waitUntil(p); } catch {} }
    return hit;
  }
  try { return await get(); } catch (err) { if (hit) return hit; throw err; }
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // A script with ?v= (bumped on every change) or a file in vendor/ (version in its name) never changes at the same
  // address, so the saved copy is served first. alex, 2026-10-24 ("it lag", blank map, empty Area list): right after
  // a deploy the page sat waiting on the network for scripts it already had.
  const tile = TILES.find((t) => t.test(url));
  if (tile) e.respondWith(tileFirst(req, tile, e).catch(() => fetch(req)));
  else if (url.origin === self.location.origin && (url.searchParams.has("v") || url.pathname.includes("/vendor/"))) e.respondWith(cacheFirst(req));
  else if (url.origin === self.location.origin && /\/trail-finder-winter2?\//.test(url.pathname) && !url.pathname.endsWith(".json")) e.respondWith(savedFirst(req));
  else if (url.origin === self.location.origin) e.respondWith(networkFirst(req, e));
  else if (STATIC_HOSTS.includes(url.hostname)) e.respondWith(cacheFirst(req));
  else if (url.hostname === "tiles.openfreemap.org") e.respondWith(openFreeMap(req));
  else if (HUNT_HOSTS.includes(url.hostname)) e.respondWith(savedFirst(req));
});

// Phone notifications (prime loam alerts, scripts/push-loam.mjs). Tapping one opens the 🔔 box: in an open
// Trail Finder window through a message to notify.js, else in a new one through #loam.
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Trail Finder", {
    body: d.body || "", tag: d.tag || "tf", icon: "icons/icon-192.png", badge: "icons/icon-192.png", data: { url: d.url || "./" },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "./", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    const w = list.find((c) => c.url.startsWith(self.registration.scope) && !/ride\.html/.test(c.url));
    if (w) { w.postMessage({ tf: "loam" }); return w.focus(); }
    return self.clients.openWindow(url);
  }));
});
