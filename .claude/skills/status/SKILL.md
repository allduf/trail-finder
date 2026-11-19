---
name: status
description: Show where Trail Finder work stands - open pull requests, their phone check, a suggested merge order, the last website publish and how fresh the data files are.
allowed-tools: Bash(git status:*), Bash(git log:*), Bash(git fetch:*), Bash(git branch:*)
---

# /status

Read only: change nothing, merge nothing.

1. **Open pull requests** on allduf/trail-finder: number, title, age, and its "phone" check (passed, failed, running,
   or skipped because it only touches `data/`, `ios-app/`, `supabase/` or `.md`). Note any with a merge conflict:
   GitHub runs no checks on those until main is merged in.
2. **Needs alex:** which pull requests wait on alex's yes, which change `ios-app/` or `android-app/` (new app build),
   and which skip the phone check (alex merges by hand or runs "Phone test" on the branch).
3. **Suggested merge order** as a numbered list: smallest and least likely to conflict first, one auto-merge at a time.
4. **Website:** when the last "pages" publish ran on main and whether it passed.
5. **Data:** the date of the latest commit on the `site-data` branch, and any data workflow whose last run failed.
6. Keep it short and plain, one line per item.
