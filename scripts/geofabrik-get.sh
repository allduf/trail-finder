#!/usr/bin/env bash
# Download one Geofabrik extract, patiently: bash scripts/geofabrik-get.sh <parent>/<name> <out.pbf>
#   e.g. bash scripts/geofabrik-get.sh north-america/canada/british-columbia /tmp/osm/p.pbf
# Geofabrik sometimes can't be reached for a few minutes, or answers "not found" while it swaps in the day's files
# (data audit 2026-11-21 and 2026-11-23). Try the folder layout Geofabrik uses since 2026-11-19
# (<parent>/<name>/<name>-latest.osm.pbf) and the older flat one (<parent>/<name>-latest.osm.pbf), for up to
# about 40 minutes, and check that the file is a whole map file before using it.
set -u
path="$1"; out="$2"
name="${path##*/}"; parent="${path%/*}"
base="https://download.geofabrik.de"
urls=("$base/$parent/$name/$name-latest.osm.pbf" "$base/$parent/$name-latest.osm.pbf")
for round in 1 2 3 4 5 6 7 8; do
  for url in "${urls[@]}"; do
    rm -f "$out"
    if curl -sSfL --retry 2 --retry-delay 30 --connect-timeout 30 -o "$out" "$url" && osmium fileinfo "$out" > /dev/null 2>&1; then
      ls -lh "$out"
      exit 0
    fi
  done
  [ "$round" -lt 8 ] && { echo "Geofabrik: $name not available yet (try $round of 8), waiting 5 minutes"; sleep 300; }
done
echo "::error::Geofabrik: could not download $name after about 40 minutes"
exit 1
