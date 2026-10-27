---
id: 2026-10-20-how-is-the-mod-s-session
status: active
areas:
  - live-pane
plan: cairn-v0-2
date: 2026-10-20
---

# How is the mod's session-start work wired?

**Decision:** register.tsx registers one session.start fan-out that calls each module in order.

**Why:** The engine allows only one unmatched session.start hook per module.
