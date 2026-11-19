# Rules for working on Trail Finder

Trail Finder is one app for all outdoor sports in Canada (mountain biking, skiing, hiking, fishing, hunting,
adventure moto and more). It is a plain HTML/JS web app (live at https://trailfinderapp.ca); the iPhone and Android
apps are Capacitor shells around it (`ios-app/`, `android-app/`). The owner is alex (GitHub: allduf).

These are alex's standing rules. Follow them in every session, every sport, every pull request.

## Ask when unsure
- If you are unsure what alex wants, or unsure whether an idea is good, ask alex one clear question with a
  recommended answer. Do not guess and build it in.
- Still research and fix trail data on your own: the asking is about unclear intent and design ideas.

## This repository is public
- Never commit secrets, API keys, key IDs, passwords, email addresses, or private business information.
- Never write the name of an unofficial (informal, unsanctioned) trail in plain text anywhere in the repo,
  including the changelog, French lines, commit messages and pull request text. Hand entries for those use
  hashed names (`nh`), and need no changelog line.

## Do not go public
- Prepare for launch, but never do anything that makes the app officially public: no App Store or Google Play
  submit or release, no public TestFlight link, no removing `noindex` from the website. Warn alex and wait for
  alex's go.

## Wording must be liability-safe (every sport, every new feature)
- State facts, their source, and say "estimate" where it is one. Use "may", "can", "likely".
- Never promise safety, accuracy, access, legality, or conditions. Avoid "safe/safer/safest", "guaranteed",
  "open", "legal/allowed" as a promise, "no avalanche", "dry", or a green all-clear for the absence of a hazard.
- `scripts/wording-check.mjs` runs in the phone test and fails on risky words. Mark a code-only word list with
  `// wording-ok`; do not use that to get past real wording.

## No travel advice
- Routes, tours and safety features describe terrain only (length, angle, aspect). Never tell people how to
  travel: no "one at a time", "don't stop", "move quickly", regroup spots, or "safer bet".

## Avalanche information must be exact
- Show only the danger rating Avalanche Canada gave, for that elevation band. Never raise or lower it by slope,
  aspect or anything else. Better to show nothing than a wrong level.
- Problem aspects may be a darker shade of the same colour. Do not reuse danger colours for other meanings.
- Any estimate we make (band heights, terrain class) is labelled as an estimate.
- When there is no forecast, routes can still draw from terrain only, with a warning that no forecast is
  included and why.

## No terrain traps, runouts, or "what is above you"
- Never show terrain traps, runout zones, or steep slopes above a route or spot, in any feature, card, layer,
  or video. The data is not accurate enough. Avalanche Canada's own wording may still name them.

## Weather is cross-checked
- Any weather, soil, snow or freeze value from a model forecast is checked against other models: use
  `wxcheck.js` (`tfWx.getChecked`), which shows the middle value of GEM, ECMWF and GFS with their range.
  Say where values come from. Compare with Environment Canada where possible.

## Trail information from outside OpenStreetMap
- When you find trail facts from another source (resort or club maps, official data, trail reports, local
  sources), add them to that trail: grade, name, direction, description, anything useful. Hand-edited facts go
  in `data/trail-info.json` (short summaries in our own words, each linked to its source).

## Each sport has its own features
- Every sport mode gets features and wording made for that sport. Nothing MTB-only shows in skiing, hunting,
  fishing or the others. When touching a shared piece (header, menus, alerts, cards), check every sport.

## Mountain biking specifics
- Suggested loops start and end at a public parking lot near their trails, and never use bike park
  (lift-access) trails.
- Loam: Open-Meteo soil moisture; the middle "Damp" range is prime loam.

## Phone first
- Every feature is designed and tested at iPhone size first. Check it at phone size before calling it done.
- No emoji in the interface: use the line icons (`line-icons.js`).

## Never mention Trailforks
- Do not name Trailforks anywhere in the app.

## Libraries
- New libraries are copied into `vendor/` (never loaded from a CDN) with their package, version and sha256
  added to `vendor/SOURCES.md`.

## Every user-facing change
1. Bump the version together: every `?v=N` in `index.html` and `ride.html` (one shared N, same value), and
   `VERSION = "tf-N"` plus the `?v=` entries in `sw.js`. Pick numbers above what main and open pull requests use.
   Leave separate tags (such as `winter-hd.js?v=` inside `map3d.js`) alone.
2. Add one short, plain line at the top of `data/changelog.json` with today's date.
3. Add the French for every new text, including the changelog line, in a new `scripts/i18n/fr-N.txt`
   (`English ||| French`, one per line), then run `node scripts/i18n/build.mjs` and commit `i18n-fr.js`.
4. Guard calls into other scripts' new functions (`window.x && window.x.fn ? ... : null`) so a stale cached
   script cannot break the page.
5. Run `node scripts/wording-check.mjs` before pushing.

## Pull requests and merging
- The required check on main is "phone" (`.github/workflows/phone-test.yml`: wording check, then every sport
  at iPhone size).
- Merge only with alex's yes. Turn on auto-merge for one pull request at a time.
- Pull requests that only touch `data/`, `ios-app/`, `supabase/` or `.md` files skip the phone check: alex merges
  those by hand.
- Changes under `ios-app/` or `android-app/` need a new app build: tell alex before merging.
- The "Fix PR conflicts" workflow (`.github/workflows/pr-fix.yml`) merges main into open pull requests and fixes
  changelog, French and `?v=` conflicts. Pull before pushing to a pull request branch.
- If a phone check was cancelled after a merge update, run it again.

## Where things are
- Data files built by workflows live on the `site-data` branch, not main: see `README.md`.
  `bash scripts/site-data.sh get` puts them into `data/`.
- Phone test: `node scripts/phone-test.mjs`. Wording check: `node scripts/wording-check.mjs`.
  French build: `node scripts/i18n/build.mjs`.
