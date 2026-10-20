// Builds data/landmarks.json for "Which trail is this?" (photo-find.js): the big mountains, rock walls and lakes riders
// see in the background of a trail photo, with the names and plain words people use for them. Each one is looked up
// on OpenStreetMap (Nominatim) for its spot; a spot written here (c) wins. Run by hand when the list changes:
//   node scripts/build-landmarks.mjs
// looks: words a rider might use to describe it ("granite wall", "pointy black peak"); they only count together
// with the area (picked, or named in the picture), as many places have a granite wall.
import { writeFileSync } from "node:fs";

const L = [
  // Vancouver & North Shore
  { name: "The Lions", c: [49.4576, -123.1874], aka: ["lions", "twin sisters", "two lions"], looks: ["twin peaks", "two peaks", "two pointy peaks"] },
  { name: "Grouse Mountain", aka: ["grouse"], looks: ["ski hill", "city view"] },
  { name: "Mount Seymour", aka: ["seymour"] },
  { name: "Burrard Inlet", c: [49.3, -123.05], looks: ["city", "downtown", "ocean", "bridge", "ships"] },
  { name: "Indian Arm", q: "Indian Arm, British Columbia", looks: ["fjord", "inlet"] },
  // Squamish & Howe Sound
  { name: "Stawamus Chief", q: "Stawamus Chief", aka: ["the chief", "chief", "stawamus"], looks: ["granite", "granite wall", "big rock", "rock wall", "cliff", "big cliff", "rock face", "dome", "huge rock", "big granite"] },
  { name: "Sky Pilot Mountain", q: "Sky Pilot Mountain", aka: ["sky pilot"], looks: ["pointy peak", "rocky peak"] },
  { name: "Mount Garibaldi", q: "Mount Garibaldi", aka: ["garibaldi"], looks: ["glacier", "snowy volcano", "big snowy mountain", "volcano"] },
  { name: "The Tantalus Range", q: "Mount Tantalus", aka: ["tantalus", "tantalus range"], looks: ["glacier", "snowy range", "jagged peaks", "snowy peaks"] },
  { name: "Howe Sound", q: "Howe Sound", looks: ["ocean", "sea", "fjord", "sound", "water view", "islands"] },
  { name: "Mount Habrich", q: "Mount Habrich", aka: ["habrich"], looks: ["granite peak"] },
  { name: "Alice Lake", q: "Alice Lake Provincial Park", looks: ["lake"] },
  { name: "Smoke Bluffs", q: "Smoke Bluffs Park", aka: ["smoke bluffs"], looks: ["granite", "bluffs", "slabs", "rock slabs"] },
  { name: "Squamish River", q: "Squamish River", looks: ["river"] },
  { name: "Squamish Terminals", q: "Squamish Terminals", aka: ["squamish port", "squamish terminals", "port of squamish"], looks: ["port", "harbour", "harbor", "dock", "docks", "ships", "cranes", "terminal", "terminals"] },
  { name: "Squamish downtown", q: "Squamish, British Columbia", looks: ["town", "town below", "downtown", "houses"] },
  // Whistler
  { name: "Black Tusk", q: "Black Tusk", aka: ["tusk", "the black tusk"], looks: ["spire", "pointy black peak", "black peak", "tooth", "volcanic spire"] },
  { name: "Wedge Mountain", q: "Wedge Mountain, British Columbia", aka: ["wedge", "wedgemount"], looks: ["glacier", "biggest peak", "snowy peak"] },
  { name: "Whistler Mountain", q: "Whistler Mountain", aka: ["whistler peak", "whistler mountain"], looks: ["ski hill", "gondola", "ski runs", "lift"] },
  { name: "Blackcomb Mountain", q: "Blackcomb Peak", aka: ["blackcomb"], looks: ["ski hill", "glacier", "ski runs"] },
  { name: "Rainbow Mountain", q: "Rainbow Mountain, British Columbia", aka: ["rainbow mountain"] },
  { name: "Alta Lake", q: "Alta Lake, Whistler", aka: ["alta lake"], looks: ["lake"] },
  { name: "Green Lake", q: "Green Lake, Whistler", aka: ["green lake"], looks: ["lake", "turquoise lake", "green lake"] },
  { name: "Cheakamus Lake", q: "Cheakamus Lake", looks: ["turquoise lake", "lake"] },
  { name: "Brandywine Falls", q: "Brandywine Falls", aka: ["brandywine"], looks: ["waterfall"] },
  // Pemberton
  { name: "Mount Currie", q: "Mount Currie, British Columbia", aka: ["currie", "mt currie"], looks: ["big mountain", "huge mountain", "massive mountain", "big wall", "snowy face", "north face"] },
  { name: "Pemberton Valley", q: "Pemberton Meadows", looks: ["farm", "fields", "valley", "farmland", "flat valley"] },
  { name: "Lillooet Lake", q: "Lillooet Lake", looks: ["lake"] },
  // Lillooet, Chilcotin
  { name: "Seton Lake", q: "Seton Lake", aka: ["seton"], looks: ["turquoise lake", "lake"] },
  { name: "Mount Brew", q: "Mount Brew, Lillooet", aka: ["brew"] },
  { name: "Fraser Canyon", q: "Lillooet, British Columbia", looks: ["desert", "dry", "sage", "canyon", "sand"] },
  { name: "Tyaughton Lake", q: "Tyaughton Lake", looks: ["lake"] },
  { name: "Mount Sheba", q: "Mount Sheba, British Columbia", looks: ["alpine meadow", "wildflowers", "open ridge", "red rock"] },
  // Sunshine Coast, Powell River
  { name: "Mount Elphinstone", q: "Mount Elphinstone", aka: ["elphinstone"], looks: ["ocean", "islands"] },
  { name: "Strait of Georgia", q: "Strait of Georgia", looks: ["ocean", "sea", "islands", "vancouver island"] },
  { name: "Texada Island", q: "Texada Island", looks: ["island", "ocean"] },
  // Fraser Valley
  { name: "Golden Ears", q: "Golden Ears, British Columbia", aka: ["golden ears", "the ears"], looks: ["two peaks", "twin peaks"] },
  { name: "Mount Cheam", c: [49.16798, -121.69422], aka: ["cheam"], looks: ["big mountain", "snowy peak", "pyramid"] },
  { name: "Mount Baker", c: [48.77677, -121.81457], aka: ["baker", "mt baker"], looks: ["volcano", "snowy volcano", "big snowy mountain"] },
  { name: "Vedder Mountain", aka: ["vedder"] },
  { name: "Cultus Lake", q: "Cultus Lake", looks: ["lake"] },
  // Thompson, Okanagan, Cariboo
  { name: "Mount Tod", q: "Tod Mountain, British Columbia", aka: ["sun peaks", "tod mountain"], looks: ["ski hill", "lift"] },
  { name: "Kamloops Lake", q: "Kamloops Lake", looks: ["lake", "desert", "dry", "sage", "grassland", "hoodoos"] },
  { name: "Paul Lake", q: "Paul Lake, British Columbia", looks: ["lake"] },
  { name: "Okanagan Lake", q: "Okanagan Lake", looks: ["lake", "big lake", "vineyards", "orchards", "desert"] },
  { name: "Kalamalka Lake", q: "Kalamalka Lake", aka: ["kal lake", "kalamalka"], looks: ["turquoise lake", "lake", "teal lake"] },
  { name: "Skaha Bluffs", q: "Skaha Bluffs", aka: ["skaha"], looks: ["bluffs", "rock walls", "gneiss", "climbing"] },
  { name: "Skaha Lake", q: "Skaha Lake", looks: ["lake"] },
  { name: "McIntyre Bluff", q: "McIntyre Bluff", aka: ["mcintyre bluff"], looks: ["cliff", "big cliff", "bluff", "desert"] },
  { name: "Knox Mountain", aka: ["knox"], looks: ["lake", "city", "bridge"] },
  { name: "Silver Star Mountain", q: "Silver Star Mountain, British Columbia", aka: ["silver star"], looks: ["ski hill", "colourful village"] },
  { name: "Big White", q: "Big White Ski Resort", aka: ["big white"], looks: ["ski hill", "snow ghosts"] },
  { name: "Williams Lake", q: "Williams Lake (lake), British Columbia", looks: ["lake", "dry", "grassland", "river valley"] },
  { name: "Fraser River", q: "Fraser River", looks: ["river", "canyon", "dry", "sage", "hoodoos"] },
  { name: "Shuswap Lake", q: "Shuswap Lake", looks: ["lake"] },
  // Kootenays, Revelstoke, Golden
  { name: "Mount Begbie", c: [50.8686, -118.1478], aka: ["begbie"], looks: ["glacier", "big snowy peak", "snowy peak"] },
  { name: "Mount Mackenzie", q: "Revelstoke Mountain Resort", aka: ["mount mackenzie", "mt mac", "revelstoke mountain"], looks: ["ski hill", "gondola"] },
  { name: "Columbia River", q: "Columbia River, Revelstoke", looks: ["river"] },
  { name: "Mount Seven", q: "Mount 7 Golden", aka: ["mount 7", "mt 7", "mt seven"], looks: ["paragliding"] },
  { name: "Kicking Horse", q: "Kicking Horse Mountain Resort", aka: ["kicking horse", "kickinghorse"], looks: ["ski hill", "gondola", "jagged ridge", "rocky ridge"] },
  { name: "Old Glory", q: "Old Glory Mountain", aka: ["old glory"] },
  { name: "Red Mountain", q: "Red Mountain Resort", aka: ["red mountain", "red mtn"], looks: ["ski hill"] },
  { name: "Kootenay Lake", q: "Kootenay Lake", looks: ["lake"] },
  { name: "Elephant Mountain", q: "Pulpit Rock, Nelson", aka: ["elephant mountain", "pulpit rock"] },
  { name: "Mount Fernie", q: "Mount Fernie", looks: ["rocky peaks"] },
  { name: "Lake Windermere", q: "Windermere Lake", aka: ["windermere"], looks: ["lake"] },
  // Calgary & the Rockies
  { name: "Ha Ling Peak", q: "Ha Ling Peak", aka: ["ha ling", "chinamans peak"], looks: ["limestone", "rock face", "big rock", "cliff"] },
  { name: "Three Sisters", q: "Three Sisters, Alberta", aka: ["three sisters"], looks: ["three peaks", "rocky peaks", "limestone"] },
  { name: "Mount Lady Macdonald", q: "Mount Lady Macdonald", aka: ["lady mac", "lady macdonald"], looks: ["rocky peak"] },
  { name: "Mount Rundle", q: "Mount Rundle", aka: ["rundle"], looks: ["tilted rock", "slanted peak", "limestone", "rocky ridge"] },
  { name: "Cascade Mountain", q: "Cascade Mountain, Alberta", aka: ["cascade mountain"], looks: ["rocky peak", "big rock"] },
  { name: "Tunnel Mountain", c: [51.1833, -115.5553], aka: ["tunnel mountain"], looks: ["town view"] },
  { name: "Mount Yamnuska", q: "Mount Yamnuska", aka: ["yamnuska", "yam"], looks: ["cliff", "rock wall", "limestone", "big cliff"] },
  { name: "Moose Mountain", q: "Moose Mountain, Alberta", aka: ["moose mountain"], looks: ["lookout"] },
  { name: "Barrier Lake", c: [51.0306, -115.0367], looks: ["lake", "turquoise lake"] },
  { name: "Bow River", q: "Bow River, Canmore", looks: ["river"] },
  { name: "Calgary skyline", q: "Calgary Tower", looks: ["city", "skyline", "downtown"] },
];

const ua = { "User-Agent": "trail-finder landmarks (github.com/allduf/trail-finder)" };
const out = [];
for (const l of L) {
  let c = l.c;
  if (!c) {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ca,us&viewbox=-125.5,52.6,-113.4,48.6&bounded=1&q=${encodeURIComponent(l.q || l.name + ", British Columbia")}`, { headers: ua });
    const j = r.ok ? await r.json() : [];
    if (j[0]) c = [+(+j[0].lat).toFixed(5), +(+j[0].lon).toFixed(5)];
    await new Promise((res) => setTimeout(res, 1100));   // Nominatim: one request a second
  }
  if (!c) { console.error("not found:", l.name); continue; }
  out.push({ name: l.name, c, aka: l.aka || [], looks: l.looks || [] });
  console.error(l.name, c.join(","));
}
writeFileSync(new URL("../data/landmarks.json", import.meta.url), JSON.stringify({ v: 1, note: "scripts/build-landmarks.mjs", items: out }, null, 0) + "\n");
