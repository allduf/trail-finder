## What changed

## How it was tested (phone first)

## Checklist
- [ ] Shared `?v=` and `sw.js` `tf-N` bumped above main and every open PR
- [ ] One short line at the top of `data/changelog.json` (user-facing changes)
- [ ] French line in `scripts/i18n/` for new text people see
- [ ] **Terms and safety (alex's rule, 2026-11-05):** if this adds or changes something that suggests where to go, plans a route, rates difficulty, danger or conditions, shows official status, or shares other people's data, `terms.html` (English and French) covers it, and route or tour planning waits on `tfRiskOk(kind)` and shows `tfRiskLine()` (`risk.js`). Raise that kind's version in `ACK` if its words changed; raise `TERMS_V` only for a real change to the terms.
- [ ] `ios-app/` changes? They start a new TestFlight build: tell alex before merging
