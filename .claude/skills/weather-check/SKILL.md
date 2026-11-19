---
name: weather-check
description: Use when Trail Finder shows any weather, soil, snow or freeze value from a model forecast.
---

# Cross-check every forecast

1. Never use one model alone. Use `wxcheck.js` (`tfWx.getChecked`): the middle value of GEM, ECMWF and GFS from
   Open-Meteo (ICON where a value is missing), and Environment Canada where possible.
2. Show the middle value. When the models disagree, show the range too.
3. Label it "estimate" and name the source.
4. MTB loam: soil at 0 C or colder shows "Frozen", never prime loam, and sends no loam alert (see `mtb-conditions`).
5. Check the value against current real numbers for a known spot (for example Whistler or Mount Fromme) before
   opening the pull request.
