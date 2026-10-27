---
id: 2026-10-21-how-are-plan-and-task-branches
status: active
areas:
  - plan-location
plan: standard-branch-names
date: 2026-10-21
---

# How are plan and task branches named?

**Decision:** Plans use feature/<slug> or fix/<slug>, tasks use task/<slug>/<task>, worktree folders are the branch with / as -, only a plan's recorded branch counts as the plan, and legacy sdlc/ branches still resolve.

**Why:** Standard git names; git forbids feature/x alongside feature/x/task.
