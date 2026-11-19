---
name: new-sport-feature
description: Use when adding or changing a Trail Finder feature that exists, or could exist, in more than one sport (MTB, skiing, hiking, fishing, hunting, moto/ADV, bikepacking), or a shared piece (header, menus, alerts, cards).
---

# New feature across sports checklist

1. List the sports: MTB, Skiing, Hiking, Fishing, Hunting, Moto and ADV, Bike trips. For each, decide whether the
   feature fits and how it should differ. Nothing MTB-only appears in other sports.
2. Reuse shared code (for example `trip-core.js`) and give each sport its own wording, data and defaults.
3. For each sport, check every surface: map layer and legend (Key), tap-a-point card, trail or spot card, lists and
   search, plain-words Ask, Plan a route, trip planner, saved items, alerts, offline, and signed-in sync.
4. Sport-specific rules: skiing follows `avalanche-rules`; MTB follows `mtb-conditions`; any weather value follows
   `weather-check`; hunting logs and missions are shared by private link only.
5. Decide the first-open default for each sport (on or off) and ask alex when unsure.
6. Wording is liability-safe in English and French for every sport.
7. Take phone screenshots for each sport that changed (`phone-screenshots`).
8. Ship with `ship-change`. Tell alex which sports got it, which didn't, and why.
