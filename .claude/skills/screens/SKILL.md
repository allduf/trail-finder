---
name: screens
description: Take before and after screenshots at iPhone size for the current Trail Finder branch.
argument-hint: "[screen or sport to capture]"
---

# /screens

Screens: $ARGUMENTS (default: every screen the branch's diff changes).

Follow the `phone-screenshots` skill. Read `git diff origin/main...` to find the screens a change touches, capture main
and the branch at 430x932, check each shot (nothing cut off, no emoji, liability-safe wording), and show the pairs.
