---
id: 2026-10-21-how-do-late-stage-status-words
status: active
areas:
  - plan-state
  - live-pane
plan: pane-status-bar-and-polish
date: 2026-10-21
---

# How do late-stage status words stay accurate?

**Decision:** The CLI records the current check, review or ship step with cairn step, cleared on advance, and status JSON carries the wording every surface renders.

**Why:** Surfaces kept their own copies and showed the wrong stage after restarts.
