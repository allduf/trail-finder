## What changed

## How it was tested (phone first)

## Checklist
- [ ] Shared `?v=` and `sw.js` `tf-N` bumped above main and every open PR
- [ ] One short line at the top of `data/changelog.json` (user-facing changes)
- [ ] French line in `scripts/i18n/` for new text people see
- [ ] **Terms and safety (alex's rules, 2026-11-05 and 2026-11-06):** `terms.html` covers every feature, now and later, without naming it, so a normal feature needs **no** terms edit. Route or tour planning still waits on `tfRiskOk(kind)` and shows `tfRiskLine()` (`risk.js`; an unknown kind gets the general text). Edit `terms.html` (English and French) and raise `TERMS_V` only for a new kind of risk the general words don't reach: something paid, selling or renting gear, guided trips or events, a new country, or data shared in a new way (that goes in `privacy.html`).
- [ ] `ios-app/` changes? They start a new TestFlight build: tell alex before merging
