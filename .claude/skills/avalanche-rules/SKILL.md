---
name: avalanche-rules
description: Use when touching anything avalanche, ski touring or freeride in Trail Finder.
---

# Avalanche and ski rules

- Avalanche info must be exact. Better to show nothing than wrong info.
- Show only the danger rating Avalanche Canada gave, for that elevation band, read live from api.avalanche.ca.
  Never raise or lower it by slope, aspect or anything else.
- Problem aspects: diagonal stripes of a darker shade of the same colour, over the band's own colour. Never reuse danger colours for other meanings.
- Any estimate we make (band heights, terrain class) is labelled as an estimate.
- With no forecast, the "Less exposed way" still draws (terrain only), with a warning that no forecast is included
  and why.
- Never show terrain traps, runout zones or steep slopes above a route or spot, in any feature, card, layer or video.
  Avalanche Canada's own wording may still name them.
- Terrain facts only (length, angle, aspect), never travel advice ("one at a time", "don't stop", regroup spots).
- Route or tour planning waits on `tfRiskOk(kind)` and shows `tfRiskLine()` (`risk.js`).
- Freeride lines come only from real GPS tracks, never guessed. Hand-added lines say so on their card, with sources.
- Ski videos end with the liability line.
- Then follow `ship-change`.
