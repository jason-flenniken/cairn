---
id: 2026-10-20-how-do-pause-and-resume-work
status: active
areas:
  - live-pane
  - plan-state
plan: cairn-v0-2
date: 2026-10-20
---

# How do pause and resume work?

**Decision:** Pause is instant: the mod writes handoff.md and runs cairn pause, even mid-turn. Resume continues in place inside the cache window; after that the user runs /clear then /cairn:resume, which loads only state, handoff and status.

**Why:** A complete handoff makes the expensive old conversation disposable.
