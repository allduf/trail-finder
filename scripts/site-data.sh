#!/usr/bin/env bash
# The data jobs' files (trails, names, roads, fires... everything under data/ a job builds) live on the site-data
# branch, as one commit with no history, not in main: committing them to main grew the repository by about 7 MB a
# day. pages.yml publishes main with the site-data branch's data/ on top, the same way canada-data and winter-photos
# work. Files people edit by hand (KEEP below) stay in main.
#
#   bash scripts/site-data.sh get                      Puts the branch's data files into ./data (before a job runs).
#   bash scripts/site-data.sh save "Message" <path>... Saves these paths (git pathspecs, quote globs so files a job
#                                                      removed are removed from the branch too) to the branch.
#
# Each job saves only its own files, so on a race (another job saved in the meantime) it starts again from the
# branch's latest commit with its fresh files on top. Every save replaces the branch with a new commit that has no
# parent, so old versions of the data aren't kept.
#
# The first run, when there is no site-data branch yet, starts it from main's data/ (seed).
set -euo pipefail
BRANCH=site-data
# Edited by hand (or by a script run by hand), so they stay in main and never go to the branch.
KEEP=(data/trail-info.json data/riding-areas.json data/winter-scenes.json data/snowmobile-clubs.json data/landmarks.json)
LAST=refs/site-data/last   # the data the job started from (build-new-trails.mjs compares tonight's trails with it)

export GIT_AUTHOR_NAME="github-actions[bot]" GIT_AUTHOR_EMAIL="41898282+github-actions[bot]@users.noreply.github.com"
export GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME" GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"

fetch() {   # the branch's latest commit, or nothing when there's no branch yet
  if git ls-remote --exit-code -q origin "refs/heads/$BRANCH" > /dev/null; then
    git fetch -q --depth 1 origin "+refs/heads/$BRANCH:refs/site-data/tip"
    git rev-parse refs/site-data/tip
  fi
}

# A commit with no parent: the branch's files (or none), with <pathspec>... replaced by the working tree's.
commit_with() {
  local base=$1 msg=$2; shift 2
  local idx; idx=$(mktemp -u)
  if [ -n "$base" ]; then GIT_INDEX_FILE=$idx git read-tree "$base"; else GIT_INDEX_FILE=$idx git read-tree --empty; fi
  local spec
  for spec in "$@"; do   # git add stops at a pathspec that matches nothing, in the branch or the working tree
    if [ -n "$(GIT_INDEX_FILE=$idx git ls-files -c -o -- "$spec" | head -1)" ]; then GIT_INDEX_FILE=$idx git add -A -- "$spec"; fi
  done
  GIT_INDEX_FILE=$idx git rm -r -q --cached --ignore-unmatch -- "${KEEP[@]}"
  local tree; tree=$(GIT_INDEX_FILE=$idx git write-tree)
  rm -f "$idx"
  if [ -n "$base" ] && [ "$tree" = "$(git rev-parse "$base^{tree}")" ]; then return 0; fi
  git commit-tree "$tree" -m "$msg"
}

push() {   # push <commit> <expected current tip or empty for "no branch yet">
  git push -q --force-with-lease="refs/heads/$BRANCH:$2" origin "$1:refs/heads/$BRANCH"
}

case "${1:-}" in
  get)
    base=$(fetch)
    if [ -z "$base" ]; then
      echo "No $BRANCH branch yet: starting it from main's data/."
      git update-ref "$LAST" HEAD
      # A test run on a pull request saves nothing, and the website publish only reads (main's copies are used).
      if [ "${GITHUB_EVENT_NAME:-}" = pull_request ] || [ -n "${SITE_DATA_READ_ONLY:-}" ]; then exit 0; fi
      c=$(commit_with "" "Website data (from main)" data)
      if push "$c" ""; then echo "Started the $BRANCH branch."; else echo "Another job started it first."; fi
      exit 0
    fi
    git update-ref "$LAST" "$base"
    # The branch's files win over main's: until main's old copies are removed, they're out of date.
    git archive "$base" data | tar -x -f - -C "$(git rev-parse --show-toplevel)"
    echo "Got the data files from the $BRANCH branch ($(git ls-tree -r --name-only "$base" data | wc -l) files)."
    ;;
  save)
    msg=$2; shift 2
    for attempt in 1 2 3 4 5; do
      base=$(fetch)
      c=$(commit_with "$base" "$msg" "$@")
      if [ -z "$c" ]; then echo "No changes."; exit 0; fi
      echo "$(git diff --name-only "${base:-$(git hash-object -t tree /dev/null)}" "$c" | wc -l) files to save"
      if push "$c" "$base"; then echo "Saved (attempt $attempt)."; exit 0; fi
      sleep $((attempt * 10))
    done
    echo "::error::Couldn't save the data after 5 tries"
    exit 1
    ;;
  *)
    echo "Usage: bash scripts/site-data.sh get | save \"Message\" <path>..." >&2
    exit 2
    ;;
esac
