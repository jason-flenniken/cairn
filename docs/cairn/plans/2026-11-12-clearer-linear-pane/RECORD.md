# Record: Clearer Linear pane

## Links
- PRD: docs/cairn/plans/2026-11-12-clearer-linear-pane/prd.md
- Plan: docs/cairn/plans/2026-11-12-clearer-linear-pane/plan.md
- PR: (added when opened)
- Tracker: none
- Revert: revert the PR (`git revert -m 1 <sha>` for a merge commit). Nothing else to undo: the board snapshot format is unchanged, and the board JSON only gained fields.

## Why
On the first real Linear project (Savvyling, 87 issues in 11 milestones), the pane's Linear tab was unreadable. Running work was buried mid-list, and 31 of 43 M0 issues showed red as blocked. Every blocker repeated its milestone tag, wrapped lines lost their indent, and nothing named the ticket being built. Most of the "blocked" count came from five blocked-by links set on epics, each holding back every one of the epic's sub-issues.

## What was built
- **Groundwork:**
  - Declared the new board and plan-row fields.
  - Moved the Linear tab's drawing into `hooks/mod/linear.tsx`.
- **The CLI computes the sections:**
  - `cairn linear board` returns a focus milestone, In progress (every running plan, any milestone), Ready to start (sorted by how many open issues each one unblocks), Waiting (one row per epic, naming what it waits on), and a Done count.
  - It also returns warnings for epic-level links that hold back 3 or more sub-issues.
  - The text board prints the same sections.
  - Plan rows carry each task's Linear keys and the plan's epic.
- **The pane draws them:**
  - The Linear tab shows these sections at 46 columns. Blocked work is dim, red marks only a loop, and wrapped rows keep their indent.
  - Agent cards, the plan header and UP NEXT name the ticket (`8 · SAV-66 Move the app…`).
  - Four card fixes from the earlier pane plan: overlapping tool calls, the model on the Main card, the status glyph color when cut, and one position for the inline count line.

## How it works
`cli/src/board.ts` is a pure `buildBoard` over the stored snapshot and every plan's state. It works out the blocker graph, `unblocks` counts by reverse reachability, epic state and `waitsOn`, wide links, and the sections. `commands/linear.ts` `board()` calls it and prints the text. `commands/status.ts` maps each task's covered requirements to the issues tagged with them. The mod reads `cairn linear board --json` and `cairn status --all --json` and only draws. Every Linear string passes through a `clean` that strips escapes, control characters and bidi overrides.

## Findings
- On the real Savvyling board, all 31 blocked M0 issues came from five epic-level links (SAV-20→19, 19→18, 18→17, 17→16, 21→16). The board now names them.
- A link to an epic counts as waiting on each of its sub-issues, so a ready sub-issue's "unblocks" includes those waiters (recorded decision).
- The PRD check found that a plan or ready issue outside the focus milestone would have been hidden. In progress and Ready now span every milestone.
- Task reviews caught epics listed in their first child's order instead of Linear order, and a crash in `--epic` for a parent outside the project. Both were fixed with tests.
- The acceptance check caught the Ready section saying "Nothing ready" when every milestone was done. Fixed.
- The branch review caught:
  - an empty "waits on";
  - a drifted duplicate `ownerOf`;
  - two unused imports;
  - stale README and board.md wording.

  All were fixed.
- Two test problems already on main were fixed on the branch:
  - NFR-07 could no longer pass, because the test kit now fails any test where a render hook throws. It now checks tool calls under unreadable state.
  - Approval tests that leave a question open failed about one run in three, from an unhandled rejection at teardown.
- One builder committed on the plan branch instead of its task branch. The commit was moved before review.
- A stale snapshot showed SAV-10 open after it was done in Linear: the snapshot is stamped at save time, not fetch time. Logged as a follow-up.

## Follow-ups
- Grouped while tidying:
  - five security notes into "harden the Linear tab against outside text";
  - seven test notes into "sharper board and pane tests";
  - six quality notes into "tidy the board and pane code".
- Dismissed: the stale type comments, fixed on the branch.
- The whole-branch security review ran and passed. The user asked to skip it to save time, but it had already finished.
- 5 open recommended follow-ups (1 security, 1 tests, 2 quality, 1 ux): see `/cairn:suggestions`.
- Next: a separate parallelism plan (a "can start alongside" status, several plans at once, starting from an unmerged branch, contract-first splits).
