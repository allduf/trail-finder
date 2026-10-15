# trail-finder
Finds newly mapped mountain bike trails in the Sea to Sky corridor, the Sunshine Coast and Calgary and the Rockies (Bragg Creek, Canmore, Kananaskis, Banff), using OpenStreetMap data.

Live site: https://allduf.github.io/trail-finder/

## Mapper watch
Every hour, `.github/workflows/watch-mapper.yml` checks OpenStreetMap for new edits by the mappers in its `WATCH` list
(now: eerib) and posts them as a comment on the issue "New OpenStreetMap edits by &lt;name&gt;", mentioning @allduf so GitHub
sends an email. Each comment says what the edit did to trails, with links to the edit and a before/after map.

## Riding area names
`areas.js` writes the names of riding areas (Alice Lake, Diamond Head, Mount Fromme, Lost Lake...) on the map when
zoomed out, and hides them from zoom 13, where the trails take over. Tapping a name zooms in to it. The list is
hand-picked in `data/riding-areas.json` (name, zone, label position, tier); tier 1 names show from zoom 8, tier 2 from
zoom 10. Each label sits in the middle of that area's MTB trails from `data/mtb-<zone>.json`. To add an area, add a line
there.

## Possible unmapped trails
Every Sunday, `.github/workflows/unmapped-trails.yml` runs `scripts/find-unmapped.mjs`. It reads the public GPS traces
people upload to OpenStreetMap and looks for lines that 2 or more traces follow, more than 20 m from anything mapped.
Lines ridden at bike speed show on the site as purple dotted "Possible unmapped trail" lines. They are unverified.

Only OpenStreetMap's GPS traces are used: Strava's and Trailforks' heatmaps don't allow copying or deriving data from
them. Each find links to those heatmaps so a person can compare by eye.

## Record ride
`ride.html` (linked as "Record ride" at the top of the site) records a ride with the phone's GPS: time, moving time,
distance, climb and speed. Press Start, the button turns red, press Stop, then give it a title, description and photos
and save it to "My rides". Rides are kept in this browser's IndexedDB (`trail-finder-rides`), on that device only;
each ride can be downloaded as GPX. Recording stops if the browser closes the page, but the ride so far is kept and
can be carried on.

## Forest roads
Every Monday, `.github/workflows/forest-roads.yml` runs `scripts/build-roads.mjs`, which writes `data/roads-<zone>.json`
from two open sources: the BC government's Forest Tenure road sections (DataBC layer
`WHSE_FOREST_TENURE.FTEN_ROAD_SECTION_LINES_SVW`, Open Government Licence - British Columbia), with each Forest Service
Road or road permit's tenure status (active or retired), and OpenStreetMap dirt roads (`highway=track`, unpaved roads,
roads named FSR, disused or abandoned roads) with their access, gate and deactivation tags. The site draws them in
bold lines with a white edge from zoom 11, coloured by condition like a backroad map: green good, yellow degraded,
red heavily degraded (very rough, 4x4 only, or retired tenure), black dashes impassable (deactivated, washed out,
abandoned), grey dashes unknown, pink dashes closed to public vehicles. Tapping one shows each source's status. There is no open feed of live FSR closures; the
district road safety notices on gov.bc.ca are linked instead.

The same job also saves, per zone, gates, barriers, fords, footbridges and hydro plants on or near those roads
(OpenStreetMap), cut blocks (DataBC `WHSE_FOREST_TENURE.FTEN_CUT_BLOCK_POLY_SVW`: pending, active, and retired in the
last 15 years) and motor vehicle closure areas (DataBC `WHSE_WILDLIFE_MANAGEMENT.WAA_MVPR_AREAS_SP`); the areas have
their own "Logging areas" button on the site. Every 3 hours,
`.github/workflows/wildfires.yml` saves the BC Wildfire Service's current fires and perimeters (fires that are out are
left out), fire area restrictions (`PROT_RESTRICTED_AREAS_SP`) and evacuation orders and alerts
(`EMRG_ORDER_AND_ALERT_AREAS_SP`) to `data/fires.json`, shown with the site's "Wildfires" button.

## Getting there (trailheads, parking and shuttle roads)
Every night, `.github/workflows/access-data.yml` runs `scripts/build-access.mjs`, which writes `data/access-<zone>.json`:
OpenStreetMap trailheads (`highway=trailhead`) and public parking (`amenity=parking`, not private, customers only or a
garage) within 1.5 km of an MTB trail, and BC Recreation Sites and Trails points (DataBC
`WHSE_FOREST_TENURE.FTEN_REC_SITE_POINTS_SVW`, Open Government Licence - British Columbia). The map pins them from
zoom 13. Each trail's details have a "Getting there" section with the nearest trailhead and parking, the forest road
that reaches each one and its condition (from the Forest roads data), a Directions link (Google Maps), and the forest
road nearest the top and bottom of the trail, for a shuttle drop or pickup.

## Skiing (winter mode)
The sport menu in the header switches the site between MTB and Skiing (`winter.js`). In Skiing the map shows backcountry
ski routes and huts, and the "Avalanche risk" button shades slopes over about 25° by Avalanche Canada's danger rating for
their elevation band, with stripes on the aspects and elevations named in the avalanche problems (2D and 3D map; terrain
heights from AWS Terrain Tiles). `.github/workflows/winter-data.yml` runs `scripts/build-winter.mjs`: every 2 hours it
saves the forecasts for the region to `data/avalanche.json` (public Avalanche Canada API, no key), and every night it
saves the ski routes and huts to `data/ski.json` from OpenStreetMap and BC Recreation Sites and Trails
(`WHSE_FOREST_TENURE.FTEN_RECREATION_LINES_SVW`, Open Government Licence - British Columbia).
In Skiing, "📍 Save point" (on the map, or a long press) saves a point with a name, a description and a photo
(`ski-points.js`). Points are kept in the browser's IndexedDB and, when signed in, in the account (`supabase/ski-points.sql`).

## Install on a phone
The site installs as a home screen app (no App Store). iPhone: open the site in Safari, tap Share, then Add to Home
Screen. Android: open it in Chrome, tap the ⋮ menu, then Install app (or Add to Home screen). It opens full screen
with the Trail Finder icon. `manifest.webmanifest` and `icons/` hold the name and icons; `sw.js` keeps a copy of the
pages, scripts and the last `data/*.json` it loaded so the app still opens with no signal. Pages and data are always
fetched from the network first, so new deploys and each nightly data build show up whenever there is a connection.
Map tiles, weather and OpenStreetMap lookups still need a connection. When changing the list of files in `sw.js`,
bump its `VERSION` so phones drop the old copy.
