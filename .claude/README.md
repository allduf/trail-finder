# Claude Code setup for Trail Finder

Every Claude Code session that opens this repository (cloud, GitHub, a laptop) gets these. The rules themselves are in
`CLAUDE.md` at the repo root; this folder holds the recipes and checks that follow them. The repository is public:
nothing private goes here (no keys, emails, or unofficial trail names).

| Path | What it is |
| --- | --- |
| `skills/ship/` | `/ship`: checks a change, then opens its pull request (never merges) |
| `skills/add-trail-info/` | `/add-trail-info <trail> <source>`: trail facts from outside OpenStreetMap |
| `skills/status/` | `/status`: open pull requests, their phone check, merge order, last publish |
| `skills/check-lag/` | `/check-lag`: 3D map lag and memory at iPhone size, main against the branch |
| `skills/screens/` | `/screens`: before and after screenshots at iPhone size |
| `skills/ship-change/`, `weather-check/`, `mtb-conditions/`, `avalanche-rules/`, `phone-screenshots/`, `new-sport-feature/` | Rule skills Claude loads on its own when the work matches |
| `agents/` | Read-only helpers: `wording-reviewer`, `sport-checker`, `trail-researcher` |
| `hooks/after-edit.mjs` | Runs after every edit of a `.js` or `.html` file: wording check + no hand-set version |
| `settings.json` | Permissions (allowed, ask first, never) and the hook |

Personal settings go in `.claude/settings.local.json` (not committed).
