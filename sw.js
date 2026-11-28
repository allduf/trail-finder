// Trail Finder service worker: makes the site installable and lets it open with no signal.
// Pages, scripts and data/*.json are network first, so a fresh deploy and each nightly data build show up as soon
// as there is a connection; the cached copy is used only when the network fails. Outside APIs (Open-Meteo, Supabase)
// are not touched; map tiles only as TILES says (OpenStreetMap, heights, Winter photos), and the OpenFreeMap map and data files saved in
// Offline maps (offline.js), which are served from the OFFLINE cache when there's no connection, and the Hunting
// picture layers and terrain tiles saved by hunting.js ("Hunting maps offline"), which are served from it first.
const VERSION = "tf-__V__";   // set at publish by scripts/stamp.mjs (one number for the whole site, ?v= too): never edit
const OFFLINE = "tf-offline-1";   // before 2026-11-21: Offline maps' files; now moved to IndexedDB (offline-store.js)
// Offline maps' saved files and the map pictures kept after they're seen live in IndexedDB (offline-store.js): any
// file in the browser's caches slowed the iPhone app's start (2026-11-21, scripts/start-speed.mjs).
try { importScripts("offline-store.js?v=__V__"); } catch {}
const F = self.tfFiles || null;
// A saved Offline maps file: IndexedDB (and the old cache until it's moved), else nothing.
const offMatch = async (url) => (F ? F.offline.match(url) : (await caches.open(OFFLINE)).match(url, { ignoreVary: true }));
const SHELL = [
  "./", "index.html", "ride.html", "theme.css?v=__V__", "account.js?v=__V__", "friends.js?v=__V__", "moderation.js?v=__V__", "reports.js?v=__V__", "grades.js?v=__V__", "trail-photos.js?v=__V__", "status.js?v=__V__", "today.js?v=__V__", "ask.js?v=__V__", "visitors.js?v=__V__", "usage.js?v=__V__", "map3d.js?v=__V__", "ski-terrain.js?v=__V__", "winter.js?v=__V__", "place-search.js?v=__V__", "clouds.js?v=__V__", "wxcheck.js?v=__V__", "point-info.js?v=__V__", "smoke.js?v=__V__", "radar.js?v=__V__", "live.js?v=__V__", "ski-points.js?v=__V__", "hunts.js?v=__V__", "webcams.js?v=__V__", "lifts.js?v=__V__", "ski-areas.js?v=__V__", "helicat.js?v=__V__", "trip-core.js?v=__V__", "cabin-trip.js?v=__V__", "camper.js?v=__V__", "japanese.js?v=__V__", "japan-snow.js?v=__V__", "jp-resorts.js?v=__V__", "rogers.js?v=__V__", "slackcountry.js?v=__V__", "freeride.js?v=__V__", "crownland.js?v=__V__", "hunting.js?v=__V__", "fish-bait.js?v=__V__", "fish-route.js?v=__V__", "ski-route.js?v=__V__", "fishing.js?v=__V__", "moto.js?v=__V__", "moto-roads.js?v=__V__", "hike.js?v=__V__", "hike-trip.js?v=__V__", "bike-trip.js?v=__V__", "moto-trip.js?v=__V__", "moto-day.js?v=__V__", "hunting-trip.js?v=__V__", "fishing-trip.js?v=__V__", "compass.js?v=__V__", "offline.js?v=__V__", "native-gps.js?v=__V__", "native.js?v=__V__", "native-map.js?v=__V__", "native-ground.js?v=__V__", "native-fishing.js?v=__V__", "native-flyover.js?v=__V__", "native-moto.js?v=__V__", "native-offline.js?v=__V__", "native-pins.js?v=__V__", "native-search.js?v=__V__", "native-tools.js?v=__V__", "native-fingers.js?v=__V__", "keyboard.js?v=__V__", "navigate.js?v=__V__", "go-there.js?v=__V__", "ride-stats.js?v=__V__", "ride-finds.js?v=__V__", "rides.js?v=__V__", "planner.js?v=__V__", "rotate.js?v=__V__", "skyline.js?v=__V__", "photo-find.js?v=__V__", "ebike.js?v=__V__", "closures.js?v=__V__", "loops.js?v=__V__", "strava.js?v=__V__", "share.js?v=__V__", "community.js?v=__V__", "ride-files.js?v=__V__", "rider-trails.js?v=__V__", "alpine.js?v=__V__", "areas.js?v=__V__", "bikeparks.js?v=__V__", "contours.js?v=__V__", "shade.js?v=__V__", "finger-measure.js?v=__V__", "directions.js?v=__V__", "notify.js?v=__V__", "official.js?v=__V__", "photo-slider.js?v=__V__", "ratings.js?v=__V__", "whats-new.js?v=__V__", "season.js?v=__V__", "tutorials.js?v=__V__", "app-update.js?v=__V__", "rate.js?v=__V__", "hidden-places.js?v=__V__", "noback.js?v=__V__", "risk.js?v=__V__", "welcome.js?v=__V__", "feedback.js?v=__V__", "i18n.js?v=__V__", "line-icons.js?v=__V__", "offline-store.js?v=__V__", "i18n-fr.js?v=__V__", "adv-map.js?v=__V__", "manifest.webmanifest",
  "privacy.html", "support.html", "join.html", "terms.html", "credits.html",
  "icons/icon-180.png", "icons/icon-192.png", "icons/icon-512.png", "icons/favicon.svg",
  "vendor/leaflet-1.9.4.js",
  "vendor/leaflet-1.9.4.css",
  "vendor/leaflet-rotate-0.2.8.js",
  "vendor/fonts-5.3.0/app-fonts.css", "vendor/fonts-5.3.0/archivo-latin-wdth-normal.woff2", "vendor/fonts-5.3.0/inter-latin-wght-normal.woff2",
  "vendor/fonts-5.3.0/ride-fonts.css", "vendor/fonts-5.3.0/barlow-condensed-latin-600-normal.woff2", "vendor/fonts-5.3.0/barlow-condensed-latin-700-normal.woff2",
  "vendor/fonts-5.3.0/barlow-latin-400-normal.woff2", "vendor/fonts-5.3.0/barlow-latin-500-normal.woff2", "vendor/fonts-5.3.0/barlow-latin-600-normal.woff2",
  "vendor/fonts-5.3.0/jetbrains-mono-latin-400-normal.woff2",
];
// Versioned libraries: they never change at the same URL, so the cached copy is served first.
const STATIC_HOSTS = ["cdnjs.cloudflare.com", "unpkg.com"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => null)))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  // The version just before this one is kept too: a page opened from it (served at once, below) may still be running and
  // load its sport scripts later, and those must be its own, not this version's under the old ?v= address.
  e.waitUntil(caches.keys().then((keys) => {
    const num = (k) => (/^tf-\d+$/.test(k) ? +k.slice(3) : -1), mine = num(VERSION);
    const prev = Math.max(-1, ...keys.map(num).filter((n) => n < mine));
    return Promise.all(keys.filter((k) => k !== VERSION && k !== OFFLINE && !(TILES.some((t) => t.name === k) && !F) && !(prev >= 0 && num(k) === prev)).map((k) => caches.delete(k)));
  }).then(() => self.clients.claim()));
});

// Data files (data/*.json) on a slow connection: when the network takes longer than DATA_WAIT_MS and a saved copy is
// there, the saved copy is used and the download carries on in the background for next time (alex, 2026-10-23: the
// app took a long time to open; on weak phone signal every file waited for the network). The page itself gets
// PAGE_WAIT_MS the same way (alex, 2026-10-24: "make the app faster"; on weak signal at a trailhead the app sat on a
// blank screen for 5 s or more downloading a page it already had). A saved page only ever runs with the scripts saved
// with it (the same cache), and a fresh deploy still shows on the next open with any signal. Other files without a
// ?v= always wait for the network.
// The page itself (alex, 2026-11-06: "make it as fast as possible", first impressions): a saved page is shown at once
// and the new one downloaded for next time. Phones reported ~2 s for the page on every open, the PAGE_WAIT_MS cap,
// before anything showed. A new deploy shows on the open after the one that downloads it (the same as the iPhone
// app's own update), and the previous version's files are kept (activate above) for a page still running from it.
const DATA_WAIT_MS = 1500, PAGE_WAIT_MS = 2000;
// Cloudflare Pages (since 2026-11-07) answers ride.html and index.html with a 308 to /ride and /. A saved copy that came
// through a redirect can't answer a page open: the browser shows "This site can't be reached" (alex 2026-11-08, My tours
// on a computer). Such a copy is rebuilt as a plain answer before it's used.
async function plain(r) {
  if (!r || !r.redirected) return r;
  return new Response(await r.blob(), { status: r.status, statusText: r.statusText, headers: r.headers });
}
// The saved copy of one of the site's own files: this version's cache first, then the older versions' still kept.
// Never all caches at once (caches.match) unless those miss: that opens Offline maps' cache and the map pictures' too
// (tens of thousands of files after a 300-600 MB save), and an iPhone reads the list of every file in a cache the first
// time it's opened after the app starts. Alex's iPhone app took 3-4 s for the page on each open after a big offline save
// (2026-11-21, usage Speed rows), against under 1 s before: scripts and data are looked up here first.
async function ownHit(req, offline) {
  const hit = await (await caches.open(VERSION)).match(req);
  if (hit) return hit;
  // A data file saved with an area (Offline maps keeps it as fresh as the last visit) before an older version's copy.
  if (offline) { const h = await offMatch(req.url); if (h) return h; }
  const older = (await caches.keys()).filter((k) => /^tf-\d+$/.test(k) && k !== VERSION).reverse();
  for (const k of older) { const h = await (await caches.open(k)).match(req); if (h) return h; }
  return null;
}
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
          // Keep a saved area's data as fresh as the last visit (data/*.json, Adventure moto's ca/moto/*.json...).
          // JSON files only: Offline maps saves no pages or scripts, and opening its big cache for each of them on
          // every page open slowed the start (see ownHit).
          if (!/\.json$/.test(new URL(req.url).pathname)) return;
          if (F) { if (await F.offline.has(req.url)) await F.offline.put(req.url, await cache.match(req)); return; }
          const off = await caches.open(OFFLINE);
          if (await off.match(req)) await off.put(req, await cache.match(req));
        })().catch(() => null));
      }
      return res;
    });
    const page = req.mode === "navigate";
    if (page || /\/data\/[^?]*\.json$/.test(new URL(req.url).pathname)) {
      const home = page && /\/(index\.html)?$/.test(new URL(req.url).pathname);
      const hit = page ? await cache.match(req, { ignoreSearch: true }) || (home ? await cache.match("index.html") : null) || await caches.match(req, { ignoreSearch: true }) : await ownHit(req, true);
      if (hit) {
        e.waitUntil(net.catch(() => null));
        // Shown at once: the app itself (the map and My rides). Every other page (usage, privacy, join...) is opened
        // rarely, so a saved copy there can be days old: it waits for the network like a data file (alex 2026-11-22: the
        // usage page showed its copy from before the sign-in person check, and sign-in failed until a reload).
        if (page && hit.ok && /\/(index\.html|ride(\.html)?)?$/.test(new URL(req.url).pathname)) return plain(hit);
        // The whole file, not just its first bytes: a big file can start quickly and then crawl.
        const whole = net.then(async (r) => (r.ok ? new Response(await r.blob(), { status: r.status, statusText: r.statusText, headers: r.headers }) : null)).catch(() => null);
        const slow = new Promise((ok) => setTimeout(() => ok(null), page ? PAGE_WAIT_MS : DATA_WAIT_MS));
        return (await Promise.race([whole, slow])) || plain(hit);
      }
    }
    return await plain(await net);
  } catch (err) {
    const hit = await caches.match(req, { ignoreSearch: req.mode === "navigate" }) || (req.mode === "navigate" || !F ? null : await F.offline.match(req.url));
    if (hit) return plain(hit);
    if (req.mode === "navigate") { const home = await cache.match("index.html"); if (home) return plain(home); }
    throw err;
  }
}

async function cacheFirst(req) {
  // A copy saved from a <script> or <link> tag is opaque, which a script's own download (CORS) can't use: the browser
  // makes that a failed download. Offline maps' 3D files (MapLibre from unpkg) stayed "Not finished" for good because
  // of it (phone-size test, 2026-10-30): those get the network, as a normal download.
  const usable = (h) => h && !(h.type === "opaque" && req.mode === "cors");
  const hit = await ownHit(req);
  if (usable(hit)) return hit;
  // Not in the app's own caches: the network, and every cache (Offline maps' 3D files) only with no network.
  let res;
  try { res = await fetch(req); } catch (err) { const any = await caches.match(req) || (F ? await F.offline.match(req.url) : null); if (usable(any)) return any; throw err; }
  if (res.ok || res.type === "opaque") (await caches.open(VERSION)).put(req, res.clone());
  return res;
}

// OpenFreeMap: tiles, fonts and sprites have fixed contents, so a saved copy is used first. The style and TileJSON
// change (each weekly map build has a new tile address), so they come from the network, or the saved copy when
// that fails or takes over 4 s. Nothing is saved here: offline.js decides what's kept.
async function openFreeMap(req) {
  const hit = await offMatch(req.url);
  if (!hit) { try { return await fetch(req); } catch (err) { const alt = await ofmElsewhere(req.url); if (alt) return alt; throw err; } }
  if (/\.(pbf|png|json)$/.test(new URL(req.url).pathname) && !/\/styles\//.test(req.url)) return hit;
  try {
    return await Promise.race([fetch(req), new Promise((_, no) => setTimeout(() => no(new Error("slow")), 4000))]);
  } catch { return hit; }
}

// OpenFreeMap's map has a new address every week (planet/<build>/{z}/{x}/{y}.pbf), and its style can point to another copy
// (backup_planet, since 2026-11) than the one the 3D map and the sports ask for (planet). A saved area keeps the tiles of
// the address it was saved with, so with no signal a tile, or the list of addresses (TileJSON), that isn't saved under the
// address asked for is looked for under each address an area was saved with (offline.js keeps that list, OFM_SAVED).
// Before 2026-11-27 the 3D map's ground was blank with no signal, and an area saved in an earlier week than the last
// save showed no map.
const OFM_SAVED = "https://tiles.openfreemap.org/tf-saved";
let ofmSaved = null, ofmAt = 0;
const ofmLists = () => {
  if (!ofmSaved || Date.now() - ofmAt > 30000) { ofmAt = Date.now(); ofmSaved = offMatch(OFM_SAVED).then((r) => (r ? r.json() : {})).catch(() => ({})); }
  return ofmSaved;
};
async function ofmElsewhere(url) {
  const u = new URL(url), saved = (await ofmLists()) || {};
  const t = u.pathname.match(/\/(\d+)\/(\d+)\/(\d+)\.pbf$/);
  if (t) {
    for (const tm of saved.tiles || []) {
      const alt = tm.replace("{z}", t[1]).replace("{x}", t[2]).replace("{y}", t[3]);
      if (alt !== url) { const h = await offMatch(alt); if (h) return h; }
    }
    return null;
  }
  if (!/^\/[\w-]+\/?$/.test(u.pathname)) return null;   // a TileJSON (planet, backup_planet), not a style, font or sprite
  for (const alt of new Set([...(saved.tj || []), "https://tiles.openfreemap.org/backup_planet", "https://tiles.openfreemap.org/planet"])) {
    if (alt !== url) { const h = await offMatch(alt); if (h) return h; }
  }
  return null;
}

// Hunting layers (DataBC and Alberta map images, terrain tiles) and the 3D map's heights (Mapterhorn) and Winter photos
// (the trail-finder-winter and -winter2 sites) saved with an area: the saved copy when there is one, else the network. The Winter
// photos are never put in the site's own cache (they used to be, as any same-site file: thousands of them).
const HUNT_HOSTS = ["openmaps.gov.bc.ca", "geospatial.alberta.ca", "s3.amazonaws.com", "tiles.mapterhorn.com"];
async function savedFirst(req) {
  const hit = await offMatch(req.url);
  return hit || fetch(req);
}
// Their lists of squares (blocks.json, sharp.json) change when the photos are rebuilt: the network first, and the copy
// saved with an area only with no signal. Before 2026-11-21 nothing answered them offline, so with no signal the saved
// Winter photos weren't shown (the lists came back empty).
async function savedIfNoNet(req) {
  // A weak signal can hang instead of failing: the saved copy after 4 s.
  try { return await Promise.race([fetch(req), new Promise((_, no) => setTimeout(() => no(new Error("slow")), 4000))]); }
  catch (err) { const hit = await offMatch(req.url); if (hit) return hit; throw err; }
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
  { name: "tf-tiles-photos", max: 4000, days: 30, test: (u) => (u.origin === self.location.origin || /^(allduf\.github\.io|trailfinder-winter2?\.netlify\.app|trailfinder-w[12]-\d+\.pages\.dev|trailfinder-summer(-15)?\.pages\.dev|trailfinder-sharpmid\.pages\.dev|trailfinder-sharp-\d+\.pages\.dev|trailfinder-sharpca-\d+\.pages\.dev|trailfinder-wide-\d+\.pages\.dev)$/.test(u.hostname)) && /\/trail-finder-(winter2?|summer|wide)\/\d+\/\d+\/\d+\.webp$/.test(u.pathname) },
  { name: "tf-tiles-heights", max: 200, days: 7, test: (u) => u.hostname === "tiles.mapterhorn.com" },
  { name: "tf-tiles-dirt", max: 1500, days: 7, test: (u) => /^trailfinder-dirt-\d\.pages\.dev$/.test(u.hostname) },   // ADV topo's far dirt roads (adv-map.js)
  { name: "tf-tiles-osm", max: 2000, days: 7, fresh: 1, test: (u) => u.hostname === "tile.openstreetmap.org" },
];
const DAY_MS = 864e5;
const puts = {};
async function keepTile(kind, url, res) {
  const body = await res.blob();
  if (F) return F.tilePut(kind.name, url, body, res.headers.get("content-type"), kind.max);
  const c = await caches.open(kind.name);
  // When it was saved, for days/fresh above (the server's own date header can't be read on every answer).
  await c.put(url, new Response(body, { status: 200, headers: { "content-type": res.headers.get("content-type") || "", "x-tf-saved": String(Date.now()) } }));
  if ((puts[kind.name] = (puts[kind.name] || 0) + 1) % 100) return;
  const keys = await c.keys();   // oldest first
  await Promise.all(keys.slice(0, Math.max(0, keys.length - kind.max)).map((k) => c.delete(k)));
}
async function tileFirst(req, kind, e) {
  const url = req.url, off = await offMatch(url);
  if (off) return off;
  let hit, saved = 0;
  if (F) { const rec = await F.tileGet(url); if (rec && rec.b) { hit = F.response(rec); saved = rec.at || 0; } }
  else { hit = await (await caches.open(kind.name)).match(url); saved = hit ? Number(hit.headers.get("x-tf-saved") || 0) : 0; }
  const age = hit ? Date.now() - saved : Infinity;
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
  // Tutorial videos (tutorials.js): the browser's own loading. iPhones ask for a video in pieces (Range), which a saved
  // copy can't answer, and an 8 MB video shouldn't fill the saved files.
  if (url.origin === self.location.origin && url.pathname.includes("/videos/")) return;
  // A script with ?v= (bumped on every change) or a file in vendor/ (version in its name) never changes at the same
  // address, so the saved copy is served first. alex, 2026-10-24 ("it lag", blank map, empty Area list): right after
  // a deploy the page sat waiting on the network for scripts it already had.
  const tile = TILES.find((t) => t.test(url));
  if (tile) e.respondWith(tileFirst(req, tile, e).catch(() => fetch(req)));
  else if (url.origin === self.location.origin && (url.searchParams.has("v") || url.pathname.includes("/vendor/"))) e.respondWith(cacheFirst(req));
  else if ((url.origin === self.location.origin || /^(allduf\.github\.io|trailfinder-winter2?\.netlify\.app|trailfinder-w[12]-\d+\.pages\.dev|trailfinder-summer(-15)?\.pages\.dev|trailfinder-sharpmid\.pages\.dev|trailfinder-sharp-\d+\.pages\.dev|trailfinder-sharpca-\d+\.pages\.dev|trailfinder-wide-\d+\.pages\.dev)$/.test(url.hostname)) && /\/trail-finder-(winter2?|summer|wide)\//.test(url.pathname) && !url.pathname.endsWith(".json")) e.respondWith(savedFirst(req));
  else if (url.origin !== self.location.origin && /^(allduf\.github\.io|trailfinder-winter2?\.netlify\.app|trailfinder-w[12]-\d+\.pages\.dev|trailfinder-summer(-15)?\.pages\.dev|trailfinder-sharpmid\.pages\.dev|trailfinder-sharp-\d+\.pages\.dev|trailfinder-sharpca-\d+\.pages\.dev|trailfinder-wide-\d+\.pages\.dev)$/.test(url.hostname) && /\/trail-finder-(winter2?|summer|wide)\/[^/]+\.json$/.test(url.pathname)) e.respondWith(savedIfNoNet(req));
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
