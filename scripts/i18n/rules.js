  // ---- texts with numbers or names in them (from scripts/i18n/rules.js) ----
  // Each: [pattern on the whole text, French]. A function gets the pieces; tw() translates a piece that's itself a word.
  function tw(s) { var f = D[s]; return f === undefined ? s : f; }
  var UNIT = { minute: "minute", minutes: "minutes", hour: "heure", hours: "heures", day: "jour", days: "jours", week: "semaine", weeks: "semaines", month: "mois", months: "mois", year: "an", years: "ans" };
  function tt(s) { var f = tr(s); return f == null ? s : f.trim(); }   // a piece that may itself need the rules
  var MON = { Jan: "janv.", January: "janvier", Feb: "févr.", February: "février", Mar: "mars", March: "mars", Apr: "avr.", April: "avril", May: "mai",
    June: "juin", Jun: "juin", July: "juillet", Jul: "juill.", Aug: "août", August: "août", Sept: "sept.", Sep: "sept.", September: "septembre",
    Oct: "oct.", October: "octobre", Nov: "nov.", November: "novembre", Dec: "déc.", December: "décembre" };
  var MONRE = "(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec)";
  // "Oct 3, 2026" -> "3 oct. 2026", "April 1st, 2026" -> "1er avril 2026"
  function dt(s) {
    return s.replace(new RegExp("\\b(" + MONRE + ") (\\d{1,2})(?:st|nd|rd|th)?(?:,? (\\d{4}))?\\b", "g"), function (m, mo, d, y) {
      return (d === "1" ? "1er" : d) + " " + MON[mo] + (y ? " " + y : "");
    }).replace(/ to /g, " au ").replace(/ - /g, " au ");
  }
  var DATES = new RegExp("^" + MONRE + " \\d");
  // "Wild turkey, Snowshoe hare, Coyote +6 more": each animal on its own.
  function tl(s) { return s.split(", ").map(function (p) { var n = /^(.+?) \+(\d+)(?: more)?$/.exec(p); return n ? tt(n[1]) + " +" + n[2] + (/ more$/.test(p) ? " autres" : "") : tt(p); }).join(", "); }
  var R = [
    // ask.js: a mountain or ridge with no tour mapped on it, planned from the closest road (2026-11-10)
    [/^No tour mapped on (.+): finding the closest road to it…$/, "Aucune sortie tracée sur $1 : recherche de la route la plus proche…"],
    [/^No ski tour is mapped on (.+) in the app yet, so this one starts from the closest road to it\.$/, "Aucune sortie de ski n'est encore tracée sur $1 dans l'appli : celle-ci part donc de la route la plus proche."],
    [/^A tour to (.+)$/, "Une sortie vers $1"],
    [/^(.+) from the top in a straight line$/, function (m, d) { return (d === "under 1 km" ? "moins de 1 km" : d) + " du sommet à vol d'oiseau"; }],
    [/^at the top of (.+)$/, "au sommet de $1"],
    [/^about ([\d,\s]+) m high$/, function (m, h) { return "environ " + h.replace(/,/g, " ") + " m d'altitude"; }],
    [/^No drivable road is mapped within 15 km of (.+)\. The map is there now: tap it where you start, then ✎ Edit my tour adds the rest\.$/, "Aucune route carrossable n'est tracée à moins de 15 km de $1. La carte y est maintenant : touchez-la là où vous partez, puis ✎ Modifier ma sortie ajoute le reste."],
    [/^Show the (\d+) ski tours nearby instead$/, "Voir plutôt les $1 sorties de ski à proximité"],
    // lifts.js: a resort's run and lift counts today, and a run's status on its card (2026-11-10)
    [/^(\d+) of (\d+) runs open$/, "$1 pistes ouvertes sur $2"],
    [/^(\d+) of (\d+) (chairlifts|lifts) running$/, function (m, a, b, k) { return a + " " + (k === "chairlifts" ? "télésièges" : "remontées") + " en marche sur " + b; }],
    [/^(\d+) of (\d+) magic carpets$/, "$1 tapis magiques sur $2"],
    [/^Today at (.+?)(:?)$/, function (m, n, c) { return "Aujourd'hui à " + n + (c ? " :" : ""); }],
    [/^(.+) says (\d+) of its (\d+) lifts run today( but not which ones)?\.$/, function (m, n, a, b, w) { return n + " indique que " + a + " de ses " + b + " remontées fonctionnent aujourd'hui" + (w ? ", sans dire lesquelles" : "") + "."; }],
    [/^The resort's report has no time on it: checked (.+)\.$/, function (m, t) { var a = /^(\d+) min ago$/.exec(t), h = /^(\d+) h ago$/.exec(t); return "Le rapport de la station n'indique pas d'heure : vérifié " + (t === "just now" ? "à l'instant" : a ? "il y a " + a[1] + " min" : h ? "il y a " + h[1] + " h" : t) + "."; }],
    [/^From the resort's own report, checked (.+):$/, function (m, t) { var a = /^(\d+) min ago$/.exec(t), h = /^(\d+) h ago$/.exec(t), d = /^(\d+) days? ago$/.exec(t); return "Du rapport de la station, vérifié " + (t === "just now" ? "à l'instant" : a ? "il y a " + a[1] + " min" : h ? "il y a " + h[1] + " h" : d ? "il y a " + d[1] + " j" : t) + " :"; }],
    // winter.js: the map's snow at This spot's height, when it differs from the card (2026-11-10)
    [/^The map's New snow and Snow forecast colours at (.+?) here: (\d+) cm in the last 24 h, (\d+) cm in the next 3 days\. The map blends the forecast points around \(7 to 11 km apart\), this card is the forecast for this spot\.$/, function (m, h, a, b) { return "Les couleurs Neige récente et Prévision de neige de la carte à " + h.replace(/,/g, " ") + " ici : " + a + " cm dans les 24 dernières heures, " + b + " cm dans les 3 prochains jours. La carte mélange les points de prévision autour (à 7 à 11 km les uns des autres), cette fiche est la prévision pour cet endroit."; }],
    // winter.js: the tour picked on its card is the start of Plan a tour (2026-11-10)
    [/^(.+) is in your tour\. Tap the map to go on from its end\.$/, "$1 est dans votre sortie. Touchez la carte pour continuer depuis sa fin."],
    [/^Putting (.+) in your tour…$/, "Ajout de $1 à votre sortie…"],
    [/^📂 Saved tours \((\d+)\)$/, "📂 Sorties enregistrées ($1)"],   // winter.js, the tour card
    [/^✓ Saved as (.+)$/, "✓ Enregistrée sous « $1 »"],
    // winter.js noFcWhy: why a Less exposed way has no avalanche forecast in it
    [/^(Avalanche Canada|The Japan Avalanche Network) hasn't published a forecast for (.+) today\.(?: (.+))?$/, function (m, w, a, x) { return (w === "Avalanche Canada" ? "Avalanche Canada" : "Le Japan Avalanche Network") + " n'a pas publié de bulletin pour " + (a === "this area" ? "ce secteur" : a) + " aujourd'hui." + (x ? " " + tt(x) : ""); }],
    [/^(Avalanche Canada|The Japan Avalanche Network)'s forecast(?: for (.+))? gives no danger rating today\.$/, function (m, w, a) { return "Le bulletin " + (w === "Avalanche Canada" ? "d'Avalanche Canada" : "du Japan Avalanche Network") + (a ? " pour " + a : "") + " ne donne aucun niveau de danger aujourd'hui."; }],
    [/^📂 Or open a saved tour \((\d+)\)$/, "📂 Ou ouvrir une sortie enregistrée ($1)"],
    [/^Delete "(.+)"\?$/, "Supprimer « $1 »?"],
    [/^Leg (\d+) of (\d+) · (.+)$/, function (m, a, b, t) { return "Tronçon " + a + " sur " + b + " · " + tt(t); }],   // ski-route.js, a tour with stops
    [/^Near (?!me\b|you\b|the\b)([^:.!?()]{1,40})$/, "Près de $1"],   // the Area box: "Near Cumberland"
    [/^(\d+) (minute|minutes|hour|hours|day|days|week|weeks|month|months|year|years) ago$/, function (m, n, u) { return "il y a " + n + " " + UNIT[u]; }],
    [/^Stocked (\d+) (day|days|week|weeks|month|months|year|years) ago, (.+)$/, function (m, n, u, f) { return "Ensemencé il y a " + n + " " + UNIT[u] + ", " + f; }],
    [/^just now$/i, "à l'instant"],
    [/^Was called (.+)$/, "Autrefois appelé $1"],
    [/^Photos on (.+) ↗$/, "Photos sur $1 ↗"],
    [/^Satellite photo of (.+)$/, function (m, d) { return "Photo satellite du " + dt(d); }],
    [/^✓ Saved: (.+)$/, "✓ Enregistré : $1"],
    [/^⚠ Saved: (.+)$/, "⚠ Enregistré : $1"],
    [/^Biggest square allowed \((?:about )?(.+) of map\)$/, function (m, n) { return "Le plus grand carré permis (" + (/^\d/.test(n) ? "environ " : "") + n.replace("under 1 MB", "moins de 1 Mo").replace(" MB", " Mo").replace(" GB", " Go") + " de carte)"; }],
    [/^1 saved area · save another for no signal$/, "1 zone enregistrée · en enregistrer une autre pour sans réseau"],
    [/^(\d+) saved areas · save another for no signal$/, "$1 zones enregistrées · en enregistrer une autre pour sans réseau"],
    [/^([\d.,]+) km long$/, "$1 km de long"],
    [/^Winter route · ([\d.,]+) km long$/, "Itinéraire d'hiver · $1 km de long"],
    [/^within ([\d.,]+ k?m)$/, "à moins de $1"],
    [/^(\d+) more$/, "$1 de plus"],
    [/^and (\d+) more \(🚧 layer\)$/, "et $1 de plus (couche 🚧)"],
    [/^(\d+) closures or warnings$/, "$1 fermetures ou avertissements"],
    [/^(\d+) open now$/, "$1 ouvertes maintenant"],
    [/^(\d+) tags$/, "$1 permis"],
    [/^(\d+) nearby$/, "$1 à proximité"],
    [/^(\d+) map points$/, "$1 points sur la carte"],
    [/^(\d+) map segments$/, "$1 segments sur la carte"],
    [/^(\d) out of 5$/, "$1 sur 5"],
    [/^Bite today (\d)\/5$/, "Activité aujourd'hui $1/5"],
    [/^All tags \((\d+)\)$/, "Toutes les étiquettes ($1)"],
    [/^(\S+) (Green|Blue|Black|Double black|Pro line) to (\S+) (Green|Blue|Black|Double black|Pro line)$/, function (m, a, x, b, y) { return a + " " + tw(x) + " à " + b + " " + tw(y); }],
    [/^Est\. (green|blue|black|double black)\?$/, function (m, c) { return "Est. " + { green: "vert", blue: "bleu", black: "noir", "double black": "double noir" }[c] + "?"; }],
    [/^(.+): tap to zoom in$/, "$1 : touchez pour zoomer"],
    [/^Sport: (.+) \(tap to change\)$/, function (m, s) { return "Sport : " + tw(s) + " (touchez pour changer)"; }],
    [/^Sport: (.+)\. Change sport$/, function (m, s) { return "Sport : " + tw(s) + ". Changer de sport"; }],
    [/^Wildfire ([\d.,]+ km) away \((.+)\)$/, function (m, d, s) { return "Feu de forêt à " + d + " (" + tw(s) + ")"; }],
    [/^From the ([NSEW]{1,3}), (\d+) km\/h$/, function (m, d, n) { return "Du " + d.replace(/W/g, "O") + ", " + n + " km/h"; }],
    [/^Feels (-?\d+)°$/, "Ressenti $1°"],
    [/^Elevation profile: from (.+) to (.+) over (.+)$/, "Profil d'altitude : de $1 à $2 sur $3"],
    [/^Route from where you are to the top of the trail \((.+)\), in Google Maps\.$/, "Trajet de votre position au haut du sentier ($1), dans Google Maps."],
    [/^([\d.,]+ k?m) from the trail$/, "$1 du sentier"],
    [/^([\d.,]+ k?m) from$/, "à $1 de"],
    [/^Burned in (\d{4})$/, "Brûlé en $1"],
    [/^Town or city: (.+)$/, "Ville ou village : $1"],
    [/^No shooting: (.+)$/, "Tir interdit : $1"],
    [/^Draw only: (.+)$/, "Tirage seulement : $1"],
    [/^Open now: (.+)$/, function (m, l) { return "Ouvert maintenant : " + tl(l); }],
    [/^Land: Crown land \((.+)\)$/, "Terre : terre publique ($1)"],
    [/^Land: (.+)$/, function (m, l) { return "Terre : " + tt(l); }],
    [/^Hatch chart: (.+)$/, "Éclosions : $1"],
    [/^(\d+) new trails? from the last (.+), newest first\.(.*)$/, function (m, n, p, rest) { return n + " nouveaux sentiers des derniers " + p.replace(/months?/, "mois").replace(/years?/, "ans").replace(/weeks?/, "semaines") + ", les plus récents d'abord." + rest; }],
    [/^Freezing level now about ([\d,\s]+ m), up to ([\d,\s]+ m) in the next day\.$/, "Isotherme 0 °C vers $1 en ce moment, jusqu'à $2 d'ici demain."],
    [/^Avalanche weather at ([\d,\s]+ m)$/, "Météo avalanche à $1"],
    [/^No warning signs in the weather at ([\d,\s]+ m) \(check the forecast anyway\)\.$/, "Aucun signe d'alerte dans la météo à $1 (vérifiez quand même le bulletin)."],
    [/^([\d,\s]+ m), ([\d.,]+ km) away$/, "$1, à $2"],
    [/^([\d,\s]+) m above sea level$/, "$1 m d'altitude"],
    [/^Updated (\d+) (minute|minutes|hour|hours) ago$/, function (m, n, u) { return "Mis à jour il y a " + n + " " + UNIT[u]; }],
    [/^Signed in as (.+)$/, "Connecté en tant que $1"],
    [/^All of (.+)$/, "Tout : $1"],
    [/^Show all (\d+)$/, "Tout afficher ($1)"],
    [/^Show all (\d+) (ski tours|Nordic trails|snowshoe routes|snowmobile trails)$/, function (m, n, k) { return "Afficher les " + n + " " + ({ "ski tours": "sorties de ski", "Nordic trails": "pistes de ski de fond", "snowshoe routes": "itinéraires de raquette", "snowmobile trails": "sentiers de motoneige" })[k]; }],
    [/^Only (\d+|none) of the (\d+) .+ here (?:is|are) mapped as (Simple|Challenging or easier|Complex or easier) terrain\.$/, function (m, a, n, c) { return (a === "none" ? "Aucune" : "Seulement " + a) + " sur " + n + " ici en terrain " + ({ Simple: "simple", "Challenging or easier": "exigeant ou plus facile", "Complex or easier": "complexe ou plus facile" })[c] + "."; }],
    [/^None within (\d+) km, so these go out to (\d+) km\.$/, "Aucune à moins de $1 km : la liste va jusqu'à $2 km."],
    [/^(\d+) (ski tours?|Nordic trails?|snowshoe routes?|snowmobile trails?) (?:around|near) (.+)$/, function (m, n, k, w) { return n + " " + ({ "ski tours": "sorties de ski", "Nordic trails": "pistes de ski de fond", "snowshoe routes": "itinéraires de raquette", "snowmobile trails": "sentiers de motoneige", "ski tour": "sortie de ski", "Nordic trail": "piste de ski de fond", "snowshoe route": "itinéraire de raquette", "snowmobile trail": "sentier de motoneige" })[k] + " près de " + (w === "you" ? "vous" : w); }],
    [/^Trails within (\d+) km of where you are$/, "Sentiers à moins de $1 km de vous"],
    [/^Looking for (.+)…$/, "Recherche de $1…"],
    [/^(\d+) areas$/, "$1 secteurs"],
    [/^Press Find new trails to see trails in (.+)\.$/, "Appuyez sur Trouver de nouveaux sentiers pour voir les sentiers de $1."],
    [/^(Skills or jump park|Bike park|Lift-served bike park|Bike park, likely lift-served|Pump track|BMX track|MTB centre): (.+)$/, function (m, k, n) { return ({ "Bike park, likely lift-served": "Parc de vélo, probablement avec remontée" })[k] ? "Parc de vélo, probablement avec remontée : " + n : tw(k) + " : " + n; }],
    [/^in an MTB trail network \(near (.+) and (.+)\)$/, "dans un réseau de vélo de montagne (près de $1 et $2)"],
    [/^bike park trail run by (.+)$/, "sentier de parc de vélo géré par $1"],
    [/^run by (.+)$/, "géré par $1"],
    [/^listed by (.+) as “(.+)”, with bikes allowed$/, "listé par $1 sous « $2 », vélos permis"],
    [/^listed by (.+) as “(.+)”$/, "listé par $1 sous « $2 »"],
    [/^Rated “(.+)” by (.+) \((.+)\)\.$/, function (m, r, b, n) { return "Coté « " + tw(r) + " » par " + b + " (" + n + ")."; }],
    [/^Rated (.+) by the (.+) map \((\d{4})\)\. It has no rating on OpenStreetMap yet\.$/, function (m, r, b, y) { return "Coté " + tw(r).toLowerCase() + " selon la carte " + b + " (" + y + "). Pas encore de cote sur OpenStreetMap."; }],
    [/^Part of MTB route “(.+)”$/, "Fait partie de l'itinéraire de vélo « $1 »"],
    [/^Slackcountry at (.+)$/, "Slackcountry à $1"],
    [/^Freeride lines here \((\d+)\)$/, "Lignes freeride ici ($1)"],
    [/^In the ski area \((\d+)\)$/, "Dans la station ($1)"],
    [/^Backcountry: no ski patrol \((\d+)\)$/, "Hors-piste : pas de patrouille ($1)"],
    [/^Issued (.+), for the middle of the map\.$/, "Publié le $1, pour le centre de la carte."],
    [/^Avalanche: (.+)$/, function (m, a) { return "Avalanche : " + tw(a); }],
    [/^Seasons in (.+)$/, "Saisons en $1"],
    [/^Limited entry hunts in (.+): (\d+) · best odds (.+)$/, "Chasses à tirage en $1 : $2 · meilleures chances $3"],
    [/^Limited entry zone: (.+)$/, "Zone à tirage : $1"],
    [/^Harvest in (.+): (.+) success$/, "Récolte en $1 : succès $2"],
    [/^(\d+) in view\. Green: good flow, light green: low, orange: very low or high, red: blown out, grey: no reading\. Tap one for more$/, "$1 à l'écran. Vert : bon débit, vert pâle : bas, orange : très bas ou haut, rouge : en crue, gris : pas de lecture. Touchez-en un pour plus"],
    [/^([\d.,]+ km) · (boat launch|fishing spot), (.+)$/, function (m, d, k, r) { return d + " · " + (k === "boat launch" ? "mise à l'eau" : "endroit de pêche") + ", " + r; }],
    [/^Search started (.+?): (\d+) map squares\.(.*)$/, function (m, d, n, r) { return "Recherche lancée " + d + " : " + n + " carrés de carte." + r; }],
    [new RegExp("^(.+?): (?:(.+?), )?(" + MONRE + " \\d.*)$"), function (m, w, a, d) { return tt(w) + " : " + (a ? tt(a) + ", " : "") + dt(d); }],
    [new RegExp("^" + MONRE + " \\d.*(?: to | - )" + MONRE + " \\d.*$"), function (m) { return dt(m); }],
    [/^(\d+) a day$/, "$1 par jour"],
    [/^(\d+) in all$/, "$1 en tout"],
    [/^(\d+) (?:cm|mm) or more$/, function (m) { return m.replace("or more", "ou plus"); }],
    [/^(.+): (\d+ (?:a day|in all).*)$/, function (m, sp, r) { return tt(sp) + " : " + r.replace(/ a day/, " par jour").replace(/ to /g, " à ").replace(/ in all/, " en tout").replace(/ or more/, " ou plus"); }],
    [/^(\d) of 5$/, "$1 sur 5"],
    [/^This water follows the rules of Zone (.+)\.$/, "Ce plan d'eau suit les règles de la zone $1."],
    [/^From Quebec's fishing regulations \((.+)\)\.$/, "Selon les règlements de pêche du Québec ($1)."],
    [/^From (.+)'s fishing regulations \((.+)\)\.$/, "Selon les règlements de pêche ($1, $2)."],
    [/^gauge (.+)$/, "station $1"],
    [/^zone (.+) map \(PDF\)$/, "carte de la zone $1 (PDF)"],
    [/^Nothing stocked or with a river reading within (\d+ km)\. Move the map or zoom in\.$/, "Rien d'ensemencé ni de station de débit à moins de $1. Déplacez la carte ou zoomez."],
    [/^No new trails here in the last (.+)\. Try a longer time or another area\.$/, function (m, p) { return "Aucun nouveau sentier ici dans les derniers " + p.replace(/months?/, "mois").replace(/years?/, "ans").replace(/weeks?/, "semaines") + ". Essayez une période plus longue ou une autre zone."; }],
    [/^Your scent drifts ([NSEW]{1,3}) \(the orange cone\)\. Approach from the ([NSEW]{1,3}), into the wind\.$/, function (m, a, b) { return "Votre odeur dérive vers le " + a.replace(/W/g, "O") + " (le cône orange). Approchez par le " + b.replace(/W/g, "O") + ", face au vent."; }],
    [/^Below treeline here \(below ~(.+)\)\.$/, "Sous la limite des arbres ici (sous ~$1)."],
    [/^Treeline here \((.+)\)\.$/, "Limite des arbres ici ($1)."],
    [/^Alpine here \(above ~(.+)\)\.$/, "Alpin ici (au-dessus de ~$1)."],
    [/^(\d+) mm of rain in 24 h$/, "$1 mm de pluie en 24 h"],
    [/^Nearest gas ([\d.,]+ km) away\. A tank takes you about (\d+ km) with 20% left\.$/, "Essence la plus proche à $1. Un plein vous mène à environ $2 avec 20 % restant."],
    [/^Couldn't load the weather: (.+)$/, "Impossible de charger la météo : $1"],
    [/^Couldn't load the weather \((.+)\)\.$/, "Impossible de charger la météo ($1)."],
    [/^(\d+) report(?:s)? this week$/, function (m, n) { return n + (n === "1" ? " rapport cette semaine" : " rapports cette semaine"); }],
    [/^latest: (.+)$/, function (m, r) { return "dernier : " + r.replace(/ on /, " sur ").replace(/\((\d+) days? ago\)/, "(il y a $1 j)"); }],
    [/^(Legal light is half an hour before sunrise .+ a traditional guide\.) (.+)$/, function (m, a, b) { return tt(a + " Times on this device's clock.").replace(/ Heures selon l'horloge de cet appareil\.$/, "") + " " + (/^Local time at the spot \((.+)\)\.$/.test(b) ? b.replace(/^Local time at the spot \((.+)\)\.$/, "Heure locale à l'endroit ($1).") : tt(b)); }],
    [/^minor (.+)$/, function (m, t) { return "mineure " + t.replace(/ to /g, " à "); }],
    [/^((?:[A-Z][a-z]+(?: [a-z]+)*)(?: \([^)]*\))?, (?:[A-Z][a-z]+(?: [a-z]+)*(?: \([^)]*\))?, )*[A-Z][a-z]+(?: [a-z]+)* \+\d+(?: more)?)$/, function (m) { return tl(m); }],
    [/^Quebec zone (.+)$/, "Québec zone $1"],
    [/^([NSEW]{1,3}) (\d+)$/, function (m, d, n) { return d.replace(/W/g, "O") + " " + n; }],
    [/^The nearest is (.+), (\d+) km away(?: \((low|moderate|considerable|high|extreme) at its worst today\))?: snow and danger can be very different here\.$/, function (m, n, k, r) {
      var RD = { low: "faible", moderate: "modéré", considerable: "considérable", high: "élevé", extreme: "extrême" };
      return "La plus proche est " + n + ", à " + k + " km" + (r ? " (" + RD[r] + " au pire aujourd'hui)" : "") + " : la neige et le danger peuvent être très différents ici.";
    }],
    [/^(\d+) rider reports? within 40 km in the last (\d+) days(?:, (\d+) with avalanches)?\.$/, function (m, n, d, a) {
      return n + " observation" + (n === "1" ? "" : "s") + " d'usagers à moins de 40 km ces " + d + " derniers jours" + (a ? ", dont " + a + " avec avalanches" : "") + ".";
    }],
    [/^No rider reports within 40 km in the last (\d+) days\.$/, "Aucune observation d'usagers à moins de 40 km ces $1 derniers jours."],
    // Trail name search (index.html refreshHits): the Area picked first, elsewhere only when nothing matched there.
    [/^Nothing named “(.+)” in (.+?)( yet)?\. Found elsewhere in Canada:$/, function (m, q, z, y) { return "Rien nommé « " + q + " » dans " + tt(z) + (y ? " pour l'instant" : "") + ". Trouvé ailleurs au Canada :"; }],
    [/^Nothing named “(.+)” in (.+)\. Found in other areas:$/, function (m, q, z) { return "Rien nommé « " + q + " » dans " + tt(z) + ". Trouvé dans d'autres secteurs :"; }],
    [/^(More trails|Trails) in (.+)$/, function (m, w, z) { return (w === "Trails" ? "Sentiers" : "Autres sentiers") + " dans " + tt(z); }],
    // The status after Forest roads and Wildfires in Layers (index.html layerStatsNow).
    [/^([\d.]+) km (impassable|closed|very rough|rough|good)$/, function (m, n, w) { return n.replace(".", ",") + " km " + { impassable: "impraticables", closed: "fermés", "very rough": "très abîmés", rough: "abîmés", good: "en bon état" }[w]; }],
    [/^(\d+) (out of control|being held|under control|burning)$/, function (m, n, w) { return n + " " + { "out of control": "hors de contrôle", "being held": "contenu" + (n > 1 ? "s" : ""), "under control": "maîtrisé" + (n > 1 ? "s" : ""), burning: "en feu" }[w]; }],
    [/^within (\d+) km$/, "dans un rayon de $1 km"],
    [/^No active fires within (\d+) km$/, "Aucun feu actif dans un rayon de $1 km"],
    // Skiing Safest way, "Why this way": time exposed and how it's weighed (ski-route.js, winter.js safeHtml)
    [/^About (.+) exposed$/, "Environ $1 exposé"],
    [/^of (.+) on the move: (.+)\. Time on or under a slope that could slide is what it keeps short\.$/, function (m, t, rest) { return "sur " + t + " en mouvement : " + rest.replace(/ on 30°\+ slopes/, " sur des pentes de 30°+").replace(/ under steep slopes/, " sous des pentes raides") + ". Le temps passé sur ou sous une pente qui peut partir, c'est ce qu'il garde court."; }],
    [/^in (.+) on the move: no 30°\+ slopes and nothing steep above, as far as the terrain map can see\.$/, "sur $1 en mouvement : aucune pente de 30°+ et rien de raide au-dessus, d'après le modèle de terrain."],
    [/^How it weighs it today, on skins: 1 min on a 30-35° slope counts like (\d+) min on gentle ground, 35-40° like (\d+) min \((\d+) min sidehilling across it\), under a steep slope like (\d+) min\. So it drops to flatter ground, crosses and climbs back when that's less time exposed, even if it's longer\.$/,
      "Comment il pèse le temps aujourd'hui, en peaux : 1 min sur une pente de 30-35° compte comme $1 min en terrain doux, 35-40° comme $2 min ($3 min en traversée à flanc), sous une pente raide comme $4 min. Il descend donc vers du terrain plus plat, traverse et remonte quand on y est moins longtemps exposé, même si c'est plus long."],
    [/^Leaves the usual skin track \((.+)\) before its crux: that track sidehills (.+) on 30°\+ slopes, about (.+) exposed\. This way: (.+?), about (.+?)(?:, for about (.+) more on the move)?\.$/,
      function (m, n, a, b, c, d, e) { return "Quitte la trace habituelle (" + n + ") avant son passage clé : cette trace traverse à flanc " + a + " de pentes de 30°+, environ " + b + " d'exposition. Par ici : " + (c === "none" ? "aucun" : c) + ", environ " + d + (e ? ", pour environ " + e + " de plus en mouvement" : "") + "."; }],
    [/^Today's weather \(at (.+?)\) shows no new snow, wind loading, rain or warming to add\.$/, "La météo du jour (à $1) n'ajoute ni neige fraîche, ni transport par le vent, ni pluie, ni réchauffement."],
    [/^Today's weather is in it too \(at (.+?)\): (.+)\.$/, function (m, at, rest) {
      return "La météo du jour compte aussi (à " + at + ") : " + rest
        .replace(/(\d+) cm of new snow in the last day, (\d+) cm in 3 days: every slope counts ([\d.]+)x/, "$1 cm de neige fraîche en 24 h, $2 cm en 3 jours : chaque pente compte $3x")
        .replace(/wind up to (\d+) km\/h with snow to move: (.+?)-facing slopes in the alpine and at treeline count 1\.5x \(wind slabs\)/, function (m2, w, a) { return "vent jusqu'à " + w + " km/h avec de la neige à transporter : pentes orientées " + a.replace(/northeast/g, "nord-est").replace(/northwest/g, "nord-ouest").replace(/southeast/g, "sud-est").replace(/southwest/g, "sud-ouest").replace(/north/g, "nord").replace(/south/g, "sud").replace(/east/g, "est").replace(/west/g, "ouest") + " en alpin et à la limite des arbres : 1,5x (plaques à vent)"; })
        .replace(/rain on snow up to about (.+?): 1\.5x below that/, "pluie sur neige jusqu'à environ $1 : 1,5x en dessous")
        .replace(/warming to (-?\d+)°C at (.+?): sunny slopes count up to 1\.4x/, "réchauffement jusqu'à $1 °C à $2 : pentes ensoleillées jusqu'à 1,4x") + ".";
    }],
  ];
