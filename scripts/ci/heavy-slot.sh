#!/usr/bin/env bash
# Waits until this run is one of the oldest HEAVY_MAX (2) heavy test runs going on (alex 2026-11-27: at most 2 heavy
# test runs at once, see the trail-finder-merge-queue skill). Heavy = the app builds and simulator tests below: many at
# once hit Maven Central's download limit (429) and GitHub's macOS runner limit. Older runs go first, so nothing waits
# forever; after 60 min it goes anyway. Used by a small "slot" job ahead of each heavy job.
#   needs: GH_TOKEN (actions: read), GITHUB_REPOSITORY, GITHUB_RUN_ID
set -uo pipefail
MAX=${HEAVY_MAX:-2}
HEAVY='["Android app","iPhone app","Low power 3D","Side by side","Slope card","Tough conditions (phone apps)"]'
for i in $(seq 1 120); do
  if ahead=$(gh api "repos/$GITHUB_REPOSITORY/actions/runs?status=in_progress&per_page=100" --jq "
      [.workflow_runs[] | select(.name as \$n | $HEAVY | index(\$n)) | {id, created_at}] | sort_by(.created_at, .id)
      | (map(.id) | index($GITHUB_RUN_ID)) // 0"); then
    if [ "$ahead" -lt "$MAX" ]; then echo "Slot free ($ahead heavy runs ahead of this one): going."; exit 0; fi
    [ "$i" = 1 ] && echo "$ahead heavy test runs started before this one are still going (at most $MAX at once): waiting."
  else
    echo "::warning::Could not list the runs going on (try $i): trying again in 30 s."
  fi
  sleep 30
done
echo "::warning::Waited 60 min for a heavy test slot: going anyway."
