# PRD: Standard branch names

> Plan: standard-branch-names. Keep it short. Every requirement has a stable id and a one-line acceptance check.

## Problem
cairn names its branches `sdlc/<slug>` for plans and `sdlc-task/<slug>/<task>` for tasks. These names don't follow common git conventions. In a branch list, a PR, or a teammate's terminal they read as tool plumbing rather than "a feature" or "a fix".

## Solution
New plans get standard branch names chosen from the plan's track: `feature/<slug>` for feature plans and `fix/<slug>` for bug-fix plans. Task branches move to `task/<slug>/<task>`, because git can't hold `feature/x` and `feature/x/task` at the same time. Worktree folders follow the branch name.

A branch counts as a cairn plan only when it carries the plan's files, so your own hand-made `feature/` branches are left alone. Existing `sdlc/` plans keep working under their old names.

## Requirements
- **FR-01** `cairn new <slug>` on the feature track creates the plan on branch `feature/<slug>`, in worktree folder `.claude/worktrees/feature-<slug>`. Check: a new plan's `git branch --show-current` in its worktree prints `feature/<slug>`.
- **FR-02** A fix-track plan (`cairn new <slug> --track fix`, used by `/cairn:fix`) uses branch `fix/<slug>` and folder `fix-<slug>`. Check: the same test on a fix plan prints `fix/<slug>`.
- **FR-03** `cairn task start <id>` creates branch `task/<slug>/<id>`, in a folder named after the plan folder plus `--<id>`. Check: the printed branch and path match, and `task done` merges and deletes it as today.
- **FR-04** Every place that lists plans includes plans on `feature/`, `fix/`, and legacy `sdlc/` branches: `cairn status --all`, `cairn suggest list`, and the pane. A branch is listed only when it holds the plan's state file. Check: a hand-made `feature/other` branch with no plan files doesn't appear in `cairn status --all`.
- **FR-05** On `feature/<slug>`, `fix/<slug>`, or `task/<slug>/<task>` (or legacy `sdlc/…` and `sdlc-task/…`), the CLI works on that plan. On a hand-made branch with no plan files, it behaves as on main: index view, and `cairn new` is allowed. Check: on `feature/other`, `cairn status` prints the index of all plans.
- **FR-06** Plans recorded on old names (`sdlc/<slug>`, `sdlc-task/…`, `sdlc-<slug>` folders) continue through every stage, pause, resume, and close under those names. Lookups use the branch name recorded in the plan. Check: this plan (`sdlc/standard-branch-names`) finishes and closes, and the closed v0.2 plan still appears in `cairn status --all`.
- **FR-07** `cairn new` refuses a slug already used by any plan on any prefix (`feature/`, `fix/`, `sdlc/`). Check: creating `fix/x` when `feature/x` is a plan is refused with a message naming the existing plan.
- **FR-08** The pane picks up newly created or deleted plans on the new prefixes within a few seconds, as it does today for `sdlc/`. Check: after `cairn new`, the pane lists the plan without a reload.
- **FR-09** The README, the CLI reference (`references/cli.md`), and the procedures that name branches (new, execute, ship) use the new names. Check: `grep -rn "sdlc/<slug>\|sdlc-task/" README.md plugins/cairn/procedures plugins/cairn/references` finds only notes about legacy plans.

## Non-goals
- A configurable branch prefix, because feature/ and fix/ are the standard, and a config key is code nobody asked for.
- Renaming existing branches, because two old plans don't justify a migration; they finish under their old names.
- Changing remote push or PR conventions beyond the branch name, because that is out of scope for naming.

## Open questions
- [x] Task branch shape? (answer: `task/<plan>/<task>`)
- [x] Old `sdlc/` plans? (answer: keep them readable, no rename)
- [x] Worktree folders? (answer: named after the branch, slash to dash)
