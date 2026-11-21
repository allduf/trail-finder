// Saved files in IndexedDB (the page and sw.js both load this file): Offline maps' saved areas and Hunting's saved
// layers ("offline"), and the map pictures kept after they're seen ("tiles", sw.js only).
// Why not the browser's Cache Storage, where they were before 2026-11-21: on an iPhone (WebKit), every file in any
// cache of the site slows the first cache use after the app starts, and the page itself waits for it. Measured in
// WebKit (scripts/start-speed.mjs): 20,000 saved files made the page arrive in 280 ms instead of 20 ms on a fast test
// computer (alex's iPhone app: 3-4 s instead of under 1 s after a big offline save). The same 20,000 files in
// IndexedDB: no wait at all.
// Saves made before move over by themselves (migrate below): until then a file is also looked for in the old cache.
//
// self.tfFiles = {
//   offline: { match(url) -> Response|undefined, has(url), put(url, response), delete(url), clear() },   // like a Cache
//   tileGet(url) -> { b: Blob, t: type, at: ms } | undefined, tilePut(kind, url, blob, type, max),
//   response(rec) -> Response, migrate() -> Promise (page only: moves the old cache's files here, a few at a time)
// }
(function (g) {
  if (g.tfFiles || !g.indexedDB) return;
  const DB = "tf-files", OLD = "tf-offline-1";
  let dbp = null;
  const db = () => dbp || (dbp = new Promise((ok, no) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains("offline")) d.createObjectStore("offline");
      if (!d.objectStoreNames.contains("tiles")) d.createObjectStore("tiles").createIndex("kat", ["k", "at"]);
    };
    r.onsuccess = () => {
      const d = r.result;
      d.onversionchange = () => { d.close(); dbp = null; };
      d.onclose = () => { dbp = null; };
      ok(d);
    };
    r.onerror = () => { dbp = null; no(r.error); };
  }));
  // One transaction: fn gets the store and may return a request; its result comes back when the transaction is done.
  const run = async (name, mode, fn) => {
    const d = await db();
    return new Promise((ok, no) => {
      const t = d.transaction(name, mode), q = fn(t.objectStore(name));
      t.oncomplete = () => ok(q && "result" in q ? q.result : undefined);
      t.onerror = () => no(t.error);
      t.onabort = () => no(t.error || new Error("aborted"));
    });
  };
  // Always the full address: a relative one ("vendor/maplibre-gl-5.24.0.js") is what sw.js asks for in full.
  const key = (u) => new URL(typeof u === "string" ? u : u.url, g.location.href).href;
  const response = (rec) => new Response(rec.b, { status: 200, headers: { "content-type": rec.t || "", "content-length": String(rec.b.size) } });

  // The old cache, while saves made before still sit there (checked again every 30 s, not on every file). Read with
  // caches.match(cacheName), which never makes the cache again once it's gone (caches.open would).
  let oldAt = 0, oldThere = null;
  const hasOld = async () => {
    if (!g.caches) return false;
    if (Date.now() - oldAt > 30000) { oldAt = Date.now(); oldThere = caches.has(OLD).catch(() => false); }
    return oldThere;
  };
  const oldMatch = async (u) => ((await hasOld()) ? (await caches.match(u, { cacheName: OLD, ignoreVary: true }).catch(() => undefined)) || undefined : undefined);
  const oldDelete = async (u) => { if (g.caches && await caches.has(OLD).catch(() => false)) await (await caches.open(OLD)).delete(u).catch(() => {}); };
  // Files deleted while old saves are being moved: not brought back by the move (migrate).
  const gone = new Set();
  let cleared = 0;

  const offline = {
    async match(u) {
      const k = key(u), rec = await run("offline", "readonly", (s) => s.get(k)).catch(() => null);
      return rec && rec.b ? response(rec) : oldMatch(k);
    },
    // Saved here or in the old cache, without reading the file.
    async has(u) {
      const k = key(u);
      return !!(await run("offline", "readonly", (s) => s.count(k)).catch(() => 0)) || !!(await oldMatch(k));
    },
    async put(u, res) {
      if (!res || res.type === "opaque") return;   // a file the page can't read can't be kept here
      const k = key(u), b = await res.blob();
      gone.delete(k);
      await run("offline", "readwrite", (s) => { s.put({ b, t: res.headers.get("content-type") || "" }, k); });
    },
    async delete(u) {
      const k = key(u);
      if (moving) gone.add(k);
      await run("offline", "readwrite", (s) => { s.delete(k); }).catch(() => {});
      await oldDelete(k);
    },
    async clear() {
      cleared++;
      await run("offline", "readwrite", (s) => { s.clear(); }).catch(() => {});
      if (g.caches) { await caches.delete(OLD).catch(() => {}); oldAt = 0; }
    },
  };

  // Map pictures kept after they're seen, per kind (sw.js TILES), oldest dropped past max.
  const puts = {};
  async function tilePut(kind, u, b, t, max) {
    await run("tiles", "readwrite", (s) => { s.put({ b, t: t || "", at: Date.now(), k: kind }, u); });
    if ((puts[kind] = (puts[kind] || 0) + 1) % 100 !== 1) return;   // the first after each start too: a short visit counts
    const range = IDBKeyRange.bound([kind, 0], [kind, Infinity]);
    const n = await run("tiles", "readonly", (s) => s.index("kat").count(range));
    if (n <= max) return;
    let drop = n - max;
    await run("tiles", "readwrite", (s) => {
      const c = s.index("kat").openCursor(range);
      c.onsuccess = () => { const cur = c.result; if (!cur || drop-- <= 0) return; cur.delete(); cur.continue(); };
    });
  }
  const tileGet = (u) => run("tiles", "readonly", (s) => s.get(u)).catch(() => undefined);

  // Saves made before 2026-11-21: moved from the old cache, a few files at a time, then the old cache is deleted.
  let moving = null;
  const migrate = () => moving || (moving = (async () => {
    const was = cleared;
    // Rounds until the old cache is empty: a page still on an older copy may have added files meanwhile.
    for (let round = 0; round < 5; round++) {
      if (!g.caches || !(await caches.has(OLD)) || cleared !== was) return;
      const c = await caches.open(OLD), keys = await c.keys();
      if (!keys.length) break;
      for (let i = 0; i < keys.length; i += 50) {
        if (cleared !== was) return;   // everything was deleted meanwhile: nothing to bring back
        const part = keys.slice(i, i + 50), recs = [];
        // Read 50, write them in one go, then take them out of the old cache: a stop half way loses nothing.
        await Promise.all(part.map(async (k) => {
          try {
            const r = await c.match(k, { ignoreVary: true });
            if (r && r.type !== "opaque") recs.push([key(k.url), { b: await r.blob(), t: r.headers.get("content-type") || "" }]);
          } catch {}
        }));
        if (cleared !== was) return;
        try {
          // A newer copy already here (saved again since) is kept; a file deleted meanwhile isn't brought back.
          await run("offline", "readwrite", (s) => { for (const [u, rec] of recs) { if (gone.has(u)) continue; const q = s.count(u); q.onsuccess = () => { if (!q.result) s.put(rec, u); }; } });
          await Promise.all(part.map((k) => c.delete(k).catch(() => {})));
        } catch { return; }   // IndexedDB refused (full?): the old cache stays as it is
        await new Promise((ok) => setTimeout(ok, 30));   // the app stays smooth while it moves
      }
    }
    // A file that couldn't be read (opaque) is let go: Offline maps finds it missing and downloads it again.
    if (cleared === was) await caches.delete(OLD);
    oldAt = 0;
  })().catch(() => {}).finally(() => { moving = null; gone.clear(); }));

  g.tfFiles = { offline, tileGet, tilePut, response, migrate };
})(self);
