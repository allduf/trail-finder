// Trail Finder service worker: makes the site installable and lets it open with no signal.
// Pages, scripts and data/*.json are network first, so a fresh deploy and each nightly data build show up as soon
// as there is a connection; the cached copy is used only when the network fails. Map tiles and outside APIs
// (OpenStreetMap, Open-Meteo, Supabase) are not touched, except the OpenFreeMap map and data files saved in
// Offline maps (offline.js), which are served from the OFFLINE cache when there's no connection, and the Hunting
// picture layers and terrain tiles saved by hunting.js ("Hunting maps offline"), which are served from it first.
const VERSION = "tf-342";
const OFFLINE = "tf-offline-1";   // filled and emptied by offline.js; kept across new versions of the site
const SHELL = [
  "./", "index.html", "ride.html", "theme.css?v=13", "account.js?v=534", "reports.js?v=534", "grades.js?v=534", "trail-photos.js?v=534", "status.js?v=534", "visitors.js?v=534", "usage.js?v=534", "map3d.js?v=534", "ski-terrain.js?v=534", "winter.js?v=534", "place-search.js?v=534", "clouds.js?v=534", "smoke.js?v=534", "ski-points.js?v=534", "hunts.js?v=534", "webcams.js?v=534", "lifts.js?v=534", "ski-areas.js?v=534", "helicat.js?v=534", "rogers.js?v=534", "slackcountry.js?v=534", "hunting.js?v=534", "fish-bait.js?v=534", "fish-route.js?v=534", "fishing.js?v=534", "moto.js?v=534", "compass.js?v=534", "offline.js?v=534", "native-gps.js?v=534", "native.js?v=534", "keyboard.js?v=534", "navigate.js?v=534", "ride-stats.js?v=534", "ride-finds.js?v=534", "rides.js?v=534", "planner.js?v=534", "rotate.js?v=534", "photo-find.js?v=534", "ebike.js?v=534", "closures.js?v=534", "loops.js?v=534", "strava.js?v=534", "share.js?v=534", "community.js?v=534", "ride-files.js?v=534", "rider-trails.js?v=534", "alpine.js?v=534", "areas.js?v=534", "bikeparks.js?v=534", "contours.js?v=534", "directions.js?v=534", "notify.js?v=534", "official.js?v=534", "photo-slider.js?v=534", "ratings.js?v=534", "whats-new.js?v=534", "welcome.js?v=534", "manifest.webmanifest",
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
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== OFFLINE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
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
  if (hit) return hit;
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
// (the trail-finder-winter site) saved with an area: the saved copy when there is one, else the network. The Winter
// photos are never put in the site's own cache (they used to be, as any same-site file: thousands of them).
const HUNT_HOSTS = ["openmaps.gov.bc.ca", "geospatial.alberta.ca", "s3.amazonaws.com", "tiles.mapterhorn.com"];
async function savedFirst(req) {
  const hit = await (await caches.open(OFFLINE)).match(req.url, { ignoreVary: true });
  return hit || fetch(req);
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // A script with ?v= (bumped on every change) or a file in vendor/ (version in its name) never changes at the same
  // address, so the saved copy is served first. alex, 2026-10-24 ("it lag", blank map, empty Area list): right after
  // a deploy the page sat waiting on the network for scripts it already had.
  if (url.origin === self.location.origin && (url.searchParams.has("v") || url.pathname.includes("/vendor/"))) e.respondWith(cacheFirst(req));
  else if (url.origin === self.location.origin && url.pathname.includes("/trail-finder-winter/") && !url.pathname.endsWith(".json")) e.respondWith(savedFirst(req));
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
