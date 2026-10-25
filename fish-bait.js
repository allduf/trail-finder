// What to use for each fish at a spot (Fishing mode, the "What to use" line on a spot card).
// The angler picks how they fish once (fly, lures, bait, trolling, ice; saved as tf:fishStyle) and every fish found at
// the spot gets the best picks for that style, chosen for the season, the kind of water (lake, river, ocean) and what
// those fish eat in that part of Canada and, on well-known waters, in that water itself.
// Sources: provincial fisheries diet work (Kootenay Lake kokanee and Gerrards, Great Lakes and Lake Simcoe gobies and
// smelt), BC stillwater studies (chironomids, leeches, scuds), regional hatch charts and the usual guide and fly-shop
// patterns. Picks are a starting point, never a rule: the spot's Rules line says what gear and bait are allowed.
// Used by fishing.js: window.tfFishBait.render(el, ctx, fold, icon).
(function () {
  const KEY = "tf:fishStyle";
  const STYLES = [["fly", "Fly"], ["lure", "Lures"], ["bait", "Bait"], ["troll", "Trolling"], ["ice", "Ice"]];
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const getStyle = () => { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; } };
  const setStyle = (s) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} };

  // Seasons: wi Dec to Feb, sp Mar to May, su Jun to Aug, fa Sep to Nov (the far north runs a month late).
  const seasonOf = (m, lat) => { if (lat > 58) m = m === 1 ? 12 : m - 1; return m === 12 || m <= 2 ? "wi" : m <= 5 ? "sp" : m <= 8 ? "su" : "fa"; };

  // One entry per fish. m: names that match it (from BC, Ontario, Alberta, stocking and eating-guide lists).
  // eats: what it feeds on by season. Each pick is "text" plus optional tags: @sp,su,fa,wi (seasons) and #lake,river,ocean.
  const FISH = [
    { k: "rainbow", m: /rainbow|kamloops|gerrard|triploid/i, n: "Rainbow trout",
      eats: { sp: "chironomids after ice-off, leeches and scuds; in rivers, stonefly and mayfly nymphs", su: "damselflies, caddis, mayflies and leeches; deeper on hot days", fa: "leeches, scuds and bloodworms in the shallows as the water cools; in rivers, eggs behind spawning salmon", wi: "midges and scuds, slow and deep" },
      fly: ["Chironomid pupa under an indicator, a foot off the bottom @sp,fa #lake", "Balanced leech (black, maroon) @sp,su,fa #lake", "Damsel nymph along the weed edge @su #lake", "Scud or bloodworm, slow strip @fa,wi #lake", "Stonefly or pheasant tail nymph @sp,su,fa #river", "Elk hair caddis or parachute Adams in the evening @su #river,lake", "Egg pattern behind spawning salmon @fa #river", "Woolly bugger, olive or black"],
      lure: ["Small spinner (Mepps #1-2, Panther Martin)", "Kastmaster or small spoon", "Rooster Tail @sp,su", "Small jerkbait or minnow plug @fa,sp", "Float and jig (pink or black) @fa,wi #river"],
      bait: ["Worm under a float", "PowerBait on a sliding sinker #lake", "Single salmon egg or roe under a float @fa,wi #river", "Krill or shrimp under a float #lake"],
      troll: ["Wedding band or spinner with a bit of worm", "Small flatfish or spoon on a long line, 1.5-3 km/h", "Leech or woolly bugger on a full sinking line @sp,fa #lake", "Deeper with a downrigger or lead core @su #lake"],
      ice: ["Small jig tipped with a mealworm or maggot", "Dead-stick PowerBait just under the ice", "Small spoon jigged a few metres down"] },
    { k: "steelhead", m: /steelhead/i, n: "Steelhead",
      eats: { fa: "salmon eggs and flesh behind the runs", wi: "eggs and nymphs, holding in slow deep runs", sp: "stonefly nymphs and eggs, moving on rising water", su: "summer runs take skated dries and small flies" },
      fly: ["Intruder or leech on a sink tip, swung", "Egg pattern under an indicator @fa,wi", "Skated dry (bomber) for summer fish @su", "Stonefly nymph @sp"],
      lure: ["Float and jig (pink, purple, black)", "Spoon or spinner swung through the run", "Pink worm under a float"],
      bait: ["Roe bag or cured roe under a float", "Dew worm drifted on the bottom", "Shrimp or prawn under a float"],
      troll: ["Plug (Kwikfish) back-trolled from a drift boat"], ice: [] },
    { k: "cutthroat", m: /cutthroat/i, n: "Cutthroat trout",
      eats: { sp: "salmon fry and sticklebacks (coast), stoneflies and mayflies (Rockies)", su: "terrestrials, caddis, golden stones and drakes", fa: "eggs and flesh behind salmon; October caddis", wi: "small nymphs and midges" },
      fly: ["Rolled muddler or fry pattern @sp #river,ocean", "Chernobyl ant or hopper @su", "Stimulator or golden stone @su #river", "Egg or flesh fly behind spawners @fa #river", "Clouser minnow on the beach #ocean"],
      lure: ["Small spinner", "Small spoon", "Minnow plug near rocky shores #ocean"],
      bait: ["Worm under a float", "Roe under a float @fa"], troll: ["Small spoon or wedding band in lakes #lake"], ice: ["Small jig and bait"] },
    { k: "brook", m: /brook trout|speckled|omble de fontaine|splake/i, n: "Brook trout",
      eats: { sp: "smelt and minnows after ice-out, then mayflies", su: "terrestrials, mayflies and caddis, deep and cool on hot days", fa: "minnows and leeches, aggressive before spawning", wi: "nymphs, scuds and minnows under the ice" },
      fly: ["Streamer (grey ghost, muddler) after ice-out @sp", "Hare's ear or pheasant tail nymph", "Elk hair caddis or Adams @su", "Small leech or woolly bugger @fa", "Ant or beetle @su #river"],
      lure: ["Small spinner (Mepps #0-1)", "Small spoon (Little Cleo, Kastmaster)", "Small jig"],
      bait: ["Worm on a small hook", "Maggot or grub under a float"],
      troll: ["Lake troll (willow leaf) with a worm", "Small spoon on a long line @sp"], ice: ["Small spoon or jig tipped with a worm or maggot", "Tip-up with bait close to shore"] },
    { k: "brown", m: /brown trout/i, n: "Brown trout",
      eats: { sp: "stoneflies and sculpins, BWOs on cloudy days", su: "caddis, PMDs and hoppers; big ones feed at night", fa: "sculpins, minnows and eggs before spawning", wi: "midges and slow nymphs" },
      fly: ["Sculpin or bow-river bugger streamer", "Stonefly nymph @sp,fa", "Caddis or PMD dry in the evening @su", "Hopper @su", "Mouse pattern after dark @su"],
      lure: ["Rapala or jerkbait in low light", "Spinner (Blue Fox #2-3)", "Small swimbait"],
      bait: ["Worm drifted on the bottom", "Minnow (where live bait is allowed)"],
      troll: ["Minnow plug or spoon at dusk #lake"], ice: ["Small spoon or jig with bait"] },
    { k: "laker", m: /lake trout|touladi|namaycush/i, n: "Lake trout",
      eats: { sp: "smelt, ciscoes and minnows near the surface after ice-out", su: "ciscoes and smelt deep, under the warm layer (15-30 m)", fa: "smelt and ciscoes on shallow rocky shoals, where they move in to spawn", wi: "ciscoes, smelt and gobies; roams shallower under the ice" },
      fly: ["Big streamer on a full sinking line after ice-out @sp", "Big streamer over rocky shoals @fa"],
      lure: ["Heavy spoon (Williams, Little Cleo) cast at ice-out @sp", "White tube jig on the bottom", "Blade bait jigged deep @su"],
      bait: ["Dead smelt or cisco on the bottom (where allowed)"],
      troll: ["Spoon or Lyman plug shallow after ice-out @sp", "Downrigger or lead core 15-30 m with a spoon or dodger @su", "Spoon over shoals @fa"],
      ice: ["White tube jig or bucktail jig", "Swimming jig (Jigging Rap) or Williams spoon", "Dead smelt on a tip-up (where allowed)"] },
    { k: "bull", m: /bull trout|dolly varden/i, n: "Bull trout",
      eats: { sp: "kokanee, whitefish and sculpins", su: "fish: whitefish, kokanee and young trout", fa: "eggs and fry at kokanee and salmon spawning", wi: "fish, deep" },
      fly: ["Big articulated streamer (white or olive)", "Egg and flesh behind kokanee spawning @fa"],
      lure: ["Large spoon or spinner", "Big swimbait or jig"],
      bait: ["Most bull trout waters are bait-banned and catch and release: check the rules"],
      troll: ["Large plug or spoon (Lyman, Apex) @sp,su #lake"], ice: [] },
    { k: "kokanee", m: /kokanee/i, n: "Kokanee",
      eats: { sp: "zooplankton (Daphnia) near the surface", su: "zooplankton deeper as the water warms, often 10-25 m", fa: "they stop eating to spawn: red fish turn in the creeks", wi: "zooplankton" },
      fly: ["Small red or pink chironomid or bloodworm, deep"],
      lure: ["Small pink spinner jigged deep"],
      bait: ["Maggots or corn on a small hook (check the rules)"],
      troll: ["Dodger plus pink hoochie or Wedding Ring, tipped with corn", "Slow: 1.5-2.5 km/h", "Downrigger to their depth @su"],
      ice: ["Small pink or chartreuse jig tipped with maggots or corn"] },
    { k: "chinook", m: /chinook|spring salmon|king salmon/i, n: "Chinook salmon",
      eats: { sp: "herring and needlefish (sand lance)", su: "herring, anchovy and sand lance; deep on bright days", fa: "staging fish at river mouths stop feeding, they bite out of anger", wi: "herring, deep (winter feeders)" },
      fly: ["Clouser or baitfish fly near the surface #ocean", "Big intruder swung #river @fa"],
      lure: ["Spoon (Coho Killer, Gibbs) or Buzz Bomb", "Spin-N-Glo or roe in rivers @fa #river"],
      bait: ["Cut-plug herring or anchovy", "Roe under a float @fa #river"],
      troll: ["Flasher plus hoochie or spoon, 60-150 ft on the downrigger #ocean", "Cut-plug or whole herring in a teaser head", "Early morning tide changes"], ice: [] },
    { k: "coho", m: /coho/i, n: "Coho salmon",
      eats: { su: "herring, needlefish and krill near the surface", fa: "they stop eating in rivers but snap at flashy gear", sp: "young herring and krill" },
      fly: ["Pink or chartreuse Clouser on the beach #ocean", "Wool head or flash fly, fast strip @fa #river"],
      lure: ["Blue Fox or Mepps spinner #river", "Pink or chartreuse spoon", "Pink jig under a float @fa #river"],
      bait: ["Roe under a float @fa #river", "Herring strip #ocean"],
      troll: ["Flasher plus hoochie shallow, 20-60 ft #ocean", "Bucktail fly at the surface #ocean"], ice: [] },
    { k: "pacific", m: /pink salmon|chum|sockeye/i, n: "Pink, chum and sockeye",
      eats: { su: "krill and small fish at sea", fa: "not feeding in rivers: they bite small pink or flashy gear" },
      fly: ["Small pink fly (pinks), chartreuse or purple (chum)"], lure: ["Small pink spoon or jig", "Pink jig under a float #river"],
      bait: ["Usually not needed"], troll: ["Small pink hoochie behind a flasher, slow #ocean"], ice: [] },
    { k: "atlantic", m: /atlantic salmon|ouananiche|landlocked|saumon/i, n: "Atlantic salmon",
      eats: { sp: "smelt after ice-out (landlocked)", su: "searun salmon don't feed in rivers; landlocked eat smelt and insects", fa: "staging before spawning" },
      fly: ["Wet fly (Green Machine, Bomber dry, Undertaker) @su,fa #river", "Smelt streamer (grey ghost) @sp #lake"],
      lure: ["Most salmon rivers are fly only: check the rules #river", "Small spoon for landlocked salmon #lake"],
      bait: ["Not allowed on salmon rivers"], troll: ["Streamer or small spoon near the surface after ice-out @sp #lake"], ice: [] },
    { k: "grayling", m: /grayling/i, n: "Arctic grayling",
      eats: { su: "mayflies, caddis and mosquitoes at the surface", fa: "nymphs and drowned insects" },
      fly: ["Parachute Adams or elk hair caddis", "Small bead-head nymph"], lure: ["Small spinner (#0-1)"], bait: ["Small worm (if allowed)"], troll: [], ice: [] },
    { k: "whitefish", m: /whitefish|cisco|herring/i, n: "Whitefish",
      eats: { wi: "nymphs and insect larvae on the bottom", sp: "midges and nymphs", su: "emerging insects", fa: "eggs and nymphs" },
      fly: ["Small bead-head nymph (#14-18)", "Small dry when they rise @su"], lure: ["Tiny jig"], bait: ["Maggots on a small hook", "Small piece of worm"], troll: [],
      ice: ["Small jig or spoon tipped with maggots, near the bottom"] },
    { k: "walleye", m: /walleye|sauger|doré/i, n: "Walleye",
      eats: { sp: "minnows and spawning shiners on rocky shoals and river mouths", su: "perch, ciscoes and gobies on weed edges and humps; shallow at dusk", fa: "perch and ciscoes, moving shallower as the water cools", wi: "minnows and perch, near the bottom" },
      fly: ["Clouser minnow on a sinking line, slow"],
      lure: ["Jig and minnow (1/4-3/8 oz)", "Jig and soft plastic (twister, paddle tail)", "Crankbait or jerkbait at dusk", "Blade bait (Vib-E) @fa,wi,sp"],
      bait: ["Worm harness (crawler) behind a bottom bouncer @su", "Live or dead minnow on a slip-bobber @sp,fa", "Leech on a slip-bobber @su"],
      troll: ["Crawler harness at 1.5-2.5 km/h @su", "Shad Rap or Reef Runner along breaklines @su,fa"],
      ice: ["Jigging Rap or Rattle Spoon", "Tip-up or dead stick with a minnow, near the bottom", "Low light: dawn and dusk"] },
    { k: "pike", m: /pike|brochet/i, n: "Northern pike",
      eats: { sp: "anything moving in warm shallow bays after ice-out", su: "perch, suckers and ciscoes along weed edges", fa: "fattening up: big baitfish", wi: "dead fish and perch" },
      fly: ["Big bunny or flashy streamer, steel leader", "Popper or diver in shallow weeds @su"],
      lure: ["Daredevle spoon", "Spinnerbait over weeds", "Big inline spinner", "Swimbait or jerkbait @fa"],
      bait: ["Dead smelt or cisco under a float (where allowed)", "Large minnow under a float"],
      troll: ["Spoon or crankbait along weed edges"],
      ice: ["Tip-up with a dead smelt or cisco", "Big spoon or swimbait jig"] },
    { k: "muskie", m: /muskellunge|muskie|maskinongé/i, n: "Muskellunge",
      eats: { su: "suckers, ciscoes and perch on weed beds and rock humps", fa: "big ciscoes and suckers; the best time for giants" },
      fly: ["Big double-bunny or articulated streamer, steel leader"],
      lure: ["Bucktail inline spinner (Double Cowgirl)", "Topwater (Pacemaker, Hawg Wobbler) @su", "Glide bait or big swimbait @fa", "Figure-8 at the boat every cast"],
      bait: ["Sucker on a quick-strike rig (where allowed) @fa"], troll: ["Big crankbait along breaklines @fa"], ice: [] },
    { k: "perch", m: /yellow perch|perchaude|^perch/i, n: "Yellow perch",
      eats: { sp: "insect larvae and minnows on the bottom", su: "minnows, gobies, crayfish and insects", fa: "minnows and larvae in schools", wi: "insect larvae and small minnows" },
      fly: ["Small bead-head nymph or woolly bugger"],
      lure: ["Small jig with a soft plastic", "Drop shot with a small plastic"],
      bait: ["Worm or minnow on a small hook near the bottom", "Perch rig with two small hooks"],
      troll: [], ice: ["Small jig or spoon tipped with a minnow head or maggots"] },
    { k: "smallmouth", m: /smallmouth/i, n: "Smallmouth bass",
      eats: { sp: "crayfish and minnows on warming rocky flats", su: "crayfish, gobies and minnows; topwater in low light", fa: "baitfish schools, deeper rocky drops", wi: "slow, deep" },
      fly: ["Crayfish pattern or Clouser", "Popper at dusk @su"],
      lure: ["Tube jig (green pumpkin)", "Drop shot or Ned rig", "Jerkbait @sp,fa", "Topwater (Pop-R, walking bait) @su"],
      bait: ["Crayfish or leech", "Worm"], troll: [], ice: [] },
    { k: "largemouth", m: /largemouth/i, n: "Largemouth bass",
      eats: { sp: "minnows and crayfish in warm shallow bays", su: "frogs, bluegill and crayfish in heavy cover", fa: "baitfish and bluegill" },
      fly: ["Deer hair frog or popper", "Bunny leech"],
      lure: ["Wacky-rigged stick bait (Senko)", "Hollow-body frog over pads @su", "Spinnerbait or chatterbait", "Texas-rigged creature bait in cover"],
      bait: ["Worm or minnow under a float"], troll: [], ice: [] },
    { k: "panfish", m: /crappie|bluegill|pumpkinseed|sunfish|rock bass/i, n: "Crappie and sunfish",
      eats: { sp: "minnows and insects in shallow warm bays", su: "insects and small minnows", fa: "minnows, suspending in schools", wi: "zooplankton and larvae" },
      fly: ["Small popper or foam spider @su", "Small nymph or woolly bugger"],
      lure: ["Small jig and twister (1/32-1/16 oz) under a float"], bait: ["Worm or small minnow under a float"], troll: [],
      ice: ["Tiny jig and maggot, suspended where the fish show"] },
    { k: "catfish", m: /catfish|bullhead|barbotte/i, n: "Catfish",
      eats: { su: "anything on the bottom, most at night" }, fly: [], lure: [],
      bait: ["Worms, cut bait or chicken liver on the bottom, at night"], troll: [], ice: [] },
    { k: "sturgeon", m: /sturgeon|esturgeon/i, n: "Sturgeon",
      eats: { sp: "eulachon and salmon (Fraser)", su: "lamprey and salmon carcasses", fa: "salmon roe and flesh" },
      fly: [], lure: [], bait: ["Fraser: eulachon, lamprey or salmon roe on a barbless hook, heavy bottom rig", "Catch and release only: keep it in the water"], troll: [], ice: [] },
    { k: "burbot", m: /burbot|lotte/i, n: "Burbot",
      eats: { wi: "fish and crayfish on the bottom, at night" }, fly: [], lure: ["Glow jig on the bottom"],
      bait: ["Cut bait or a minnow on the bottom at night"], troll: [], ice: ["Glow jig or rattle spoon tipped with fish, on the bottom after dark"] },
    { k: "carp", m: /carp/i, n: "Carp",
      eats: { su: "insects, snails and plants in shallow muddy water" }, fly: ["Small nymph or carp fly sight-fished in the shallows"], lure: [],
      bait: ["Sweet corn or a boilie on a hair rig", "Dough ball"], troll: [], ice: [] },
    { k: "goldeye", m: /goldeye|mooneye/i, n: "Goldeye",
      eats: { su: "insects at the surface in murky rivers" }, fly: ["Small dry fly or nymph"], lure: ["Small spinner"], bait: ["Worm or grasshopper under a float"], troll: [], ice: [] },
    { k: "char", m: /arctic char/i, n: "Arctic char",
      eats: { su: "sand lance, small fish and amphipods", fa: "running up rivers" }, fly: ["Small streamer or egg pattern"], lure: ["Spoon (Len Thompson) or spinner"], bait: [], troll: ["Spoon"], ice: ["Small jig"] },
    { k: "lingcod", m: /lingcod|rockfish|greenling/i, n: "Lingcod and rockfish",
      eats: { su: "rockfish, herring and crabs on rocky reefs" }, fly: [], lure: ["Heavy leadhead with a big swimbait", "Buzz Bomb or jigging spoon on the reef"],
      bait: ["Herring or squid on the bottom"], troll: [], ice: [] },
    { k: "halibut", m: /halibut/i, n: "Halibut",
      eats: { su: "herring, octopus and crab on sandy bottom" }, fly: [], lure: ["Big jig (P-Line) or a 12-16 oz leadhead with a big swimbait"],
      bait: ["Herring, salmon belly or octopus on a circle hook, anchored on the bottom"], troll: [], ice: [] },
    { k: "striper", m: /striped bass|bar rayé/i, n: "Striped bass",
      eats: { sp: "gaspereau and smelt", su: "mackerel, sand eels and silversides", fa: "silversides and herring" },
      fly: ["Clouser or deceiver"], lure: ["Topwater pencil popper at dawn", "Soft plastic on a jighead"], bait: ["Mackerel chunk or sea worm on the bottom"], troll: [], ice: [] },
    { k: "mackerel", m: /mackerel|maquereau/i, n: "Mackerel",
      eats: { su: "small fish in schools" }, fly: ["Small flashy fly"], lure: ["Mackerel jig rig (feathers or tinsel)", "Small spoon"], bait: ["Strip of mackerel"], troll: [], ice: [] },
    { k: "smelt", m: /rainbow smelt|éperlan/i, n: "Smelt",
      eats: { wi: "zooplankton" }, fly: [], lure: [], bait: ["Tiny hook with a bit of worm or fish"], troll: [], ice: ["Small smelt rig with bits of fish, at night"] },
  ];
  // Fish anglers want first (the spot's list is often long).
  const ORDER = ["walleye", "rainbow", "brook", "laker", "brown", "smallmouth", "pike", "largemouth", "muskie", "perch", "steelhead", "cutthroat", "bull", "kokanee", "chinook", "coho", "atlantic", "grayling", "char", "striper", "panfish", "whitefish", "lingcod", "halibut", "pacific", "mackerel", "sturgeon", "burbot", "catfish", "goldeye", "carp", "smelt"];
  const byKey = Object.fromEntries(FISH.map((f) => [f.k, f]));

  // What's likely at a spot when the province lists no fish there.
  const LIKELY = {
    coast: { lake: ["rainbow", "cutthroat", "kokanee"], river: ["cutthroat", "steelhead", "coho", "rainbow"], ocean: ["chinook", "coho", "lingcod", "halibut", "cutthroat"] },
    west: { lake: ["rainbow", "kokanee", "brook", "laker", "bull"], river: ["rainbow", "cutthroat", "bull", "whitefish", "brown"] },
    prairie: { lake: ["walleye", "pike", "perch", "rainbow"], river: ["walleye", "pike", "goldeye", "brown"] },
    east: { lake: ["walleye", "pike", "smallmouth", "perch", "brook", "laker"], river: ["smallmouth", "walleye", "brook", "muskie"], ocean: ["striper", "mackerel", "atlantic"] },
    north: { lake: ["laker", "pike", "walleye", "grayling"], river: ["grayling", "pike", "char"] },
  };

  // Waters where the food is known well enough to say so. [lat, lon, km, name, { fish key or "*": note }]
  const LOCAL = [
    [44.42, -79.37, 30, "Lake Simcoe", { laker: "smelt, ciscoes and round gobies, so white tubes and goby-coloured jigs", whitefish: "gobies, insect larvae and zebra mussels, so small spoons and jigs tipped with a minnow", perch: "jumbo perch eat gobies and larvae, so goby-coloured jigs on the bottom", "*": "Round gobies and smelt are the main forage here" }],
    [43.6, -77.8, 120, "Lake Ontario", { chinook: "alewife, so green, white and glow spoons and flies", coho: "alewife, so small silver spoons", laker: "alewife, smelt and round gobies", "*": "Alewife and round gobies are the main forage" }],
    [42.3, -81.2, 120, "Lake Erie", { walleye: "emerald shiners and gizzard shad, so trolled spoons and stickbaits", perch: "emerald shiners on a perch rig", smallmouth: "round gobies, so tubes and drop shots on rocks", "*": "Emerald shiners and round gobies are the main forage" }],
    [44.9, -81.8, 150, "Lake Huron and Georgian Bay", { "*": "Round gobies, smelt and alewife are the main forage" }],
    [45.2, -74.6, 150, "the St. Lawrence", { smallmouth: "round gobies, so goby-coloured tubes and drop shots", walleye: "gobies and shiners", "*": "Round gobies are everywhere on the bottom: goby-coloured tubes and jigs work" }],
    [48.6, -72.1, 50, "Lac Saint-Jean", { atlantic: "ouananiche live on smelt, so smelt streamers and small silver spoons", walleye: "smelt and perch", "*": "Smelt is the main forage" }],
    [49.7, -116.9, 60, "Kootenay Lake", { rainbow: "Gerrard rainbows eat almost only kokanee, so big kokanee-coloured plugs and hoochies", bull: "kokanee", kokanee: "mysis shrimp and zooplankton", "*": "Kokanee are the main forage" }],
    [49.95, -119.5, 60, "Okanagan Lake", { rainbow: "kokanee and mysis shrimp, so kokanee-coloured spoons for big rainbows", kokanee: "zooplankton and mysis", "*": "Kokanee and mysis shrimp are the main forage" }],
    [50.95, -119.25, 60, "Shuswap Lake", { rainbow: "kokanee and sockeye fry, so Lyman plugs and white flies", bull: "kokanee and fry", "*": "Kokanee and sockeye fry are the main forage" }],
    [50.67, -120.3, 70, "the Kamloops lakes", { rainbow: "chironomids, leeches, scuds and damselflies", "*": "Chironomids, leeches and scuds are the main food" }],
    [51.1, -115.5, 90, "the Bow River", { rainbow: "stoneflies, caddis and sculpins, so sculpin streamers and stonefly nymphs", brown: "sculpins and stoneflies", "*": "Sculpins and stoneflies are the main food" }],
    [49.2, -122.5, 50, "the lower Fraser", { sturgeon: "eulachon and salmon", cutthroat: "salmon fry and eggs", "*": "Salmon fry, eggs and eulachon are the main food" }],
  ];
  const km = (a, b, c, d) => { const r = Math.PI / 180, x = (d - b) * r * Math.cos(((a + c) / 2) * r), y = (c - a) * r; return Math.hypot(x, y) * 6371; };
  const localAt = (lat, lon) => LOCAL.filter(([a, b, r]) => km(lat, lon, a, b) <= r).sort((p, q) => p[2] - q[2])[0];

  const tagOk = (t, se, water) => {
    const s = (t.match(/@([a-z,]+)/) || [])[1], w = (t.match(/#([a-z,]+)/) || [])[1];
    return (!s || s.split(",").includes(se)) && (!w || !water || w.split(",").includes(water));
  };
  const clean = (t) => t.replace(/\s*[@#][a-z,]+/g, "").trim();
  // The best picks for a fish: ones that match this season and water first, then ones with no season tag.
  function picks(f, style, se, water) {
    const list = (f[style] || []).filter((t) => tagOk(t, se, water));
    const seasonal = list.filter((t) => /@/.test(t)), rest = list.filter((t) => !/@/.test(t));
    return [...seasonal, ...rest].slice(0, 3).map(clean);
  }
  const RULE = { bait: "BC and Alberta ban live fish as bait, and many trout waters are bait-banned. Ontario baitfish can't leave their Bait Management Zone. Quebec bans live baitfish. Check the Rules line.",
    fly: "Many rivers are fly only or single barbless hook: check the Rules line.", ice: "Only on safe ice: 10 cm of clear ice to walk on.", troll: "", lure: "" };

  // Fish keys at a spot from its species names, in the order anglers care about.
  function fishKeys(names) {
    const out = new Set();
    for (const n of names) for (const f of FISH) if (f.m.test(n)) { out.add(f.k); break; }
    return ORDER.filter((k) => out.has(k));
  }

  // ctx: { lat, lon, month, region, water ("lake"|"river"|"ocean"|""), species: [names], hatch: [names of what's hatching now] }
  function render(el, ctx, fold, icon) {
    if (!el) return;
    const style = getStyle(), se = seasonOf(ctx.month, ctx.lat), loc = localAt(ctx.lat, ctx.lon);
    let keys = fishKeys(ctx.species || []), guessed = false;
    if (!keys.length) { const L = LIKELY[ctx.region] || LIKELY.west; keys = L[ctx.water] || L.lake || []; guessed = true; }
    if (!keys.length) { el.innerHTML = ""; return; }
    if (loc) keys = [...keys.filter((k) => loc[4][k]), ...keys.filter((k) => !loc[4][k])];   // the fish this water is known for first
    const chips = `<p class="fs-note"><b>How do you fish?</b></p><div class="fs-chips fs-style">${STYLES.map(([k, n]) => `<button type="button" class="fs-chip${style === k ? " on" : ""}" data-style="${k}">${n}</button>`).join("")}</div>`;
    let body = chips, sum = "Pick how you fish";
    if (style) {
      const rows = [];
      for (const k of keys) {
        const f = byKey[k], p = picks(f, style, se, ctx.water);
        if (!p.length) continue;
        rows.push({ f, p, eats: f.eats[se] || "", here: loc && loc[4][k] });
      }
      const hatchLine = style === "fly" && ctx.hatch && ctx.hatch.length && keys.some((k) => ["rainbow", "brook", "brown", "cutthroat", "grayling", "whitefish"].includes(k))
        ? `<p class="fs-note"><b>Hatching now:</b> ${esc(ctx.hatch.slice(0, 3).join(", "))}. Match it for trout that are rising.</p>` : "";
      const li = (r) => `<li><b>${esc(r.f.n)}</b><span>${r.p.map(esc).join("<br>")}</span>${r.eats ? `<small>Eats now: ${esc(r.eats)}.</small>` : ""}${r.here ? `<small>In ${esc(loc[3])}: ${esc(r.here)}.</small>` : ""}</li>`;
      const top = rows.slice(0, 4), more = rows.slice(4);
      const label = STYLES.find((s) => s[0] === style)[1];
      sum = rows.length ? `${label}, ${rows.length} fish` : label;
      body += hatchLine + (loc && loc[4]["*"] ? `<p class="fs-note"><b>${esc(loc[3])}:</b> ${esc(loc[4]["*"])}.</p>` : "")
        + (rows.length ? `<ul class="fs-bait">${top.map(li).join("")}</ul>${more.length ? `<details class="fs-more"><summary>${more.length} more fish</summary><ul class="fs-bait">${more.map(li).join("")}</ul></details>` : ""}`
          : `<p class="fs-note">${style === "ice" && se !== "wi" ? "Ice fishing picks show here once it's winter, or pick another style." : "Nothing special for this style here: try another one."}</p>`)
        + `<p class="fs-note">${guessed ? "The province lists no fish for this exact spot, so these are the usual fish for this kind of water nearby. " : ""}${esc(RULE[style])}</p>`;
    }
    el.innerHTML = fold("bait", icon, "What to use", sum, body, !style);
    el.querySelectorAll("[data-style]").forEach((b) => b.addEventListener("click", (e) => {
      e.preventDefault();
      setStyle(b.dataset.style);
      render(el, ctx, fold, icon);
      const d = el.querySelector("details.fs-sec"); if (d) d.open = true;
    }));
  }

  window.tfFishBait = { render, fishKeys, styles: STYLES.map((s) => s[0]) };
})();
