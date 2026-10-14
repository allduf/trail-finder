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
light purple from zoom 11: solid for open, white gaps for deactivated or retired, red dots for closed or gated, thinner
for rough or 4x4 only. Tapping one shows each source's status. There is no open feed of live FSR closures; the
district road safety notices on gov.bc.ca are linked instead.
