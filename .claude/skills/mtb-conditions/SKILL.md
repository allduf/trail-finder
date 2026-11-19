---
name: mtb-conditions
description: Use when building or changing MTB trail conditions in Trail Finder - loam index, frozen ground, snow, freeze line, loam alerts.
---

# MTB trail conditions rules

- Loam index comes from Open-Meteo soil moisture: 0-19 Dry, 20-39 Tacky, 40-59 Damp = prime loam, 60-79 Wet and
  muddy, 80-100 Saturated.
- Snow 5 cm or more: show "Snow", never prime loam.
- Soil at 0 C or colder (surface or 6 cm): show "Frozen", never prime loam, no loam alert.
- Frozen overnight but above 0 C in the afternoon: keep the index and add a thaw note, labelled as a model estimate.
- Freeze line by height: the middle of ICON, GFS and GEM, with the model range when they disagree, at 7 AM and 1 PM
  for each day (`weather-check`).
- Apply the same rules everywhere: map colours, lists, trail card, forecast days, "Where to ride today", bike trips
  and phone alerts.
- Wording: "estimate", name the source, never promise conditions (never "dry" as a promise).
- Suggested loops start and end at a public parking lot and never use bike park (lift-access) trails.
- Unofficial trails are hidden from signed-out users.
- Then follow `ship-change`.
