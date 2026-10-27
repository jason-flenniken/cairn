---
id: 2026-10-20-where-does-the-orchestrating-session-run
status: active
areas:
  - procedures
plan: cairn-v0-2
date: 2026-10-20
---

# Where does the orchestrating session run?

**Decision:** At the repo root, not locked into a worktree, running cd <plan worktree> && cairn …; subagents edit and commit in task worktrees.

**Why:** A worktree-locked session blocked its subagents from committing in task worktrees.
