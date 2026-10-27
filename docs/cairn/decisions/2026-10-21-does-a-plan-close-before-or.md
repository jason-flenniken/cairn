---
id: 2026-10-21-does-a-plan-close-before-or
status: active
areas:
  - plan-state
  - plan-location
plan: sharper-interview-and-review
date: 2026-10-21
---

# Does a plan close before or after its merge?

**Decision:** Close first, merge last, so every record lands on main; until the branch is merged, status shows Closed · PR open, detected from the gh PR state or local ancestry.

**Why:** Merging first left closing records off main and could make close refuse forever.
