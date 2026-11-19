## What changed

## How it was tested (phone first)

## Checklist
- [ ] No version numbers set by hand: new script tags say `?v=__V__` (the publish sets the number)
- [ ] What's new: a new `data/changelog.d/<short-name>.json` file (user-facing changes), not an edit of `data/changelog.json`
- [ ] French for new text people see, in a new `scripts/i18n/fr-<short-name>.txt` (no `i18n-fr.js` in the PR)
- [ ] **Terms and safety (alex's rules, 2026-11-05 and 2026-11-06):** `terms.html` covers every feature, now and later, without naming it, so a normal feature needs **no** terms edit. Route or tour planning still waits on `tfRiskOk(kind)` and shows `tfRiskLine()` (`risk.js`; an unknown kind gets the general text). Edit `terms.html` (English and French) and raise `TERMS_V` only for a new kind of risk the general words don't reach: something paid, selling or renting gear, guided trips or events, a new country, or data shared in a new way (that goes in `privacy.html`).
- [ ] **Liability-safe wording (alex, 2026-11-11, every feature now and later):** new text says what the map, model or source shows and that it's an estimate where it is; never calls a place, route, slope or ice safe, never promises a road, trail or season is open or allowed, no travel advice. `node scripts/wording-check.mjs` (also run by the phone test) catches the worst words.
- [ ] `ios-app/` changes? They start a new TestFlight build: tell alex before merging
