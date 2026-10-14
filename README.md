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
