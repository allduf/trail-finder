// Places taken off the app by hand (alex 2026-11-11, Tom's Hut: "take that hut off pls"). A place listed here never
// shows, whatever brings it in: OpenStreetMap (the nightly and weekly data files, the live Overpass asks), the hand-kept
// data/huts.json, or a place search. Skiing's huts (winter.js, so also the 3D pins, Ask, the cabin trip planner and
// Skiing's search), Hiking's places (hike.js), Moto's stops (moto.js) and the place search (place-search.js) ask
// tfHiddenPlace(); the build scripts (build-winter, build-hike, build-canada-hike, build-moto) drop them too.
// A place matches by its OpenStreetMap id ("w1461438500", "way/1461438500") or by its name within `km` of the spot.
// friends: true = hidden from the public only (alex 2026-11-11: "all the huts that i told you to take off the map make
// it so me and my friends can see it"): alex and their friends (localStorage "tf-friend", friends.js) still see it, the
// same way as the unofficial trails. The build scripts (Node) keep friends-only places in the data files for them.
(function (root) {
  "use strict";
  var LIST = [
    { name: "Tom's Hut", osm: "w1461438500", lat: 50.33838, lon: -122.37604, km: 3, friends: true, why: "alex 2026-11-11: take it off (then: keep it for me and my friends)" },
  ];
  var key = function (s) { return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, ""); };
  var osmKey = function (id) {
    var s = String(id == null ? "" : id).toLowerCase(), m = s.match(/^(node|way|relation)[/:]?(\d+)$/);
    return m ? m[1][0] + m[2] : s;
  };
  LIST.forEach(function (h) { h.k = key(h.name); });
  // alex and their friends (same flag as index.html's FRIEND). Read each time: friends.js sets it after sign-in.
  // In Node (the build scripts) friends-only places count as seen, so they stay in the data files; only the app hides them.
  var friend = function () {
    if (typeof window === "undefined") return true;
    try { return window.localStorage.getItem("tf-friend") === "1"; } catch (e) { return false; }
  };
  // p: { id, name | n, lat, lon } (or ll: [lat, lon]).
  function hidden(p) {
    if (!p) return false;
    var id = osmKey(p.id != null ? p.id : p.osm), k = key(p.name != null ? p.name : p.n);
    var lat = p.lat != null ? +p.lat : p.ll ? +p.ll[0] : NaN, lon = p.lon != null ? +p.lon : p.ll ? +p.ll[1] : NaN;
    for (var i = 0; i < LIST.length; i++) {
      var h = LIST[i];
      if (h.friends && friend()) continue;
      if (id && id === h.osm) return true;
      if (k && k === h.k && isFinite(lat) && isFinite(lon)) {
        var km = Math.hypot((lat - h.lat) * 110.54, (lon - h.lon) * 111.32 * Math.cos((lat * Math.PI) / 180));
        if (km <= h.km) return true;
      }
    }
    return false;
  }
  hidden.list = LIST;
  if (typeof module !== "undefined" && module.exports) module.exports = hidden;
  else root.tfHiddenPlace = hidden;
})(typeof window !== "undefined" ? window : globalThis);
