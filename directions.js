// Which way a trail is ridden (alex: "find trail direction ... if you dont know put bothways"), for trail details and
// Plan a route (planner.js). Sources, best first:
//   hand  a rider or a local source (club, town, forum) says so: HAND below, with who said it and where
//   wh    Whistler's open trail data, csrd Columbia Shuswap's (scripts/build-directions.mjs, when they carry a direction)
//   osm   its OpenStreetMap tags (oneway, oneway:bicycle, mtb:type, incline, downhill, mtb:scale:uphill)
//   name  its name says so ("... Climb", "Uptrack", "... DH", "Descent")
//   same  another piece of the same named trail, joined to it, has a direction (nightly build only)
//   none  nothing says: both ways
// The nightly build (scripts/build-directions.mjs, data/directions.json) runs the same rules on every trail of the region
// and adds what needs the whole zone or the terrain: same-name pieces, local open data, and which end is up (the slope,
// only to point a climb, a descent or a one-way trail the right way, never to decide that a trail is one).
//
// window.tfDir = { of(tags, geom, id) -> { dir, along, src, why }, onChange(fn), rules(tags, geom), HAND }
//   dir: climb (ridden up), down (ridden down), oneway (one way only, not up or down), both (either way; the default)
//   along: 1 ridden from the first point of geom to the last, -1 the other way, 0 not known (both ways, or the slope
//          tells: a climb goes up, a descent goes down)
(function (root) {
  // Trails whose direction a rider or a local source gives, for trails OpenStreetMap doesn't tag. Matched by name
  // (any piece, case and accents aside) within r metres of c. Remove one once OpenStreetMap has it.
  // No Trailforks: its terms don't allow copying.
  const HAND = [
    { name: "Into The Mystic", c: [50.111, -123.045], r: 4000, dir: "climb", who: "alex, who rides it", note: "a climbing trail (Whistler)" },
    // Tagged one-way on OpenStreetMap but drawn bottom to top, so the tag reads as a climb: wrongWay drops the tag's way and
    // the slope points it (scripts/build-directions.mjs).
    { name: "Sabertooth Horse", c: [50.085, -122.966], r: 1500, dir: "down", wrongWay: true, who: "alex, who rides it", note: "a Whistler Bike Park descent in Creekside, mapped the wrong way round" },
    { name: "Captain Safety", c: [50.089, -122.959], r: 1500, dir: "down", wrongWay: true, who: "alex, who rides it", note: "a Whistler Bike Park descent in Creekside, mapped the wrong way round" },
    // Whistler Bike Park: every trail on the park's map is ridden down. These ones read as both ways or as one-way only.
    ...["1199", "Blue Velvet", "Una Moss", "Sidetrack", "Southpark", "Earth Circus", "Samurai Pizza Cat", "World Cup Singletrack",
      "Dwayne Johnson", "Shady Acres", "Bengal Bear", "Lower Joyride", "Todd", "Rippin' Rutabaga", "Pines Del Mar", "Dirt Merchant",
      "Duffman", "Freight Train", "Upper Freight Train", "Drop in Clinic", "Lower No Joke", "Line of Control", "Karate Monkey",
      "Wednesday Night Delight", "Lower A-Line", "Naughty Hands", "Lower Ez Does It"].map((name) => ({ name, c: [50.095, -122.965], r: 4500,
      dir: "down", who: "the Whistler Mountain Bike Park map (2026)", where: "whistler.com", note: "a Whistler Bike Park descent" })),
    ...["Aggravated Assault", "Alternate Flight Pattern", "Bicycle Thief", "Case Closed", "Cats Pyjamas", "Kodiak Karnage", "Neverland",
      "Phat Larry's", "Playground", "Rubber Ducky", "Rumplestumpskin", "TNT Lower", "TNT Upper", "Trac III", "Will Power", "Ben's Big Rig",
      "Deer Trail", "Duff Dynasty", "Eville", "Lil' Miss Buffit", "GT Racer", "Holo Bike", "Mr. Berms", "Top Gun"].map((name) => ({ name,
      c: [49.462, -115.1], r: 3500, dir: "down", who: "Fernie Alpine Resort's bike park trail list (2026)", where: "skifernie.com", note: "a Fernie bike park descent" })),
    ...["Chainsaw Mullet", "Comet Trail", "Dog's Downhill", "Double Dog", "Flow", "Gnar", "Jedi Mind Trick", "LTG", "Paradise", "Pipe Dream",
      "Rockstar", "Shazam", "Snake Pit", "Super Star", "SuperStar"].map((name) => ({ name, c: [50.37, -119.05], r: 2500, dir: "down",
      who: "the SilverStar Bike Park downhill map", where: "gobybikebc.ca", note: "a SilverStar Bike Park descent (no uphill riding on its downhill trails)" })),
    ...["Easy Wind", "Level Up", "Stella Blue", "Sugar", "Smooth Smoothie"].map((name) => ({ name, c: [50.895, -119.895], r: 2500, dir: "down",
      who: "Sun Peaks Resort's bike trail status", where: "sunpeaksresort.com", note: "a Sun Peaks bike park descent" })),
    ...["Ace of Spades", "Bermslang", "Black Mamba", "Bumble Bee", "Catapult Ranch", "Dark Roast", "Easy Steezy", "Gecko", "Home Run", "It's So Easy",
      "Knockout", "Lightning Strike", "Mop Up", "Nessy", "Pry Bar", "Rock Hammer", "Rocket Science", "Shark Fin Soup", "Squirts"].map((name) => ({ name,
      c: [49.73, -118.927], r: 2000, dir: "down", who: "Big White's bike park trail chart", where: "bigwhite.com", note: "a Big White bike park descent" })),
    ...["Let It Ride", "Rocking Horse", "Mercy Me", "Sanchez", "Bazooka Joe", "Stiffy", "Rusty Cage", "Hell's Bells", "Look Out", "Quadzilla", "Bender",
      "Get In Line", "Moose Powder", "Crazy Train", "Insanity", "Punnisher"].map((name) => ({ name, c: [50.448, -116.235], r: 2500, dir: "down",
      who: "Panorama's 2024 DH trail map", where: "panoramaresort.com", note: "a Panorama bike park descent" })),
    ...["Big Easy", "Pipe Wrench"].map((name) => ({ name, c: [50.958, -118.15], r: 3000, dir: "down",
      who: "Revelstoke Mountain Resort's bike park map", where: "revelstokemountainresort.com", note: "a Revelstoke bike park descent" })),
    { name: "Take It Easy", c: [50.958, -118.15], r: 3000, dir: "climb", who: "Revelstoke Mountain Resort's bike park map", where: "revelstokemountainresort.com",
      note: "the Take It Easy Climb, a climbing trail at Revelstoke Mountain Resort" },
    ...["BBQ Jello", "Double Jeopardy", "Haircut Rabbit", "Pandamonium", "Squirrely Dan", "Tender Vittles", "Toad's Salami"].map((name) => ({ name,
      c: [51.079, -114.218], r: 1500, dir: "down", who: "WinSport's 2026 summer trail map", where: "winsport.ca", note: "a WinSport bike park descent (Calgary)" })),
    { name: "Devil's Disco", c: [51.29, -117.06], r: 3000, dir: "down", who: "Kicking Horse's bike trail report", where: "kickinghorseresort.com", note: "a Kicking Horse bike park descent" },
    ...["True Grit", "Blazing Saddles", "Outlaw", "Rattlesnake", "Three Amigos", "Tumbleweed", "Quick Draw", "Tombstone", "Pale Rider", "Wrangler",
      "Fist Full of Dollars"].map((name) => ({ name, c: [50.667, -120.262], r: 800, dir: "down", who: "the City of Kamloops' Bike Ranch trail map",
      where: "kamloops.ca", note: "a Kamloops Bike Ranch descent" })),
    ...["Greenline", "Panda Gardens", "HWY 19", "Call It In", "Blue Hammer", "Step Brother", "Hustler", "Osezno", "Helter Skelter", "Little Blue",
      "Salami Hands", "The Wiz Upper", "The Wiz Lower", "Time Warp", "Lower Time Warp", "Riptide Ridge", "Straight Shot", "Back in Black",
      "Upper Helter Skelter", "Upper Monster Mile", "Monster Mile"].map((name) => ({ name, c: [49.749, -125.305], r: 2500, dir: "down",
      who: "Mount Washington's bike park trail guide (every descent in the park)", where: "mountwashington.ca", note: "a Mount Washington bike park descent" })),
    { name: "XC Climb", c: [50.667, -120.262], r: 800, dir: "both", who: "the City of Kamloops' Bike Ranch trail map", where: "kamloops.ca",
      note: "the Bike Ranch's XC Trail, the main way up and the easiest way down, ridden both ways" },
    { name: "Leftovers Skid Road", c: [50.103, -123.016], r: 1500, dir: "climb", who: "alex, who rides it", note: "an access skid road ridden as a climbing trail (Whistler)" },
    { name: "Yummy Numby", c: [50.127, -122.926], r: 3000, dir: "climb", who: "Vital MTB's Whistler guide", where: "vitalmtb.com", note: "a singletrack climb (Whistler)" },
    { name: "Highline", c: [50.07, -123.028], r: 3000, dir: "climb", who: "MTB Project", where: "mtbproject.com", note: "the warm-up climb to the Cheakamus descents (Whistler)" },
    { name: "50 Shades of Green", c: [49.776, -123.118], r: 3000, dir: "climb", who: "Tourism Squamish's Alice Lake and Highlands map", where: "exploresquamish.com", note: "a well built climb into the Alice Lake and Mashiter trails (Squamish)" },
    { name: "Of Mice and Men", c: [49.77, -123.111], r: 3000, dir: "climb", who: "Singletracks", where: "singletracks.com", note: "an intermediate climbing trail in the Alice Lake network (Squamish)" },
    { name: "Upstream", c: [49.79, -123.099], r: 3000, dir: "climb", who: "Outmap", where: "outmap.pro", note: "built to be ridden uphill (Squamish)" },
    { name: "Cardiac Bypass", c: [49.328, -122.986], r: 3000, dir: "climb", who: "the NSMBA", where: "nsmba.ca", note: "part of the singletrack climb up Mount Seymour" },
    { name: "Academy Climb", c: [49.329, -122.987], r: 3000, dir: "climb", who: "the NSMBA", where: "nsmba.ca", note: "part of the singletrack climb up Mount Seymour" },
    { name: "Rapid Transit", c: [49.329, -122.986], r: 3000, dir: "climb", who: "the NSMBA", where: "nsmba.ca", note: "part of the singletrack climb up Mount Seymour" },
    { name: "C-Buster", c: [49.333, -122.986], r: 3000, dir: "climb", who: "the NSMBA", where: "nsmba.ca", note: "part of the singletrack climb up Mount Seymour" },
    { name: "Penny Lane", c: [49.333, -122.984], r: 3000, dir: "climb", who: "the NSMBA", where: "nsmba.ca", note: "part of the singletrack climb up Mount Seymour" },
    { name: "R&R Climb", c: [49.332, -122.987], r: 3000, dir: "climb", who: "the NSMBA", where: "nsmba.ca", note: "part of the singletrack climb up Mount Seymour" },
    { name: "NIMBY", c: [50.341, -122.782], r: 3000, dir: "climb", who: "Singletracks and Tourism Pemberton", where: "singletracks.com", note: "the first leg of the Mackenzie climb (Pemberton)" },
    { name: "Middle Earth", c: [50.355, -122.792], r: 3000, dir: "climb", who: "Singletracks", where: "singletracks.com", note: "the last leg of the Mackenzie climb (Pemberton)" },
    { name: "Ket-R-Done", c: [50.729, -120.161], r: 3000, dir: "climb", who: "Tourism Kamloops", where: "tourismkamloops.com", note: "Harper Mountain's dedicated uphill route (Kamloops)" },
    { name: "Holy Pail Up", c: [49.863, -119.657], r: 3000, dir: "climb", who: "Visit Westside's riders' guide", where: "visitwestside.com", note: "the cross-country climb at Smith Creek (West Kelowna)" },
    { name: "Stone Free", c: [50.19, -119.245], r: 3000, dir: "climb", who: "Tourism Vernon", where: "tourismvernon.com", note: "the climb before the Flovid flow trail (Vernon)" },
    { name: "Yellow Brick Road", c: [49.572, -119.559], r: 3000, dir: "climb", who: "Visit Penticton", where: "visitpenticton.com", note: "the main climb at Three Blind Mice (Penticton)" },
    { name: "Buff Enuff", c: [50.966, -118.236], r: 3000, dir: "climb", who: "Singletracks", where: "singletracks.com", note: "a climb in the Mount Macpherson trails (Revelstoke)" },
    { name: "Schacher", c: [51.275, -116.895], r: 3000, dir: "climb", who: "Pinkbike", where: "pinkbike.com", note: "the climbing trail from Golden to the Mount 7 launch" },
    { name: "Swine Flu", c: [49.535, -115.069], r: 3000, dir: "climb", who: "the Fernie trail map", where: "wiki.ubc.ca", note: "a technical ascent up Mount Proctor (Fernie)" },
    { name: "Dairy Run", c: [49.526, -115.054], r: 3000, dir: "climb", who: "the Fernie trail map", where: "wiki.ubc.ca", note: "the climb to the base of Swine Flu (Fernie)" },
    { name: "Bottoms Up", c: [49.485, -117.359], r: 3000, dir: "climb", who: "Singletracks", where: "singletracks.com", note: "the easy way to climb Morning Mountain (Nelson)" },
  ];
  const WHY = {
    none: "No map tag, local trail data or rider report says which way it's ridden, so it's shown as both ways.",
  };
  const fold = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const metres = (a, b) => Math.hypot((b[0] - a[0]) * 110540, (b[1] - a[1]) * 111320 * Math.cos((a[0] * Math.PI) / 180));
  const nameOf = (t) => t.name || t["mtb:name"] || t["tf:name"] || "";
  const handOf = (t, geom) => {
    const n = fold(nameOf(t)), mid = geom && geom.length ? geom[geom.length >> 1] : null;
    return n && mid ? HAND.find((h) => fold(h.name) === n && metres(mid, h.c) <= h.r) : null;
  };
  // One-way for bikes: 1 along the line, -1 against it, 0 both ways, null not tagged. oneway:bicycle wins over oneway.
  function onewayTag(t) {
    const v = t["oneway:bicycle"] != null ? t["oneway:bicycle"] : t["oneway:mtb"] != null ? t["oneway:mtb"] : t.oneway;
    return v === "yes" || v === "1" || v === "true" ? 1 : v === "-1" || v === "reverse" ? -1 : v === "no" ? 0 : null;
  }
  // incline=up/down or a signed percentage: which way the line climbs (1 up along it, -1 down along it), else 0.
  function inclineOf(t) {
    const v = (t.incline || "").trim();
    if (v === "up") return 1;
    if (v === "down") return -1;
    const p = parseFloat(v);
    return isNaN(p) || Math.abs(p) < 3 ? 0 : p > 0 ? 1 : -1;
  }
  // Names that say it: "Ski Hill Climb", "Uptrack", "Paydirt (climb)", "Cypress East Climb Trail"; "Canadian Open DH",
  // "Soul Train Descent", "Down-Track". Not "Sunny Side Up", "Get Down", "Climb Connector ... Descend" (both words: no).
  const UP_NAME = /\b(climb|climbing|ascent|uptrack|up ?track|up-track|uphill)\b/i, DOWN_NAME = /\b(dh|downhill|descent|down ?track|down-track)\b/i;

  // The direction from the trail's own tags and name (and the HAND list), without the nightly data. null: nothing says.
  function rules(t, geom) {
    if (!t) return null;
    const h = handOf(t, geom);
    if (h) return { dir: h.dir, along: h.wrongWay ? 0 : onewayTag(t) || 0, src: "hand", why: `${h.note[0].toUpperCase()}${h.note.slice(1)}, says ${h.who}${h.where ? ` (${h.where})` : ""}.` };
    const one = onewayTag(t), inc = inclineOf(t), type = `${t["mtb:type"] || ""} ${t.mtb || ""}`.toLowerCase(), name = nameOf(t);
    if (/uphill|climb/.test(type)) return { dir: "climb", along: 0, src: "osm", why: "Tagged as a climbing trail on OpenStreetMap (mtb:type)." };
    if (one && inc) return { dir: one === inc ? "climb" : "down", along: one, src: "osm", why: `Tagged one-way and ${one === inc ? "uphill" : "downhill"} on OpenStreetMap.` };
    if (/downhill|\bdh\b|gravity|freeride/.test(type) || t.downhill === "yes") return { dir: "down", along: one || 0, src: "osm", why: "Tagged as a downhill trail on OpenStreetMap (mtb:type)." };
    const up = UP_NAME.test(name), dn = DOWN_NAME.test(name);
    if (one && up !== dn) return { dir: up ? "climb" : "down", along: one, src: "osm", why: `Tagged one-way for bikes on OpenStreetMap, and its name says it's a ${up ? "climb" : "descent"}.` };
    if (one) return { dir: "oneway", along: one, src: "osm", why: "Tagged one-way for bikes on OpenStreetMap." };
    if (up && !dn) return { dir: "climb", along: 0, src: "name", why: "Its name says it's a climb." };
    if (dn && !up) return { dir: "down", along: 0, src: "name", why: "Its name says it's a descent." };
    if (+t["mtb:scale:uphill"] >= 5) return { dir: "down", along: 0, src: "osm", weak: true, why: "OpenStreetMap rates it too steep or rough to ride up (mtb:scale:uphill 5), so it's ridden down." };
    if (one === 0) return { dir: "both", along: 0, src: "osm", why: "Tagged two-way on OpenStreetMap." };
    return null;
  }

  // ---------- data/directions.json (the nightly build) ----------
  const SRC_WHY = {
    same: (n) => `Another piece of the same trail${n ? ` (${n})` : ""}, joined to this one, is marked that way.`,
    osm: (n) => `Tagged one-way for bikes on OpenStreetMap${n ? `, and it goes ${n}` : ""}.`,
    wh: (n) => `The Resort Municipality of Whistler's trail data says ${n ? `“${n}”` : "so"}.`,
    csrd: (n) => `The Columbia Shuswap Regional District's trail data says ${n ? `“${n}”` : "so"}.`,
  };
  let data = null;
  const listeners = [];
  if (root.fetch && root.document) {
    root.fetch("data/directions.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
      .then((j) => { if (j && j.v === 1) { data = j.ways; listeners.forEach((fn) => { try { fn(); } catch (e) { console.warn(e); } }); } });
  }
  function of(tags, geom, id) {
    const r = rules(tags, geom), d = data && id > 0 ? data[id] : null;
    if (r && r.src === "hand") { if (d && d[2] === "hand" && d[0] === r.dir) r.along = d[1] || 0; return r; }   // a newer HAND list wins
    if (d) {   // [dir, along, src, note]
      const why = r && r.src === d[2] && r.dir === d[0] ? r.why : SRC_WHY[d[2]] ? SRC_WHY[d[2]](d[3]) : r ? r.why : "";
      return { dir: d[0], along: d[1] || 0, src: d[2], why };
    }
    return r || { dir: "both", along: 0, src: "none", why: WHY.none };
  }
  const api = { of, rules, HAND, onChange: (fn) => listeners.push(fn) };
  root.tfDir = api;
})(typeof window !== "undefined" ? window : globalThis);
