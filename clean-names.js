// Emoji and grade marks out of place and trail names (alex 2026-11-25: no emoji in the app, keep it professional).
// Some OpenStreetMap mappers put a trail's grade in its name ("Pettifogger 🟢", "Octane ◆", "Howie Down ◆◆" around
// Turkey Point, South March Highlands and other Ontario networks, "13🟢" on some ski runs). The app shows the grade from
// the trail's own grade tags, so the marks only add emoji to cards, labels, search, the 3D and native 3D map.
//
// One place does it for every sport and every device: the JSON the app reads from its own data files (data/, ca/, jp/)
// and from OpenStreetMap (Overpass, the OpenStreetMap API) has every text cleaned as it is read (Response.json below),
// so the flat map, the web 3D map, native 3D (fed by the page), search, cards and ride.html all get clean names. The
// data files themselves keep the names as mapped, so the nightly jobs' name history (keep-names.mjs) doesn't see a rename.
// tfCleanName(s) cleans one text; tfCleanTags(tags) cleans the name tags of one way (trails saved in this browser).
(function (root) {
  "use strict";
  // Emoji (pictographs, flags, skin tones, joiners, keycaps) and the diamond, square and circle shapes used as grades.
  // Kept: © ® ™ ‼ ⁉ and arrows (used in our own texts: "More → Settings"), triangles (Japanese survey points, peaks).
  var KEEP = "\\u00A9\\u00AE\\u2122\\u203C\\u2049\\u2194-\\u2199\\u21A9\\u21AA";
  var MARK = "(?:(?![" + KEEP + "])[\\p{Extended_Pictographic}\\u{1F1E6}-\\u{1F1FF}\\u{1F3FB}-\\u{1F3FF}\\u25A0\\u25A1\\u25C6\\u25C7\\u25CB\\u25CF])"; // wording-ok
  var RUN = null, ANY = null;
  try {   // a web viewer without \p{...} in its regular expressions (Safari before 11.1) shows names as mapped
    RUN = new RegExp("[ \\t]*" + MARK + "(?:[\\uFE0E\\uFE0F\\u20E3\\u200D]|" + MARK + "|[ \\t]+(?=" + MARK + "))*[ \\t]*", "gu");
    ANY = new RegExp(MARK, "u");
  } catch (e) { RUN = ANY = null; }
  function cleanName(s) {
    if (typeof s !== "string" || !ANY || !ANY.test(s)) return s;
    var out = s.replace(RUN, " ").replace(/\(\s*\)|\[\s*\]/g, " ").replace(/ {2,}/g, " ").replace(/ ([,.;:!?)\]])/g, "$1").replace(/([(\[]) /g, "$1").trim();
    // A name that is nothing but a mark ("🟦" on a few short connectors) stays as mapped: every list and card expects
    // a named way to have a name, and an empty one broke the search (local test 2026-11-28).
    return out || s;
  }
  var NAME_TAGS = ["name", "mtb:name", "official_name", "alt_name", "old_name", "short_name", "loc_name", "ref", "tf:was", "name:en", "name:fr"];
  function cleanTags(tags) {
    if (!tags || typeof tags !== "object") return tags;
    for (var i = 0; i < NAME_TAGS.length; i++) { var k = NAME_TAGS[i]; if (typeof tags[k] === "string") tags[k] = cleanName(tags[k]); }
    return tags;
  }
  // Every text in a parsed JSON value, in place. Lines of numbers (geometry) are skipped without a look at each number.
  function cleanAll(v) {
    if (!ANY) return v;
    if (v === null || typeof v !== "object") return typeof v === "string" ? cleanName(v) : v;
    if (Array.isArray(v)) {
      var n = v.length;
      if (n > 2 && typeof v[0] === "number" && typeof v[1] === "number" && typeof v[n - 1] === "number") return v;
      for (var i = 0; i < n; i++) { var x = v[i]; if (typeof x === "string") { if (ANY.test(x)) v[i] = cleanName(x); } else if (x && typeof x === "object") cleanAll(x); }
      return v;
    }
    for (var k in v) {
      if (!Object.prototype.hasOwnProperty.call(v, k)) continue;
      var y = v[k];
      if (typeof y === "string") { if (ANY.test(y)) v[k] = cleanName(y); } else if (y && typeof y === "object") cleanAll(y);
    }
    return v;
  }
  // Which answers carry place and trail names: the app's own data files and OpenStreetMap. Avalanche Canada's
  // forecasts (and our copies of them) are left exactly as given.
  function namesUrl(u) {
    if (!u || typeof u !== "string") return false;
    var url;
    try { url = new URL(u, root.location ? root.location.href : undefined); } catch (e) { return false; }
    var host = url.hostname;
    if (/(^|\.)overpass|^api\.openstreetmap\.org$/.test(host)) return true;
    if (!root.location || url.origin !== root.location.origin) return false;
    var p = url.pathname;
    return /\/(data|ca|jp)\//.test(p) && /\.json$/i.test(p) && !/avalanche|avy/i.test(p);
  }
  var api = { name: cleanName, tags: cleanTags, all: cleanAll, url: namesUrl };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; return; }
  root.tfCleanName = cleanName;
  root.tfCleanTags = cleanTags;
  root.tfCleanNames = api;
  var R = root.Response;
  if (R && R.prototype && R.prototype.json && !R.prototype.json.tfClean) {
    var json = R.prototype.json;
    var wrapped = function () {
      var p = json.apply(this, arguments);
      return namesUrl(this.url) ? p.then(function (d) { try { return cleanAll(d); } catch (e) { return d; } }) : p;
    };
    wrapped.tfClean = true;
    R.prototype.json = wrapped;
  }
})(typeof window !== "undefined" ? window : globalThis);
