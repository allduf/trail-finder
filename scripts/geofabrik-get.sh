#!/usr/bin/env bash
# Download one Geofabrik extract, patiently: bash scripts/geofabrik-get.sh <parent>/<name> <out.pbf>
#   e.g. bash scripts/geofabrik-get.sh north-america/canada/british-columbia /tmp/osm/p.pbf
# Geofabrik sometimes can't be reached for a few minutes, or answers "not found" while it swaps in the day's files
# (data audit 2026-11-21 and 2026-11-23). Retry every 5 minutes, and check the file against Geofabrik's .md5
# before using it. All downloads in one job share one waiting budget (GEOFABRIK_WAIT_MIN, 40 minutes by default),
# so a long outage ends the job with a clear error before GitHub's time limit.
set -u
path="$1"; out="$2"
name="${path##*/}"
url="https://download.geofabrik.de/$path/$name-latest.osm.pbf"
budget="${RUNNER_TEMP:-/tmp}/geofabrik-wait-until"
[ -f "$budget" ] || echo $(( $(date +%s) + ${GEOFABRIK_WAIT_MIN:-40} * 60 )) > "$budget"
until_ts=$(cat "$budget")
try=0
while :; do
  try=$((try + 1))
  rm -f "$out" "$out.md5"
  if curl -sSfL --connect-timeout 30 --speed-limit 20000 --speed-time 120 -o "$out" "$url"; then
    if curl -sSfL --connect-timeout 30 --max-time 60 -o "$out.md5" "$url.md5"; then
      want=$(cut -d' ' -f1 "$out.md5"); got=$(md5sum "$out" | cut -d' ' -f1)
      [ "$want" = "$got" ] && ok=1 || { ok=0; echo "Geofabrik: $name download doesn't match its checksum"; }
    else
      osmium fileinfo -e "$out" > /dev/null 2>&1 && ok=1 || ok=0
    fi
    rm -f "$out.md5"
    if [ "$ok" = 1 ]; then ls -lh "$out"; exit 0; fi
  fi
  if [ $(( $(date +%s) + 300 )) -gt "$until_ts" ]; then
    echo "::error::Geofabrik: could not download $name (waited as long as this job allows)"
    exit 1
  fi
  echo "Geofabrik: $name not available yet (try $try), waiting 5 minutes"
  sleep 300
done
