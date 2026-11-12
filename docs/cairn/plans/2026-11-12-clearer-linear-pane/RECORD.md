# Record: Clearer Linear pane

## Links
- PRD: docs/cairn/plans/2026-11-12-clearer-linear-pane/prd.md
- Plan: docs/cairn/plans/2026-11-12-clearer-linear-pane/plan.md
- PR: (added when opened)
- Tracker: none
- Revert: revert the PR (`git revert -m 1 <sha>`). Nothing else to undo: the snapshot format is unchanged, and the board JSON only gained fields.

## Why
On the first real Linear project (Savvyling, 87 issues), the pane's Linear tab was unreadable. Running work was buried, and 31 of 43 M0 issues showed red as blocked, each blocker tagged with its milestone. Nothing named the ticket being built. Five blocked-by links set on epics caused most of the blocking.

## What was built
- **Groundwork:** declared the new fields, and moved the tab's drawing to `hooks/mod/linear.tsx`.
- **CLI:**
  - `cairn linear board` returns status sections:
    - In progress, covering every running plan;
    - Ready to start, sorted by how many issues each one unblocks;
    - Waiting, one row per epic;
    - a Done count.
  - It also warns about epic links that hold back 3 or more sub-issues.
  - The text board prints the same sections.
  - Plan rows carry each task's ticket keys and the plan's epic.
- **Pane:**
  - The Linear tab draws those sections. Blocked work is dim, red marks only a loop, and wrapped rows keep their indent.
  - Cards, the header and UP NEXT show ticket keys.
  - Four card fixes: overlapping calls, the model on the Main card, the glyph color when cut, and the inline count line's position.

## How it works
`cli/src/board.ts` (`buildBoard`) is pure. Over the snapshot and every plan's state, it computes the blocker graph, `unblocks` by reverse reachability, epic state and `waitsOn`, wide links, and the sections. `commands/linear.ts` prints them as text. `commands/status.ts` maps a task's requirements to the issues tagged with them. The mod reads `cairn linear board --json` and `cairn status --all --json`, and only draws. Linear text passes through a `clean` that strips escapes, control characters and bidi overrides.

## Findings
- On Savvyling, all 31 blocked M0 issues came from five epic-level links. The board now names them.
- A link to an epic counts as waiting on each of its sub-issues, so ready sub-issues get an "unblocks" count (recorded decision).
- The PRD check found that work outside the focus milestone would have been hidden. In progress and Ready now span every milestone.
- Fixed with tests, all before merge:
  - Task reviews: epics came out in their first child's order, and `--epic` crashed for a parent outside the project.
  - Acceptance check: "Nothing ready" showed when every milestone was done.
  - Branch review: an empty "waits on", a drifted duplicate `ownerOf`, unused imports, and stale docs.
- Two tests already failing on main were fixed:
  - NFR-07 could not pass under the current test kit.
  - Approval tests leaked a rejection and failed about one run in three.
- One builder committed to the plan branch. The commit was moved to its task branch before review.
- The stored snapshot showed SAV-10 open after it was done, because the snapshot is stamped at save time, not fetch time. Logged.

## Follow-ups
- Grouped while tidying:
  - five security notes into "harden the Linear tab against outside text";
  - seven test notes into "sharper tests";
  - six quality notes into "tidy the code".
- Dismissed one note, already fixed.
- The user asked to skip the security review, but it had already passed.
- 5 open recommended follow-ups (security, tests, 2 quality, ux): `/cairn:suggestions`.
- Next: a separate parallelism plan.
