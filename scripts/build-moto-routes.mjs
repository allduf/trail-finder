// Builds data/moto-routes.json: curated Canadian adventure / dual-sport routes.
// Each route is traced on real roads with the public Valhalla router (OSM data),
// dirt % comes from the OSM surface of every edge, and fuel gaps from OSM
// amenity=fuel found along the line (Nominatim). Run: node scripts/build-moto-routes.mjs
// Grade 1-5 = hardest section you cannot avoid (1 paved, 2 good gravel, 3 rough or
// steep gravel, 4 rough 4x4 road / washouts, 5 technical). bikes = biggest class
// that still fits: big (1000 cc+ ADV), mid (650-900 cc), light (under 500 cc).
import fs from 'node:fs';

const W = 'https://en.wikipedia.org/wiki/';
const R = [
  // ---------- British Columbia ----------
  { id: 'bc-hurley', n: 'Hurley FSR (Pemberton to Gold Bridge)', prov: 'BC', grade: 3, bikes: 'big', season: [6, 7, 8, 9, 10],
    wp: [[50.3220, -122.8030], [50.5597, -123.0254], [50.6033, -123.0233], [50.8530, -122.8400]],
    notes: 'Washboard and potholes, steep switchbacks near the summit; snow until June; logging trucks on weekdays.', src: W + 'Hurley_River' },
  { id: 'bc-carpenter-lake', n: 'Carpenter Lake Road (Lillooet to Gold Bridge)', prov: 'BC', grade: 2, bikes: 'big', season: [5, 6, 7, 8, 9, 10],
    wp: [[50.6866, -121.9366], [50.8502, -122.4930], [50.8530, -122.8400]],
    notes: 'Narrow canyon road with drop-offs and rockfall; pairs with the Hurley for a loop.', src: W + 'Carpenter_Lake' },
  { id: 'bc-duffey', n: 'Duffey Lake Road (Hwy 99, Pemberton to Lillooet)', prov: 'BC', grade: 1, bikes: 'big', season: [4, 5, 6, 7, 8, 9, 10],
    wp: [[50.3180, -122.7200], [50.4000, -122.3800], [50.6866, -121.9366]],
    notes: 'Paved, 13% grades and tight hairpins; frequent winter closures.', src: W + 'British_Columbia_Highway_99' },
  { id: 'bc-harrison-west', n: 'Harrison West and In-SHUCK-ch FSR (Harrison Mills to Mount Currie)', prov: 'BC', grade: 3, bikes: 'mid', season: [6, 7, 8, 9, 10],
    wp: [[49.2400, -121.9500], [49.5000, -122.0800], [49.7700, -122.1600], [50.0074, -122.5073], [50.1298, -122.5147], [50.3180, -122.7200]],
    notes: 'Remote logging roads along Harrison and Lillooet lakes; washouts after rain, no services between ends.', src: W + 'Harrison_Lake' },
  { id: 'bc-west-side-fraser', n: 'West Side Road (Lillooet to Lytton)', prov: 'BC', grade: 3, bikes: 'mid', season: [5, 6, 7, 8, 9, 10],
    wp: [[50.6866, -121.9366], [50.5766, -121.8431], [50.4498, -121.6999], [50.2350, -121.5900]],
    notes: 'Narrow gravel above the Fraser; ends at the Lytton reaction ferry (free, check it is running).', src: W + 'Lytton_Ferry' },
  { id: 'bc-dog-creek', n: 'Dog Creek Road (Williams Lake to Clinton)', prov: 'BC', grade: 2, bikes: 'big', season: [5, 6, 7, 8, 9, 10],
    wp: [[52.1300, -122.1400], [51.7900, -122.2300], [51.5900, -122.2500], [51.2500, -121.9600], [51.0900, -121.5900]],
    notes: 'Fraser grasslands gravel through Alkali Lake, Dog Creek and Jesmond; clay is slick when wet.', src: W + 'Dog_Creek,_British_Columbia' },
  { id: 'bc-farwell-big-creek', n: 'Farwell Canyon and Big Creek loop', prov: 'BC', grade: 2, bikes: 'big', season: [5, 6, 7, 8, 9, 10],
    wp: [[51.9700, -122.5300], [51.8262, -122.5605], [51.7223, -123.0417], [51.9200, -122.9300]],
    notes: 'Hoodoos and sand dunes in the canyon; steep loose descent to the Chilcotin River bridge.', src: W + 'Farwell_Canyon' },
  { id: 'bc-bella-coola', n: 'Freedom Highway (Hwy 20, Williams Lake to Bella Coola)', prov: 'BC', grade: 3, bikes: 'big', season: [5, 6, 7, 8, 9, 10],
    wp: [[52.1300, -122.1400], [52.4700, -125.3100], [52.5300, -125.8500], [52.3700, -126.7500]],
    notes: 'The Hill: 18% gravel grades and hairpins with no guardrails; ferry from Bella Coola to Port Hardy in summer.', src: W + 'British_Columbia_Highway_20' },
  { id: 'bc-likely-barkerville', n: 'Likely to Barkerville backroad', prov: 'BC', grade: 3, bikes: 'mid', season: [6, 7, 8, 9],
    wp: [[52.6170, -121.5600], [52.7545, -121.4146], [52.8046, -121.2798], [53.0700, -121.5150]],
    notes: 'Cariboo gold-rush logging roads; signage is poor, carry a map.', src: W + 'Likely,_British_Columbia' },
  { id: 'bc-lardeau-trout-lake', n: 'Hwy 31 Lardeau and Trout Lake (Kaslo to Revelstoke)', prov: 'BC', grade: 2, bikes: 'big', season: [5, 6, 7, 8, 9, 10],
    wp: [[49.9100, -116.9100], [50.2400, -116.9800], [50.4000, -117.1200], [50.6400, -117.5300], [50.6500, -117.8600], [50.6300, -117.9300], [50.9980, -118.1960]],
    notes: 'Gravel north of Gerrard; free Upper Arrow Lake ferry Galena Bay to Shelter Bay.', src: W + 'British_Columbia_Highway_31' },
  { id: 'bc-kootenay-ferries', n: 'Kootenay inland ferries (Creston to Revelstoke)', prov: 'BC', grade: 1, bikes: 'big', season: [4, 5, 6, 7, 8, 9, 10],
    wp: [[49.1000, -116.5100], [49.6760, -116.8700], [49.6250, -116.9600], [49.9100, -116.9100], [49.9900, -117.3700], [50.2400, -117.8000], [50.6500, -117.8600], [50.9980, -118.1960]],
    notes: 'Paved; two free ferries (Kootenay Lake, Upper Arrow Lake), sailings fill on summer weekends.', src: W + 'Kootenay_Lake_Ferry' },
  { id: 'bc-cassiar', n: 'Stewart-Cassiar Highway (Hwy 37)', prov: 'BC', grade: 2, bikes: 'big', season: [5, 6, 7, 8, 9],
    wp: [[55.1070, -128.0300], [56.1000, -129.3000], [58.4400, -130.0000], [60.0000, -128.9900]],
    notes: 'Mostly paved with gravel patches and no shoulders; bears and long fuel gaps, fill at every stop.', src: W + 'British_Columbia_Highway_37' },
  { id: 'bc-salmon-glacier', n: 'Stewart, Hyder and Salmon Glacier road', prov: 'BC', grade: 3, bikes: 'mid', season: [6, 7, 8, 9],
    wp: [[56.0970, -129.3000], [55.9400, -129.9900], [55.9150, -130.0200], [56.1270, -130.0700]],
    notes: 'Gravel past Hyder (Alaska, no US check going in, Canada customs on return); snow at the summit into July.', src: W + 'Salmon_Glacier' },
  { id: 'bc-telegraph-creek', n: 'Telegraph Creek Road', prov: 'BC', grade: 3, bikes: 'mid', season: [6, 7, 8, 9],
    wp: [[58.4400, -130.0100], [57.9100, -131.1650]],
    notes: '20% gravel grades on a narrow lava ridge above the Stikine; fire-damaged area, ask in Dease Lake first.', src: W + 'Telegraph_Creek' },
  { id: 'bc-atlin', n: 'Atlin Road (Jake\'s Corner to Atlin)', prov: 'BC', grade: 2, bikes: 'big', season: [5, 6, 7, 8, 9],
    wp: [[60.3300, -133.9900], [59.5780, -133.6900]],
    notes: 'Mostly paved now with gravel patches; dead end at Atlin, fuel there is limited hours.', src: W + 'Atlin,_British_Columbia' },
  { id: 'bc-bamfield', n: 'Bamfield Road (Port Alberni to Bamfield)', prov: 'BC', grade: 2, bikes: 'big', season: [4, 5, 6, 7, 8, 9, 10],
    wp: [[49.2340, -124.8050], [49.0181, -124.8165], [48.8330, -125.1400]],
    notes: 'Logging mainline being chip-sealed in sections; expect gravel, construction and trucks.', src: W + 'Bamfield' },
  { id: 'bc-tahsis', n: 'Head Bay Road (Gold River to Tahsis)', prov: 'BC', grade: 3, bikes: 'mid', season: [5, 6, 7, 8, 9, 10],
    wp: [[49.7800, -126.0500], [49.9170, -126.6600]],
    notes: 'Steep, narrow logging road to the west coast; potholes and loose rock.', src: W + 'Tahsis' },
  { id: 'bc-cape-scott', n: 'Holberg Road to San Josef Bay', prov: 'BC', grade: 2, bikes: 'big', season: [5, 6, 7, 8, 9, 10],
    wp: [[50.7200, -127.4900], [50.7063, -127.9015], [50.6550, -128.0200], [50.6650, -128.2700]],
    notes: 'Logging mainline to Cape Scott park; check WFP road hours, no fuel past Port Hardy.', src: W + 'Holberg,_British_Columbia' },
  { id: 'bc-princeton-summerland', n: 'Princeton-Summerland Road', prov: 'BC', grade: 2, bikes: 'big', season: [5, 6, 7, 8, 9, 10],
    wp: [[49.4590, -120.5060], [49.7100, -120.2000], [49.6087, -119.7707], [49.6000, -119.6800]],
    notes: 'Gravel past Osprey Lake, cattle on the road; good link from the Similkameen to the Okanagan.', src: W + 'Summerland,_British_Columbia' },
  { id: 'bc-coalmont-brookmere', n: 'Coalmont, Tulameen and Brookmere', prov: 'BC', grade: 2, bikes: 'big', season: [5, 6, 7, 8, 9, 10],
    wp: [[49.4590, -120.5060], [49.5305, -120.7140], [49.5460, -120.7600], [49.7386, -120.7563], [49.8200, -120.8750], [50.1100, -120.7900]],
    notes: 'Old mining towns, gravel from Tulameen to Brookmere; dusty in August.', src: W + 'Tulameen' },
  { id: 'bc-flathead', n: 'Flathead FSR (Morrissey to the Flathead Valley)', prov: 'BC', grade: 3, bikes: 'mid', season: [6, 7, 8, 9, 10],
    wp: [[49.4300, -115.0400], [49.2091, -114.5329], [49.0700, -114.5300]],
    notes: 'Dead end near the closed Montana border; grizzly country, no services.', src: W + 'Flathead_River' },

  // ---------- Alberta ----------
  { id: 'ab-ftr-south', n: 'Forestry Trunk Road South (Coleman to Highwood)', prov: 'AB', grade: 2, bikes: 'big', season: [5, 6, 7, 8, 9, 10],
    wp: [[49.6700, -114.4900], [50.0000, -114.4500], [50.3900, -114.6200], [50.5450, -114.6600]],
    notes: '99 km of gravel through the Livingstone range; no fuel, wind is strong.', src: W + 'Alberta_Highway_734' },
  { id: 'ab-hwy734', n: 'Forestry Trunk Road (Hwy 734, Sundre to Nordegg)', prov: 'AB', grade: 2, bikes: 'big', season: [5, 6, 7, 8, 9, 10],
    wp: [[51.6000, -114.9000], [51.8000, -115.0500], [52.0700, -115.4000], [52.4700, -116.0700]],
    notes: 'Gravel past Ram Falls; random camping on Crown land needs a Public Lands Camping Pass.', src: W + 'Alberta_Highway_734' },
  { id: 'ab-ftr-north', n: 'Forestry Trunk Road North (Hwy 40 to Hwy 43)', prov: 'AB', grade: 2, bikes: 'big', season: [5, 6, 7, 8, 9, 10],
    wp: [[54.1095, -118.5335], [54.7065, -118.2543], [55.1900, -118.2000]],
    notes: 'Remote industrial gravel with fast trucks; no fuel for the whole section.', src: W + 'Alberta_Highway_734' },
  { id: 'ab-smith-dorrien', n: 'Smith-Dorrien Spray Trail (Canmore to Kananaskis Lakes)', prov: 'AB', grade: 2, bikes: 'big', season: [5, 6, 7, 8, 9, 10],
    wp: [[51.0900, -115.3600], [50.9383, -115.3175], [50.7700, -115.1500]],
    notes: 'Gravel through Kananaskis; Kananaskis Conservation Pass needed to park, wildlife on the road.', src: W + 'Kananaskis_Country' },
  { id: 'ab-ya-ha-tinda', n: 'Ya Ha Tinda road (Sundre to the Red Deer River)', prov: 'AB', grade: 2, bikes: 'big', season: [6, 7, 8, 9, 10],
    wp: [[51.8000, -114.6400], [51.7539, -115.5823]],
    notes: 'Gravel dead end to the Parks Canada horse ranch; elk herds, no services.', src: W + 'Ya_Ha_Tinda_Ranch' },

  // ---------- Saskatchewan ----------
  { id: 'sk-hwy955-cluff', n: 'Hwy 955 (La Loche to Cluff Lake)', prov: 'SK', grade: 3, bikes: 'mid', season: [6, 7, 8, 9],
    wp: [[56.4800, -109.4400], [58.3484, -109.5623]],
    notes: 'Sand and gravel to a closed uranium mine; no fuel or services past La Loche.', src: W + 'Saskatchewan_Highway_955' },
  { id: 'sk-hwy102-southend', n: 'Hwy 102 (La Ronge to Southend)', prov: 'SK', grade: 2, bikes: 'big', season: [5, 6, 7, 8, 9],
    wp: [[55.1000, -105.2900], [55.6000, -104.7700], [56.3293, -103.2387]],
    notes: 'Gravel north of Missinipe through boreal lakes; wildfire closures in summer.', src: W + 'Saskatchewan_Highway_102' },
  { id: 'sk-hwy905-points-north', n: 'Hwy 905 to Points North Landing', prov: 'SK', grade: 3, bikes: 'mid', season: [6, 7, 8, 9],
    wp: [[56.3293, -103.2387], [58.2689, -104.0800]],
    notes: 'Mine-traffic gravel to the end of the all-weather road; carry fuel and a satellite messenger.', src: W + 'Saskatchewan_Highway_905' },

  // ---------- Manitoba ----------
  { id: 'mb-pr280-gillam', n: 'PR 280 (Thompson to Gillam)', prov: 'MB', grade: 3, bikes: 'mid', season: [6, 7, 8, 9],
    wp: [[55.7400, -97.8600], [56.2500, -96.1000], [56.3500, -94.7100]],
    notes: 'Rough gravel with deep potholes after rain; fuel only at Split Lake and Gillam.', src: W + 'Manitoba_Provincial_Road_280' },
  { id: 'mb-pr391-lynn-lake', n: 'PR 391 (Thompson to Lynn Lake)', prov: 'MB', grade: 2, bikes: 'big', season: [5, 6, 7, 8, 9],
    wp: [[55.7400, -97.8600], [56.4700, -99.9800], [56.8500, -101.0500]],
    notes: 'Long boreal road with gravel sections; fuel at Leaf Rapids.', src: W + 'Manitoba_Provincial_Road_391' },
  { id: 'mb-nopiming', n: 'Nopiming PR 314 (Lac du Bonnet to Bissett)', prov: 'MB', grade: 2, bikes: 'big', season: [5, 6, 7, 8, 9, 10],
    wp: [[50.2500, -96.0600], [50.6233, -95.3144], [51.0300, -95.6800]],
    notes: 'Gravel through Canadian Shield lakes in Nopiming park; dusty and narrow.', src: W + 'Nopiming_Provincial_Park' },
  { id: 'mb-duck-mountain', n: 'Duck Mountain PR 366', prov: 'MB', grade: 2, bikes: 'big', season: [5, 6, 7, 8, 9, 10],
    wp: [[51.4000, -100.8000], [51.8269, -100.8860], [52.1000, -101.0000]],
    notes: 'Gravel over the Manitoba escarpment past Wellman and Childs lakes.', src: W + 'Duck_Mountain_Provincial_Park_(Manitoba)' },

  // ---------- Ontario ----------
  { id: 'on-hwy129', n: 'Hwy 129 "The Snake" (Thessalon to Chapleau)', prov: 'ON', grade: 1, bikes: 'big', season: [5, 6, 7, 8, 9, 10],
    wp: [[46.2600, -83.5600], [47.0000, -83.2500], [47.8400, -83.4000]],
    notes: 'Paved, twisty Mississagi River road; one fuel stop at Wharncliffe area is seasonal.', src: W + 'Ontario_Highway_129' },
  { id: 'on-sultan', n: 'Sultan Industrial Road (Hwy 144 to Hwy 129)', prov: 'ON', grade: 2, bikes: 'big', season: [5, 6, 7, 8, 9, 10],
    wp: [[47.6000, -81.9000], [47.4853, -82.0060], [47.8400, -83.4000]],
    notes: 'Long logging gravel with fast trucks and dust; no services.', src: 'https://northernontario.travel/motorcycle-touring/algoma-adv-tour' },
  { id: 'on-nipigon', n: 'Lake Nipigon west side (Hwy 527 to Gull Bay and Armstrong)', prov: 'ON', grade: 1, bikes: 'big', season: [5, 6, 7, 8, 9],
    wp: [[49.0100, -88.2600], [49.8040, -89.1077], [50.3021, -89.0374]],
    notes: 'Remote paved Hwy 527 with a short gravel spur to Gull Bay; gravel bush roads continue past Armstrong.', src: 'https://northernontario.travel/motorcycle-touring/5-adv-rides-i-need-do-season' },
  { id: 'on-hwy599', n: 'Hwy 599 (Ignace to Pickle Lake)', prov: 'ON', grade: 1, bikes: 'big', season: [5, 6, 7, 8, 9, 10],
    wp: [[49.4160, -91.6600], [50.2374, -90.7086], [51.4700, -90.1900]],
    notes: 'Paved but Ontario\'s most remote highway; fuel at Savant Lake only.', src: W + 'Ontario_Highway_599' },

  // ---------- Quebec ----------
  { id: 'qc-baie-james', n: 'Route de la Baie-James (Matagami to Radisson)', prov: 'QC', grade: 1, bikes: 'big', season: [5, 6, 7, 8, 9, 10],
    wp: [[49.7500, -77.6300], [51.0000, -77.4500], [53.7900, -77.6200]],
    notes: 'Paved; register at the km 6 stop; fuel only at km 381 Relais.', src: W + 'James_Bay_Road' },
  { id: 'qc-route-du-nord', n: 'Route du Nord (Chibougamau to Baie-James km 275)', prov: 'QC', grade: 2, bikes: 'big', season: [6, 7, 8, 9],
    wp: [[49.9200, -74.3700], [51.6900, -76.2400], [51.6000, -77.3800]],
    notes: 'Long gravel through Eeyou Istchee; fuel at Nemaska only.', src: W + 'Route_du_Nord' },
  { id: 'qc-trans-taiga', n: 'Route Transtaïga', prov: 'QC', grade: 3, bikes: 'mid', season: [6, 7, 8, 9],
    wp: [[53.4300, -77.4500], [53.7000, -73.5000], [54.4426, -70.5307]],
    notes: 'Remote gravel with sharp rock; one fuel stop at the Mirage outfitter, carry spare tubes and fuel.', src: W + 'Trans-Taiga_Road' },
  { id: 'qc-route-389', n: 'Route 389 (Baie-Comeau to Fermont)', prov: 'QC', grade: 2, bikes: 'big', season: [5, 6, 7, 8, 9, 10],
    wp: [[49.2200, -68.1500], [50.6400, -68.7300], [51.3260, -68.1221], [52.7900, -67.0800]],
    notes: 'Paved south, gravel near Fire Lake; mine trucks, fuel at Manic-5 and Relais Gabriel.', src: W + 'Quebec_Route_389' },
  { id: 'qc-route-167-nord', n: 'Route 167 Nord to the Otish Mountains', prov: 'QC', grade: 2, bikes: 'big', season: [6, 7, 8, 9],
    wp: [[49.9200, -74.3700], [50.4200, -73.8700], [52.0876, -72.1901], [52.8177, -72.1901]],
    notes: 'Gravel past Mistissini toward the Renard mine; public road but no services.', src: W + 'Quebec_Route_167' },
  { id: 'qc-route-299', n: 'Route 299 across the Chic-Chocs', prov: 'QC', grade: 1, bikes: 'big', season: [5, 6, 7, 8, 9, 10],
    wp: [[48.2000, -65.9500], [48.9500, -66.1500], [49.1250, -66.4900]],
    notes: 'Paved mountain crossing through Gaspésie park; moose at dusk, no fuel inside the park.', src: W + 'Quebec_Route_299' },
  { id: 'qc-route-138-kegaska', n: 'Route 138 to Kegaska (end of the road)', prov: 'QC', grade: 1, bikes: 'big', season: [5, 6, 7, 8, 9, 10],
    wp: [[50.2100, -66.3800], [50.2800, -63.6000], [50.1890, -61.2723]],
    notes: 'Paved Côte-Nord to the last village; continue by the Bella Desgagnés coastal ferry.', src: W + 'Quebec_Route_138' },

  // ---------- Atlantic ----------
  { id: 'nl-trans-labrador', n: 'Trans-Labrador Highway (Labrador City to Goose Bay)', prov: 'NL', grade: 1, bikes: 'big', season: [6, 7, 8, 9],
    wp: [[52.9400, -66.9100], [53.5300, -64.0000], [53.3000, -60.4200]],
    notes: 'Paved since 2022 but remote; free satellite phone loan program, fuel at Churchill Falls.', src: W + 'Trans-Labrador_Highway' },
  { id: 'nl-route-510', n: 'Trans-Labrador Route 510 (Goose Bay to Blanc-Sablon)', prov: 'NL', grade: 1, bikes: 'big', season: [6, 7, 8, 9],
    wp: [[53.3000, -60.4200], [52.5300, -56.3000], [51.7300, -56.4300], [51.4300, -57.1200]],
    notes: 'Longest fuel gap in Canada to Port Hope Simpson; ferry Blanc-Sablon to St. Barbe.', src: W + 'Trans-Labrador_Highway' },
  { id: 'nl-viking-trail', n: 'Viking Trail (Route 430, Deer Lake to St. Anthony)', prov: 'NL', grade: 1, bikes: 'big', season: [6, 7, 8, 9],
    wp: [[49.1700, -57.4300], [50.5000, -57.4000], [51.3600, -55.5800]],
    notes: 'Paved through Gros Morne; strong coastal wind and moose.', src: W + 'Newfoundland_and_Labrador_Route_430' },
  { id: 'ns-cabot-meat-cove', n: 'Cabot Trail and Meat Cove', prov: 'NS', grade: 2, bikes: 'big', season: [5, 6, 7, 8, 9, 10],
    wp: [[46.1000, -60.7500], [46.6400, -61.0100], [46.8000, -60.6500], [47.0261, -60.5592], [46.6500, -60.4000], [46.1000, -60.7500]],
    loop: true, notes: 'Paved loop with a gravel cliff-edge spur to Meat Cove; park pass needed in the highlands.', src: W + 'Cabot_Trail' },
  { id: 'nb-tobique', n: 'Tobique Valley and Mount Carleton (Route 385)', prov: 'NB', grade: 1, bikes: 'big', season: [5, 6, 7, 8, 9, 10],
    wp: [[46.9089, -67.3955], [47.1500, -67.0700], [47.4065, -66.8185], [47.5100, -67.3900]],
    notes: 'Quiet paved road into the Maritimes\' highest hills; no fuel between Plaster Rock and Saint-Quentin.', src: W + 'Mount_Carleton_Provincial_Park' },
  { id: 'pe-heritage-roads', n: 'PEI red clay Scenic Heritage Roads', prov: 'PE', grade: 2, bikes: 'mid', season: [6, 7, 8, 9],
    wp: [[46.1938, -62.6777], [46.3761, -62.2127], [46.4382, -62.2021]],
    notes: 'Short unpaved red clay lanes linked by quiet paved roads; greasy and rutted after rain.', src: 'https://www.tourismpei.com/pei-scenic-heritage-roads' },

  // ---------- Yukon ----------
  { id: 'yt-dempster', n: 'Dempster Highway (Klondike Hwy to Inuvik)', prov: 'YT', grade: 3, bikes: 'big', season: [6, 7, 8, 9],
    wp: [[64.0450, -138.6500], [66.3700, -136.7200], [67.4300, -134.8800], [68.3600, -133.7200]],
    notes: 'Shale gravel shreds tires; Peel and Mackenzie ferries (no crossing at freeze-up and break-up); fuel at Eagle Plains.', src: W + 'Dempster_Highway' },
  { id: 'nt-tuktoyaktuk', n: 'Inuvik-Tuktoyaktuk Highway (to the Arctic Ocean)', prov: 'NT', grade: 2, bikes: 'big', season: [6, 7, 8, 9],
    wp: [[68.3600, -133.7200], [69.4400, -133.0300]],
    notes: 'Gravel on permafrost, soft and muddy when wet; Tuk fuel is limited hours.', src: W + 'Inuvik–Tuktoyaktuk_Highway' },
  { id: 'yt-top-of-the-world', n: 'Top of the World Highway (Dawson to Alaska)', prov: 'YT', grade: 2, bikes: 'big', season: [5, 6, 7, 8, 9],
    wp: [[64.0600, -139.4300], [64.0850, -140.9900]],
    notes: 'George Black ferry from Dawson; border only open mid May to mid September, daytime.', src: W + 'Top_of_the_World_Highway' },
  { id: 'yt-south-canol', n: 'South Canol Road', prov: 'YT', grade: 3, bikes: 'mid', season: [6, 7, 8, 9],
    wp: [[60.4800, -133.2900], [61.2000, -132.9000], [61.9800, -132.4500]],
    notes: 'Narrow, winding single-lane gravel with old one-lane bridges; no services.', src: W + 'Canol_Road' },
  { id: 'yt-north-canol', n: 'North Canol Road (Ross River to Macmillan Pass)', prov: 'YT', grade: 4, bikes: 'light', season: [7, 8],
    wp: [[61.9800, -132.4500], [62.9000, -131.0000], [63.2514, -130.0220]],
    notes: 'Rough, washouts and creek fords; Ross River ferry, dead end at the NWT border.', src: W + 'Canol_Road' },
  { id: 'yt-campbell', n: 'Robert Campbell Highway (Watson Lake to Carmacks)', prov: 'YT', grade: 2, bikes: 'big', season: [5, 6, 7, 8, 9],
    wp: [[60.0600, -128.7100], [61.3000, -129.4000], [61.9800, -132.4500], [62.2300, -133.3800], [62.0900, -136.2900]],
    notes: 'Gravel most of the way; fuel at Ross River and Faro, check hours.', src: W + 'Robert_Campbell_Highway' },
  { id: 'yt-silver-trail', n: 'Silver Trail (Stewart Crossing to Keno City)', prov: 'YT', grade: 2, bikes: 'big', season: [5, 6, 7, 8, 9],
    wp: [[63.3700, -136.6800], [63.5900, -135.9000], [63.9100, -135.3000]],
    notes: 'Paved to Mayo then gravel; climb Keno Hill road for the view (rough).', src: W + 'Silver_Trail' },
  { id: 'yt-nahanni-range', n: 'Nahanni Range Road (to Tungsten)', prov: 'YT', grade: 4, bikes: 'light', season: [7, 8],
    wp: [[61.4000, -129.2000], [61.9681, -128.2311]],
    notes: 'Unmaintained past km 134 with washouts and overgrown bridges; no services, satellite messenger.', src: W + 'Nahanni_Range_Road' },

  // ---------- Northwest Territories ----------
  { id: 'nt-liard', n: 'Liard Trail (Hwy 77 and NWT 7)', prov: 'NT', grade: 3, bikes: 'mid', season: [6, 7, 8, 9],
    wp: [[58.8000, -122.6500], [60.2400, -123.4700], [61.3000, -121.3000]],
    notes: 'Gravel that turns to greasy clay in rain; fuel only in Fort Liard.', src: W + 'Northwest_Territories_Highway_7' },
  { id: 'nt-mackenzie-wrigley', n: 'Mackenzie Highway (Fort Simpson to Wrigley)', prov: 'NT', grade: 3, bikes: 'mid', season: [6, 7, 8, 9],
    wp: [[61.8600, -121.3500], [63.2277, -123.4654]],
    notes: 'Gravel along the Mackenzie with the Camsell Bend ferry; no fuel until Wrigley.', src: W + 'Mackenzie_Highway' },
  { id: 'nt-ingraham', n: 'Ingraham Trail (Yellowknife to Tibbitt Lake)', prov: 'NT', grade: 2, bikes: 'big', season: [6, 7, 8, 9],
    wp: [[62.4500, -114.3700], [62.5536, -113.3520]],
    notes: 'Paved then gravel past Prelude Lake; start of the winter road to the diamond mines.', src: W + 'Ingraham_Trail' },
];

const UA = { 'user-agent': 'trail-finder-moto/1.0 (github allduf/trail-finder)' };
const V = 'https://valhalla1.openstreetmap.de';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const post = async (p, b) => { for (let i = 0; i < 4; i++) { try { const r = await fetch(V + p, { method: 'POST', headers: { 'content-type': 'application/json', ...UA }, body: JSON.stringify(b) }); const j = await r.json(); if (j.trip || j.edges || j.error_code) return j; } catch {} await sleep(2000 * 2 ** i); } throw new Error('valhalla ' + p); };
function decode(s, p = 6) { let i = 0, la = 0, lo = 0; const o = []; const f = 10 ** p; while (i < s.length) { for (const k of [0, 1]) { let b, sh = 0, r = 0; do { b = s.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32); const d = r & 1 ? ~(r >> 1) : r >> 1; if (k) lo += d; else la += d; } o.push([la / f, lo / f]); } return o; }
const rad = Math.PI / 180;
const dist = (a, b) => { const x = (b[1] - a[1]) * rad * Math.cos((a[0] + b[0]) / 2 * rad), y = (b[0] - a[0]) * rad; return Math.hypot(x, y) * 6371; };
function dp(pts, tol) { const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1; const st = [[0, pts.length - 1]]; while (st.length) { const [a, b] = st.pop(); let m = -1, md = tol; const A = pts[a], B = pts[b]; const kx = Math.cos(A[0] * rad); for (let i = a + 1; i < b; i++) { const P = pts[i]; const ax = (B[1] - A[1]) * kx, ay = B[0] - A[0], px = (P[1] - A[1]) * kx, py = P[0] - A[0]; const L = ax * ax + ay * ay; let t = L ? (px * ax + py * ay) / L : 0; t = Math.max(0, Math.min(1, t)); const d = Math.hypot(px - t * ax, py - t * ay); if (d > md) { md = d; m = i; } } if (m > 0) { keep[m] = 1; st.push([a, m], [m, b]); } } return pts.filter((_, i) => keep[i]); }
const simplify = pts => dp(pts, 0.00025); // ~25 m: keeps every bend, far under one point per 100 m
function encode(pts) { let o = '', pa = 0, po = 0; const enc = v => { v = v < 0 ? ~(v << 1) : v << 1; let r = ''; while (v >= 32) { r += String.fromCharCode((32 | (v & 31)) + 63); v >>>= 5; } return r + String.fromCharCode(v + 63); };
  for (const [a, b] of pts) { const la = Math.round(a * 1e6), lo = Math.round(b * 1e6); o += enc(la - pa) + enc(lo - po); pa = la; po = lo; } return o; }
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const BIKES = ['enduro', 'light', 'mid', 'big', 'street'];
const DIRT = new Set(['compacted', 'dirt', 'gravel', 'path', 'impassable']);

const cacheF = process.env.MOTO_FUEL_CACHE || '/tmp/moto-fuel-cache.json';
const fuelCache = fs.existsSync(cacheF) ? JSON.parse(fs.readFileSync(cacheF)) : {};
async function fuelIn(cell) { // cell = 0.25 deg lat x 0.5 deg lon box, key "la,lo"
  if (fuelCache[cell]) return fuelCache[cell];
  const [la, lo] = cell.split(',').map(Number);
  const out = []; const boxes = [[lo, la, lo + 0.5, la + 0.25]];
  while (boxes.length) { const [w, s, e, n] = boxes.pop();
    const u = `https://nominatim.openstreetmap.org/search?q=%5Bfuel%5D&format=jsonv2&limit=50&bounded=1&viewbox=${w},${n},${e},${s}`;
    let j = []; for (let i = 0; i < 4; i++) { try { j = await (await fetch(u, { headers: UA })).json(); break; } catch { await sleep(3000 * 2 ** i); } }
    await sleep(1100);
    if (j.length >= 50 && e - w > 0.03) { const mx = (w + e) / 2, my = (s + n) / 2; boxes.push([w, s, mx, my], [mx, s, e, my], [w, my, mx, n], [mx, my, e, n]); continue; }
    for (const x of j) if (x.type === 'fuel') out.push([+x.lat, +x.lon]); }
  fuelCache[cell] = out; fs.writeFileSync(cacheF, JSON.stringify(fuelCache)); return out;
}

const only = process.argv[2]; const out = [];
for (const r of R) {
  if (only && !r.id.startsWith(only)) continue;
  const locs = r.wp.map(([lat, lon], i) => ({ lat, lon, type: 'break', radius: 300 }));
  const t = await post('/route', { locations: locs, costing: 'auto', costing_options: { auto: { use_ferry: 1 } }, directions_type: 'none' });
  if (!t.trip) { console.error(r.id, 'NO ROUTE', t.error); continue; }
  const pts = t.trip.legs.flatMap(l => decode(l.shape));
  const km = t.trip.summary.length;
  let dirt = 0, all = 0, ferry = false;
  const roads = {};
  for (const l of t.trip.legs) { const q = m => post('/trace_attributes', { encoded_polyline: l.shape, shape_match: m, costing: 'auto', filters: { attributes: ['edge.surface', 'edge.length', 'edge.use', 'edge.names'], action: 'include' } });
    let a = await q('edge_walk'); if (!a.edges) a = await q('walk_or_snap');
    if (!a.edges) console.error(r.id, 'no surface for a leg', a.error);
    for (const e of a.edges || []) { all += e.length; if (e.use === 'ferry') ferry = true; else if (DIRT.has(e.surface)) dirt += e.length; const k = (e.names || ['?'])[0] + '|' + e.surface; roads[k] = (roads[k] || 0) + e.length; } }
  console.error('   ', Object.entries(roads).filter(x => x[1] > 5).sort((a, b) => b[1] - a[1]).slice(0, 6).map(x => x[0] + ' ' + Math.round(x[1])).join('; '));
  // fuel: stations within 3 km of the line, as km along the line
  const cells = new Set(); for (const p of pts) for (const dy of [-0.03, 0.03]) for (const dx of [-0.05, 0.05]) cells.add(`${Math.floor((p[0] + dy) * 4) / 4},${Math.floor((p[1] + dx) * 2) / 2}`);
  const st = []; for (const c of cells) st.push(...await fuelIn(c));
  const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
  const at = []; for (const s of st) { let best = 9e9, k = 0; for (let i = 0; i < pts.length; i += 3) { const d = dist(s, pts[i]); if (d < best) { best = d; k = i; } } if (best < 3) at.push(cum[k]); }
  at.sort((a, b) => a - b); const L = cum[cum.length - 1]; const marks = [0, ...at, L]; let gap = 0; for (let i = 1; i < marks.length; i++) gap = Math.max(gap, marks[i] - marks[i - 1]);
  const line = simplify(pts).map(([a, b]) => [+a.toFixed(5), +b.toFixed(5)]);
  const fit = BIKES.slice(0, BIKES.indexOf(r.grade === 1 ? 'street' : r.bikes) + 1).reverse();
  const o = { id: r.id, n: r.n, prov: r.prov, km: Math.round(km), dirtPct: all ? Math.round(dirt / all * 100) : 0, grade: r.grade, bikes: fit,
    season: MON[r.season[0] - 1] + '-' + MON[r.season[r.season.length - 1] - 1], fuelGap: Math.round(gap),
    start: line[0], end: line[line.length - 1], line: encode(line), notes: r.notes, src: r.src };
  if (r.loop) o.loop = true;
  if (ferry) o.ferry = true;
  out.push(o); console.error(r.id.padEnd(26), String(o.km).padStart(5), 'km', String(o.dirtPct).padStart(3) + '% dirt', 'fuelGap', o.fuelGap, 'stations', at.length, ferry ? 'FERRY' : '', 'pts', line.length, 'chars', o.line.length);
}
if (!only) fs.writeFileSync(new URL('../data/moto-routes.json', import.meta.url), JSON.stringify({ v: 1, built: new Date().toISOString().slice(0, 10), note: 'Traced on OSM roads (Valhalla); dirtPct from OSM surface; fuelGap from OSM fuel stations within 3 km. Check closures before riding.', routes: out }));
