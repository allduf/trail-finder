# trail-finder
Finds newly mapped mountain bike trails in the Sea to Sky corridor and Sunshine Coast, using OpenStreetMap data.

Live site: https://allduf.github.io/trail-finder/

## Mapper watch
Every hour, `.github/workflows/watch-mapper.yml` checks OpenStreetMap for new edits by the mappers in its `WATCH` list
(now: eerib) and posts them as a comment on the issue "New OpenStreetMap edits by &lt;name&gt;", mentioning @allduf so GitHub
sends an email. Each comment says what the edit did to trails, with links to the edit and a before/after map.
