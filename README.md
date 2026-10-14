# trail-finder
Finds newly mapped mountain bike trails in the Sea to Sky corridor and Sunshine Coast, using OpenStreetMap data.

Live site: https://allduf.github.io/trail-finder/

## Mapper watch
Every hour, `.github/workflows/watch-mapper.yml` checks OpenStreetMap for new edits by the mappers in its `WATCH` list
(now: eerib) and posts them as a comment on the issue "New OpenStreetMap edits by &lt;name&gt;", mentioning @allduf so GitHub
sends an email. Each comment says what the edit did to trails, with links to the edit and a before/after map.

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
