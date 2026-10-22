# Record: Pane status bar and polish


## Links
- PRD: docs/sdlc/plans/2026-10-21-pane-status-bar-and-polish/prd.md
- Plan: docs/sdlc/plans/2026-10-21-pane-status-bar-and-polish/plan.md
- PR: (added at ship)
- Tracker: none

## Why
The pane said "all phases done" while review was still running, hid spend and usage limits, ignored clicks on agent cards, and could not scroll to the end of long documents. This plan makes it accurate enough to rely on.

## What was built
- Pinned bar and late-stage steps: every tab shows a bottom bar with the plan's stages (done, active, upcoming). `cairn step` records what check, review and ship are doing, such as "Review · fixing 3 findings".
- Fill the pane: the bar adds model, plan cost this session, context, tokens, and 5-hour and weekly usage (warning colors near the limit). The header, `cairn status` and the status line show the step and "N running" instead of "all phases done". Agent cards show live tokens and a "~$" estimate. Read all opens one full-height viewer with Back and Approve for the PRD, plan, ship record and Records entries.

## How it works
The old pane file is split into `pane.tsx` (tabs, routing), `header.tsx`, `cards.tsx`, `approval.tsx`, `doc.tsx` and `bar.tsx` in `plugins/cairn/hooks/mod/`. The bar sits at the bottom of the pane's scroll window and moves on each scroll. `usage.ts` reads Claude Code's usage events; `prices.ts` holds the price table. `cairn step` writes a validated step into plan state, cleared on advance, and the CLI sends the step wording in `status --json` so the pane keeps no copy.

## Findings
- Decision during build: the ship "merging" step was dropped, because the merge runs after the plan closes and could never be recorded. The PRD still lists it.
- Card click cause (best-supported, not confirmed live): each row was a button sized to its text, so clicks on blank space hit nothing. Rows are now full-width.
- 4 of 7 tasks needed one fix attempt each: inline 7-row budget, the unrecordable merging step, card rows hard-coded to 42 columns, and two tests that did not test what they claimed. One merge conflict in `pane.tsx` was resolved by hand.
- Whole-branch review: 2 Required fixes (inline pane overflowed with 3 agents or a second plan; the pane kept its own copy of the step wording), plus a bar redraw on close and tab switch. Security review passed, with optional hardening logged.
- A pre-existing test flake was fixed: approval tests read results before the real hash finished.
- Check stage: 210 CLI and 422 mod tests pass, build clean, secret scan clean, npm audit 0 vulnerabilities. Requirements: 16 met, 3 met but untested.
- The installed cairn predates the previous merge, so the new security-reviewer agent was not registered. Reviews ran as general agents following the repo's reviewer definitions, and `cairn step` ran from the plan's own CLI bundle.

## Follow-ups
- Live checks pending with you before ship: the bar stays at the bottom while scrolling, clicking a card opens the transcript, the viewer reaches the last line.
- Dismissed as done in the review fix: shared step wording; inline row budget.
- Resolved: the intermittent pane test failure. 20 other follow-ups were merged into 4 grouped items.
- 5 open recommended follow-ups (1 tests, 1 security, 1 quality, 1 ux, 1 docs): run /cairn:suggestions. Topics: tighter tests for steps, scrolling and approvals; strip control characters from outside text and refuse Approve on a changed or truncated doc; `cairn suggest` refusing `--from security-review`, which the procedures use; inline worst case still 8 rows; refresh the price table.
