---
name: ship
description: Check a finished Trail Finder change against the shipping rules, then open its pull request. Never merges.
disable-model-invocation: true
argument-hint: "[short name of the change]"
allowed-tools: Bash(node scripts/wording-check.mjs), Bash(node scripts/stamp.mjs --check), Bash(node scripts/i18n/build.mjs), Bash(git status:*), Bash(git diff:*), Bash(git log:*)
---

# /ship

Change: $ARGUMENTS

Follow these steps in order. Stop and tell alex at the first one that fails.

1. **Branch.** You are not on main. Pull main into the branch first (`git pull origin main`).
2. **Look at the diff** (`git diff origin/main...`). List what users will see change, sport by sport.
3. **Versions.** No hand-set `?v=` number or `tf-` number: `node scripts/stamp.mjs --check`.
4. **What's new.** A user-facing change has a new `data/changelog.d/<short-name>.json` (`{"date", "text"}`, one short
   plain line). `data/changelog.json` is not edited.
5. **French.** Every new text, including the What's new line, is in a new `scripts/i18n/fr-<short-name>.txt`.
   Run `node scripts/i18n/build.mjs` and check that it ends without an error.
6. **Wording.** `node scripts/wording-check.mjs` passes. Then have the `wording-reviewer` agent read the diff for what
   a word list can't catch (travel advice, avalanche levels, terrain traps, promises in other words).
7. **Every sport.** If a shared piece changed (header, menus, alerts, cards, map), have the `sport-checker` agent check
   it in every sport.
8. **Public repo.** No secrets, keys, key IDs, emails, private business details, or unofficial trail names in the diff,
   commit messages or pull request text.
9. **Screenshots.** For a visible change, before and after at iPhone size (`phone-screenshots`).
10. **Phone test.** Run `node scripts/phone-test.mjs` if a browser is available (in a cloud container:
    `BROWSER=chromium`). Otherwise say it will run as the "phone" check.
11. **Open the pull request** with what changed, why, the screenshots, and which sports it touches. Say if it changes
    `ios-app/` or `android-app/` (needs a new app build).
12. **Stop there.** Do not merge or turn on auto-merge. Tell alex the pull request is ready and wait for alex's yes.
