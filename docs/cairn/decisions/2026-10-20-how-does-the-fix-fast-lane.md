---
id: 2026-10-20-how-does-the-fix-fast-lane
status: active
areas:
  - plan-location
  - plan-state
plan: cairn-v0-2
date: 2026-10-20
---

# How does the fix fast lane work?

**Decision:** Fix plans run repro, execute, review, ship, closed; the repro must fail when recorded and pass before done, and a fix over fixMaxFiles (default 8) refuses and offers cairn escalate. Fix plans get the five-axis review.

**Why:** Bugs get repro-first discipline without four approval stops.
