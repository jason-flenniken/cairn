---
id: 2026-10-21-should-the-pane-set-a-transparent
status: active
areas:
  - live-pane
plan: sharper-interview-and-review
date: 2026-10-21
---

# Should the pane set a transparent background?

**Decision:** No. Claude Code paints the docked pane, so the mod sets no backgroundColor; don't retry it.

**Why:** It changed nothing and the pane API has no transparency setting.
