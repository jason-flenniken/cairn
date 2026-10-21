# Record: Sharper interview and review

## Links
- PRD: docs/sdlc/plans/2026-10-21-sharper-interview-and-review/prd.md
- Plan: docs/sdlc/plans/2026-10-21-sharper-interview-and-review/plan.md
- PR: <pending>
- Tracker: none

## Why
cairn's interview never asked what a build was for, review looked only at risky tasks and said little about readability or architecture, and security showed up only at review time. A plan could also show Closed while its pull request sat unmerged. This plan makes the interview goal-first, reviews every task on five labelled axes, and runs security from design to ship.

## What was built
- Interview and checklists: discover opens with a guess and a confidence number, asks goal questions one at a time, proposes decisions the goal implies, and ends with a read-back card that needs an explicit yes (two revisions at most, then it offers to step back). Review and security checklists were added, with a read-only security reviewer, an ask-first list for implementers.
- Close rule: `cairn close` no longer waits for the merge. The merge comes last, and status and the pane show "Closed · PR open" until the branch is in main.
- Wiring: every task is reviewed, and risky ones also go to the security reviewer. Critical and Required findings are fixed before merge; Optional and Nit are logged as follow-ups. The PRD gets a short threat model, the risky list is wider, and the check stage scans for secrets, runs the native dependency audit and reviews lockfile changes.
- Pane: the docked background setting was removed, the fallback and tip lines truncate, and a toast says so when a stop is approved in the pane while its question is open.

## How it works
Most of the change is markdown that the orchestrator and agents read: `plugins/cairn/procedures/*.md`, `agents/*.md` (including the new `security-reviewer.md`), `references/review-checklist.md` and `references/security-checklist.md`, and the templates. The CLI change is in `cli/src/commands/stages.ts` (close checks) and `cli/src/render.ts` (the "PR open" label). Pane changes are in `hooks/mod/pane.tsx`.

## Findings
- The earlier transparent-background plan was marked Closed while its PR #1 was unmerged. PR #1 was merged during this plan. After reinstalling, the pane was still grey, so the transparent setting was removed. Claude Code paints the docked pane.
- A haiku implementer committed the pane task straight onto the plan branch. The commit was moved to its task branch and merged normally.
- Acceptance check: 20 requirements met, 2 met but untested (logged), 1 not met (the read-back card had no revision cap). Fixed on the plan branch.
- The whole-branch review (five-axis plus the security reviewer) found 1 Critical and 6 Required. The Critical: close-only-when-merged deadlocked, because bookkeeping commits after the merge made the branch look unmerged. Required: squash merges never counted; the pane notice was never visible; a base branch name could inject options into `git fetch`; the secret scan could print values; the pip audit command installed packages. All were fixed in one pass, and the user chose the "Closed · PR open" redesign.
- Pre-ship scans: no secrets, 0 `npm audit` vulnerabilities, no lockfile changes. Tests: CLI 197 pass, mod 368 pass.

## Follow-ups
- Dismissed as already done (4): the security-reviewer dispatch doc check, squash and rebase merges, a dash-prefixed base name, and network-free status.
- 10 other follow-ups were merged into the grouped items below.
- 4 open recommended follow-ups (1 tests, 1 ux, 1 docs, 1 quality): run /cairn:suggestions. Topics: tighter close and pane tests, "PR open" polish, procedure wording, refusing a task done when the plan branch gained commits outside a task merge.
