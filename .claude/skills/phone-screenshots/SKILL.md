---
name: phone-screenshots
description: Use before opening any Trail Finder pull request that changes what users see, to capture before and after screenshots at iPhone size.
---

# Before and after screenshots at iPhone size

1. Serve the app locally from main (before) and from the branch (after), each on its own port.
   Run `bash scripts/site-data.sh get` first so the data files are there.
2. Use a headless browser at iPhone 15 Pro Max size: 430x932, device scale 3, touch on, iPhone user agent.
3. Open the exact screen the change touches: same sport, same place, same zoom and layers. Wait for the map tiles and
   data to finish loading.
4. Take one before and one after shot of each changed screen. Add a French shot if the change has new text.
5. Check each shot: nothing cut off, no overlap, readable text, no emoji in the interface, liability-safe wording.
6. Name the files `1-before-<what>.png` and `1-after-<what>.png`. Keep them out of the repo.
7. Put them in the pull request description and show them to alex with the pull request.
8. If a screen can't load (blocked data source), say so plainly instead of sending an empty map.
