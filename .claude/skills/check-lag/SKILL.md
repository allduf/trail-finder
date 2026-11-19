---
name: check-lag
description: Measure 3D map lag and memory in Trail Finder at iPhone size, main against the current branch.
argument-hint: "[sport] [place]"
---

# /check-lag

What to check: $ARGUMENTS (default: Skiing, 3D, Whistler).

1. Run `bash scripts/site-data.sh get`, then serve main and the branch on two local ports.
2. Open each at iPhone size (430x932, touch on) with `?lagcheck` in the address. That turns on the lag readout in
   the 3D corner (`map3d.js`, "lag check"): worst frame of the last 4 s, long tasks, ground repaints, new paint
   buffers, tiles in by source, readPixels, crisp rebuilds, paint buffer MB.
3. Turn on 3D, go to the place, wait for the ground to finish loading, then turn and tilt the map the same way on both
   (the same scripted drag for main and branch). Read the readout after each turn.
4. For memory over time, run the soak test short: `MINUTES=8 node scripts/soak-test.mjs`. It fails if memory keeps
   climbing. Only one soak test at a time.
5. Report main against branch side by side: worst frame (ms), long tasks, repaints per frame, memory trend.
6. Say plainly that a cloud container draws 3D in software (SwiftShader), so its times are much slower than a phone's.
   Compare main with the branch, never with a phone's numbers.
