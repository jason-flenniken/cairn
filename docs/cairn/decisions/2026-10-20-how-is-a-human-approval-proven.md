---
id: 2026-10-20-how-is-a-human-approval-proven
status: active
areas:
  - approvals
plan: cairn-v0-2
date: 2026-10-20
---

# How is a human approval proven?

**Decision:** The mod watches the tagged approval menu and runs cairn approve with a one-time secret; without the mod, --human works only at a real terminal with the typed plan name. The model cannot approve, override, or write plan state.

**Why:** Keeps one-click approval while stopping the model from approving by mistake or drift.
