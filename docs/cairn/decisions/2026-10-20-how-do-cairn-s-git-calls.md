---
id: 2026-10-20-how-do-cairn-s-git-calls
status: active
areas:
  - plan-location
plan: cairn-v0-2
date: 2026-10-20
---

# How do cairn's git calls avoid background maintenance?

**Decision:** Every CLI git call runs with gc.auto=0 and maintenance.auto=false.

**Why:** Background gc raced the next command and caused 1-in-3 test failures.
