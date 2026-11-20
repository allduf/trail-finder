---
name: ship-change
description: Use when making any user-facing change to the Trail Finder app and opening its pull request.
---

# Ship a Trail Finder change

1. Pull main first. Work on your own branch.
2. Make the change phone-first (iPhone size, 430x932). Each sport keeps its own features; nothing MTB-only in other
   sports (see `new-sport-feature`). Every change reaches every device: website, iPhone (incl. native 3D) and
   Android (see `all-devices`).
3. Wording is liability-safe: never promise safety, accuracy, access, legality or conditions. State facts and their
   source, and say "estimate" where it is one. No travel advice, no terrain traps, runouts or "what is above you".
   No emoji in the interface (line icons in `line-icons.js`). Never mention Trailforks.
4. Versions are automatic: leave `?v=__V__` and `VERSION = "tf-__V__"` as they are. `node scripts/stamp.mjs --check`
   fails on a hand-set number. Leave separate tags (such as `winter-hd.js?v=` in `map3d.js`) alone.
5. What's new: a new file `data/changelog.d/<short-name>.json` with `{"date": "YYYY-MM-DD", "text": "..."}`, one short
   plain line. Never edit `data/changelog.json`.
6. French for every new text, including the What's new line: a new `scripts/i18n/fr-<short-name>.txt`
   (`English ||| French`, one per line). Try it with `node scripts/i18n/build.mjs` (`i18n-fr.js` is not in git).
7. Guard calls into other scripts' new functions (`window.x && window.x.fn ? ... : null`).
8. New libraries go in `vendor/` with package, version and sha256 in `vendor/SOURCES.md`. Never a CDN.
9. Run `node scripts/wording-check.mjs` and `node scripts/stamp.mjs --check`. Take before and after screenshots
   (`phone-screenshots`).
10. Open the pull request. The required check is "phone". It merges on its own once ready and checks pass, one
    auto-merge at a time; tell alex after it goes live. Pull before pushing (the "Fix PR conflicts" workflow merges
    main into open pull requests). Pull requests that only touch `data/`, `ios-app/`, `supabase/` or `.md` skip
    "phone": run "Phone test" on the branch. Changes under `ios-app/` or `android-app/`: start the iPhone and
    Android builds together after merging.
11. Never do anything that makes the app officially public (store submit, public TestFlight, removing `noindex`).
