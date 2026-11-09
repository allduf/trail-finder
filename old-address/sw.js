// Replaces the old Trail Finder service worker at allduf.github.io/trail-finder/ (site moved to trailfinderapp.ca,
// 2026-11-07). Browsers check sw.js on their own: this one wipes the saved copy, unregisters itself and sends every
// open tab to the new address, so people with the old bookmark or home-screen icon land on the real app.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) await caches.delete(k);
  await self.registration.unregister();
  for (const c of await self.clients.matchAll({ type: "window" })) c.navigate("https://trailfinderapp.ca/").catch(() => {});
})()));
// Until it's gone: pages open at the new address, nothing else is answered from the old saved copy.
self.addEventListener("fetch", (e) => { if (e.request.mode === "navigate") e.respondWith(Response.redirect("https://trailfinderapp.ca/", 302)); });
