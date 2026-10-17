#!/usr/bin/env bash
# Commits a data job's own files and pushes them, even when other jobs pushed to the branch while this one ran.
# Usage (from a workflow step): bash scripts/commit-data.sh "Commit message" <path or glob>...
#
# Each job writes only its own files, so on a race it starts again from the branch's latest commit with its fresh files
# on top, instead of "git pull --rebase", which stops the job when another job also touched a file (the forest roads run
# of 2026-10-15 built all 31 zones and saved none: the Wildfires job had changed data/fires.json in the meantime).
set -euo pipefail
msg=$1; shift
branch=${GITHUB_REF_NAME:-$(git rev-parse --abbrev-ref HEAD)}
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

git add -A -- "$@"
if git diff --cached --quiet; then echo "No changes."; exit 0; fi
keep=$(mktemp -d)
list=$(mktemp -d)
git diff --cached --name-only --diff-filter=d -z > "$list/changed"
git diff --cached --name-only --diff-filter=D -z > "$list/deleted"
xargs -0 -r cp --parents -t "$keep" < "$list/changed"
echo "$(git diff --cached --name-only | wc -l) files to save"

for attempt in 1 2 3 4 5; do
  git fetch -q origin "$branch"
  git reset -q --hard "origin/$branch"
  cp -a "$keep/." .
  xargs -0 -r git rm -q --ignore-unmatch -- < "$list/deleted"
  xargs -0 -r git add -- < "$list/changed"
  if git diff --cached --quiet; then echo "Nothing new after catching up."; exit 0; fi
  git commit -q -m "$msg"
  if git push -q origin "HEAD:$branch"; then echo "Saved (attempt $attempt)."; exit 0; fi
  sleep $((attempt * 10))
done
echo "::error::Couldn't push the data after 5 tries"
exit 1
