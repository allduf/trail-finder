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
- `terms.html` covers features in general, so a normal feature needs no terms edit. Route or tour planning waits
  on `tfRiskOk(kind)` and shows `tfRiskLine()` (`risk.js`). Change `terms.html` (English and French) and raise
  `TERMS_V` only for a new kind of risk: something paid, gear sales or rentals, guided trips, a new country, or
  data shared in a new way (that goes in `privacy.html`).
- `scripts/wording-check.mjs` runs in the phone test and fails on risky words. Mark a code-only word list with
  `// wording-ok`; do not use that to get past real wording.

## No travel advice
- Routes, tours and safety features describe terrain only (length, angle, aspect). Never tell people how to
  travel: no "one at a time", "don't stop", "move quickly", regroup spots, or "safer bet".

## Avalanche information must be exact
- Show only the danger rating Avalanche Canada gave, for that elevation band. Never raise or lower it by slope,
  aspect or anything else. Better to show nothing than a wrong level.
- Problem aspects are shown with diagonal stripes of a darker shade of the same colour (alex 2026-11-26), over the
  band's own colour. Do not reuse danger colours for other meanings.
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

## Keep the app professional (alex 2026-11-25)
- Every change, on every device, must look and read polished: consistent wording, capitals, spacing, icons and
  colours; clean empty, loading and error states; no typos.
- Nothing meant for us shows to users or testers: no debug, test or placeholder text, no dev-only labels, no raw
  error codes or `undefined`/`NaN`/`null` in the interface.
- Keep it organized: menus, panels, settings and buttons grouped the same way in every sport and on every device, with
  no clutter or duplicate controls. A regrouping is a taste call: show alex before and after screenshots and ask first.
- Check every changed screen at phone size before calling it done (see "Phone first").

## Phone first
- Every feature is designed and tested at iPhone size first. Check it at phone size before calling it done.
- No emoji in the interface: use the line icons (`line-icons.js`).

## Every change reaches every device
- Every change must reach every device: the website, the iPhone app (including native 3D) and the Android app.
  The end goal is every web feature working the same on phones, in native 3D, as smooth as possible.
- Before opening a pull request, decide where the change runs (web only, iPhone native, Android native, or several)
  and list it in the pull request text: Website / iPhone / Android = included, needs a build, or not needed (and why).
- A web-only change reaches the apps with the next website publish: no app build is needed.
- A change to native code (`ios-app/`, `android-app/`, plugins, push, deep links, native 3D) starts a new iPhone
  build ("iPhone app" workflow) and a new Android build ("Android app" workflow) in the same round, so both apps get
  it together. Tell alex before opening the pull request, then tell alex both build numbers.
- Every iPhone fix also goes to Android in the same round (alex 2026-11-21: "everything you fix on iphone version
  need to be fix on android version too").
- New native 3D features follow the split from PR #847: one `NativeXxx.swift` file (a `NativeLayer`, one line in
  `NativeLayers.all`, alphabetical) and one `native-xxx.js` page side (`window.tfNative.addLayer`, guarded). Until a
  layer is drawn natively, add it to `webOnly()` in `native-map.js` so turning it on opens the full web 3D and nothing
  goes missing (on older iPhone builds and Android only: see the next rule).
- An iPhone build that draws every 3D feature natively (build 150 and later) never shows the web 3D map, after any
  update (alex 2026-11-21: "I don't want that to happen again"). The 3D button, a tilt, a tour, a route or another
  script asking for 3D all open native 3D; if it can't open, the flat map stays with a note. Never add a key to `FULL`
  in `native-map.js` (builds already on phones would lack it and go back to the web 3D map), and never take one out of
  `NativeLayers.all`. A new native feature shows from the build that has it.
- Skiing always opens on the Winter map (alex 2026-11-21: "winter should always be by default in skiing"): the flat
  map, the web 3D map and native 3D, on the website, iPhone and Android, whatever style was picked there before. A
  style picked in Skiing lasts until another sport is picked or the app is closed (in 3D, Satellite and Sat + names
  show Winter, as Skiing's 3D always has; Satellite tapped in Layers while native 3D is open shows Satellite there).
- The phone test's "App builds" checks (`scripts/phone-test.mjs`) fail if either rule above breaks. Keep them passing.
- Native 3D must never be slower than the build before (`/check-lag`), draws nothing while switched off, and shows
  avalanche only exactly as Avalanche Canada gives it.
- Never leave a feature on one device only without telling alex and writing down the plan to bring it to the others.

## Never mention Trailforks
- Do not name Trailforks anywhere in the app.

## Libraries
- New libraries are copied into `vendor/` (never loaded from a CDN) with their package, version and sha256
  added to `vendor/SOURCES.md`.
- One exception (alex 2026-11-21): Cloudflare Turnstile (the person check at sign-in) loads from
  challenges.cloudflare.com, because Cloudflare serves it only from there. It is noted in `vendor/SOURCES.md`.

## Every user-facing change
1. Never set a version number by hand. Script tags in `index.html`, `ride.html`, `usage.html` and `sw.js` say
   `?v=__V__` and `VERSION = "tf-__V__"`; the website publish (`scripts/stamp.mjs`) fills in one number. The phone
   test fails on a hand-set number. Leave separate tags (such as `winter-hd.js?v=` inside `map3d.js`) alone.
2. What's new: add a new file `data/changelog.d/<short-name>.json` with `{"date": "YYYY-MM-DD", "text": "..."}`
   (one short, plain line). Do not edit `data/changelog.json`: the publish builds it.
3. French for every new text, including the What's new line: add a new `scripts/i18n/fr-<short-name>.txt`
   (`English ||| French`, one per line). `i18n-fr.js` is generated and not in git; run
   `node scripts/i18n/build.mjs` locally to try it.
4. Guard calls into other scripts' new functions (`window.x && window.x.fn ? ... : null`) so a stale cached
   script cannot break the page.
5. Run `node scripts/wording-check.mjs` before pushing.

## Pull requests and merging
- The required check on main is "phone" (`.github/workflows/phone-test.yml`: wording check, then every sport
  at iPhone size).
- Next to it, "computer" (same workflow, `PART=computer`) tests the website at computer size: turning Skiing's 3D map
  with the mouse. Keep it passing too.
- Every pull request merges on its own once it is ready and its checks pass (alex, 2026-11-20: "i want all of them
  merge when they are ready"). Turn on auto-merge for one pull request at a time, and tell alex after it goes live.
  This never covers going public (see "Do not go public").
- Before a pull request merges on its own, its thread runs an independent code review (`/code-review`) and fixes
  what it finds.
- Pull requests that only touch `data/`, `supabase/` or `.md` files skip the phone check. Then start it by hand
  (run "Phone test" on the branch) so the merge can go through. `ios-app/` pull requests run it (its "App builds"
  checks read the iPhone's native 3D keys).
- Changes under `ios-app/` or `android-app/` need new iPhone and Android builds: start both after merging and tell
  alex the build numbers.
- The "Fix PR conflicts" workflow (`.github/workflows/pr-fix.yml`) merges main into open pull requests, and moves
  older ones over to `__V__`, `changelog.d` and French files. Pull before pushing to a pull request branch.
- If a phone check was cancelled after a merge update, run it again.
- Failed checks fix themselves when the cause is a hiccup (alex 2026-11-27): "Auto re-run" (`.github/workflows/auto-retry.yml`,
  `scripts/ci/auto-retry.mjs`) re-runs a failed check once when its log shows a server or runner hiccup (429, 502/503/504,
  dropped connection, simulator that didn't start), and writes a grey "Auto re-run: <check>" line on the pull request. Its
  "Real failure: not re-run" means the failure is yours: the thread that owns the pull request fixes it, without waiting for alex.
  Never add a test failure or a wording or avalanche check to its hiccup list to get a pull request through.
- At most 2 heavy test runs at once (app builds and simulator tests): each heavy job `needs: slot`, a small job that runs
  `scripts/ci/heavy-slot.sh`. A new workflow with a simulator or an app build gets the same slot job, and its name goes in
  `HEAVY` there and in the `workflows:` list of `auto-retry.yml`.

## Where things are
- Data files built by workflows live on the `site-data` branch, not main: see `README.md`.
  `bash scripts/site-data.sh get` puts them into `data/`.
- The publish trims comments and spaces from the site's own scripts (`scripts/trim-site.mjs`, alex 2026-11-26); line
  numbers stay the same, and the phone test runs on the trimmed copy. Never rely on comments or spacing at run time.
- Phone test: `node scripts/phone-test.mjs`. Wording check: `node scripts/wording-check.mjs`.
  French build: `node scripts/i18n/build.mjs`.
- Claude Code setup in `.claude/` (see `.claude/README.md`): commands `/ship`, `/add-trail-info`, `/status`,
  `/check-lag`, `/screens`; rule skills; read-only helper agents; a hook that runs the wording and version checks
  after every edit of an app `.js` or `.html` file. Keep the skills in step with this file.
