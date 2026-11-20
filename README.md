# trail-finder
Finds newly mapped mountain bike trails in the Sea to Sky corridor, the Sunshine Coast and Calgary and the Rockies (Bragg Creek, Canmore, Kananaskis, Banff), using OpenStreetMap data.

Live site: https://allduf.github.io/trail-finder/

## Where the data files live
The data jobs in `.github/workflows/` save the files they build (trails, names, roads, fires, winter...) to the
`site-data` branch with `scripts/site-data.sh`, not to main: that branch is one commit with no history, replaced on
every save, so the repository doesn't grow each time the data is rebuilt. `pages.yml` publishes main with the branch's
`data/` on top (and `canada-data` under `ca/`, `winter-photos` under `data/winter/`). Each job starts with
`bash scripts/site-data.sh get`, which puts the branch's files into `data/`. Files edited by hand
(`data/trail-info.json`, `data/riding-areas.json`, `data/winter-scenes.json`, `data/snowmobile-clubs.json`,
`data/landmarks.json`) stay in main. To work with the data locally: `git fetch origin site-data && git archive
FETCH_HEAD data | tar -x`.

## Mapper watch
Every hour, `.github/workflows/watch-mapper.yml` checks OpenStreetMap for new edits by the mappers in its `WATCH` list
(now: eerib) and posts them as a comment on the issue "New OpenStreetMap edits by &lt;name&gt;", mentioning @allduf so GitHub
sends an email. Each comment says what the edit did to trails, with links to the edit and a before/after map.

## Phone notifications
The 🔔 box has a "📱 Also send them to this phone" switch. It saves the phone's push address and its 🔔 settings
(regions, the prime loam and new trail switches, the To ride list) to Supabase through `push_save()` (`supabase/push.sql`).
`.github/workflows/loam-push.yml` runs `scripts/push-loam.mjs` five times a day: it reads the Loam index the same way the
site does and sends one notification for the riding areas and To ride trails that just turned prime, and one for new
trails. Setup: run `supabase/push.sql` once in the Supabase SQL Editor and add the repository secret `SUPABASE_SECRET_KEY`.
On iPhone it works only from the Home Screen (Safari, Share, Add to Home Screen; iOS 16.4 or newer).

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
In Skiing, "📍 Save point" (on the map, or a long press) saves a point with a name, a description and a photo;
the same button shows or hides the saved pins
(`ski-points.js`). Points are kept in the browser's IndexedDB and, when signed in, in the account (`supabase/ski-points.sql`).

## Install on a phone
The site installs as a home screen app (no App Store). iPhone: open the site in Safari, tap Share, then Add to Home
Screen. Android: open it in Chrome, tap the ⋮ menu, then Install app (or Add to Home screen). It opens full screen
with the Trail Finder icon. `manifest.webmanifest` and `icons/` hold the name and icons; `sw.js` keeps a copy of the
pages, scripts and the last `data/*.json` it loaded so the app still opens with no signal. Pages and data are always
fetched from the network first, so new deploys and each nightly data build show up whenever there is a connection.
Map tiles, weather and OpenStreetMap lookups still need a connection. `sw.js`'s `VERSION` and every script's `?v=`
are written `__V__` and set to one new number each time the site is published (`scripts/stamp.mjs`): never edit them.

**Pull requests never touch shared numbers or shared lines** (2026-11-19), so parallel PRs don't clash:
- script tags: `name.js?v=__V__` (the publish sets the number; the phone test fails on a hand-set number);
- What's new: a new file `data/changelog.d/<short-name>.json` with `{"date": "YYYY-MM-DD", "text": "..."}`, not an
  edit of `data/changelog.json`;
- French: a new file `scripts/i18n/fr-<short-name>.txt` named after the change, not the next number. `i18n-fr.js` is
  no longer in git: `node scripts/i18n/build.mjs` makes it locally, the publish and the phone test make it too.

## Weather model blend (BC)
Every day at 10:25 UTC, `.github/workflows/wx-blend.yml` runs `scripts/wx-blend/build.py`. It reads four free forecast
models straight from their makers' open-data servers: Environment Canada GEM (HRDPS 2.5 km for 48 h, then GDPS),
ECMWF IFS 9 km, NOAA GFS (AWS open data) and DWD ICON. Each model's daily water (rain + melted snow), high and low go on
one 0.1 degree grid over BC, one file per 1 degree square in `data/wx/blend/` (days 1 am to 1 am Pacific standard
time). `wxcheck.js` reads the square for a place inside the grid and puts the middle of the models into the weather
card's daily numbers, scaling the hours to the same day total; hours and wind stay Open-Meteo's middle of 3 models.
All four sources allow commercial use with credit (see `credits.html` and `data/wx/blend/index.json`).
The same job keeps each model's 12 UTC to 12 UTC amounts and scores them against Environment Canada's precipitation
analysis (HRDPA 2.5 km, from gauges and radar) once it is out: `data/wx/blend/score.json` (`summary` = mean error per
model and region, smallest first).
