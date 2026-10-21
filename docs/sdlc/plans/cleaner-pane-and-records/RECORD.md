# Record: Cleaner pane and records

> Hard budget: 500 words. User-visible outcomes first. Terse.

## Links
- PRD: docs/sdlc/plans/cleaner-pane-and-records/prd.md
- Plan: docs/sdlc/plans/cleaner-pane-and-records/plan.md
- PR: pending
- Tracker: none

## Why
The pane was hard to read: cards changed height on every tool call, and a follow-up count nobody could act on kept growing. Plan folders did not sort by date. The pane now has tabs and steady cards, follow-ups stay few, and the record writes its own findings.

## What was built
- Readable Now tab and dated folders: Now shows Main session first, then bordered 3-line cards in the stage's color, and the whole card is clickable. New plans live in `YYYY-MM-DD-<slug>/`, and commands find plans under either name.
- Approval hook fixes: Revise then Approve records the approval; malformed questions pass through; waiting text and the approval card share one ready value.
- Few follow-ups and automatic findings: a plan closes with at most 5 open follow-ups, merged at close. Discovery offers follow-ups matching researched files. They expire after two declines or 60 days. Learn asks nothing, and `cairn close` requires a Findings section.
- History tab: the full timeline, newest first.
- Records tab: every plan newest first, in progress on top. Clicking one opens it, with Back.

## How it works
The CLI (`plugins/cairn/cli/src`) holds state, follow-up rules and a `records` command (`commands/records.ts`) that lists plans. Plan folders resolve through the main checkout, so old branches still find their records. The pane (`plugins/cairn/hooks/mod/pane.tsx`) renders three tabs from CLI output. Approval hook: `hooks/mod/approve.ts`.

## Findings
- One builder committed in the plan's own worktree instead of its task worktree; the commit was moved to the task branch before merge. Later briefs warned against it.
- The approval-fix plan said a typed "yes" does not approve, contradicting the existing rule. The builder caught it; the test was reworded.
- The agent feed kept only 8 finishes; raised to 200 for History.
- Review found renaming folders on main would hide old records while old branches exist. Records now resolve through the main checkout.
- Review found the one-time grouping of old follow-ups had no step; done by hand at ship.
- No task tried the transparent background; it became a follow-up.

## Follow-ups
- Deferred: renaming existing plan folders (this one too) to dated names runs on main right after merge, with the new build, since the running cairn is main's copy until then.
- Resolved here: 3 approval-hook items from Standard branch names.
- Grouped 31 follow-ups (14 from this plan, 17 from Standard branch names) into 5: tests breadth (12 merged), flaky test run inside task done, follow-up bookkeeping hardening (5 merged), pane and approval polish including the transparent background (4 merged), fix-track and old-plan docs (4 merged).
- Dropped as trivia: Read all caching (performance), a status.ts code-clarity note.
- 5 open recommended follow-ups: run /cairn:suggestions.
- Final run: 163 CLI and 354 mod tests pass; one requirement is met but untested.
