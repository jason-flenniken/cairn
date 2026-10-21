# Record: Roomier pane visuals

## Links
- PRD: docs/sdlc/plans/2026-10-21-roomier-pane-visuals/prd.md
- Plan: docs/sdlc/plans/2026-10-21-roomier-pane-visuals/plan.md
- PR: https://github.com/jason-flenniken/cairn/pull/1
- Tracker: none

## Why
The cairn pane was hard to scan: text sat flush against the left edge, tabs stacked lines with no gaps, and the body was drawn black. Two approval rough edges also remained: a stop revised twice left two "not approved" notes, and approving in the pane left the chat approval question open. This plan makes the pane roomier and fixes both.

## What was built
- Roomier pane and approval polish (one phase, two tasks run in parallel):
  - Pane padding and spacing: every docked tab and the inline fit now has a 1-column margin on both sides. Docked tabs get a blank line under the tab row, between Now sections and cards, and between Records rows and detail parts. The History timeline, the 3-line session cards and the inline fit stay compact. The progress bar fits the padded width. The root box also asks for a transparent background.
  - Approval note and open question: a stop revised twice now gets one "not approved" note. Approving a stop (in the pane or with the approve command) answers an open chat approval question for that stop early.

## How it works
Layout lives in the pane render hook (`plugins/cairn/hooks/mod/pane.tsx`) and uses only Box props (side padding, gap, margin), never spacer text, because tests count text elements. The test harness doesn't paint rows, so spacing and padding are tested as Box props. The approval changes are in the question hook in `plugins/cairn/hooks/mod/approve.ts`. A registry of open tagged questions, keyed by kind and slug, lets `approveAs` signal the waiting hook after a recorded approval. The hook races the chat question against that signal and answers like the existing already-approved shortcut. Skip notes are collected per stop and written once.

## Findings
- Verify pass: 364 tests passing, build ok. 10 of 12 requirements are met with tests. 2 are met pending a by-eye check after ship (background, chat question closing).
- Review pass: 0 blocking, 7 non-blocking notes.
- Two tasks ran in parallel. The approval task was marked risky and reviewed once with no blocking findings. No fix attempts, nothing escalated.
- Scope added mid-discovery: an earlier plan's recommended follow-up for pane and approval polish (transparent background try, one note per stop, closing the open chat question).
- The transparent background is a best guess (`transparent` on the docked root box). The pane API documents no such value.
- Whether the open chat question visibly closes when the mod answers early is unverified live.

## Follow-ups
- By-eye check after reinstalling cairn: the pane background and the chat question closing. If either fails, remove the background setting, or add a note under the open question (recommended follow-up).
- Deferred requirements: none. Accepted as is: none.
- Dropped while tidying, merged into two grouped items:
  - Five test gaps into one tests item: Records row gap, docked background prop, Now root order with two cards, row-level blank-line check, and approval cases (two stops, another stop of the same plan, unhandled-rejection check).
  - Five approval tidy-ups into one quality item: registration race, map re-parsing the key, declaration order, misleading note when Revise races a pane approval, early-answer wording.
- 4 open recommended follow-ups (1 tests, 1 quality, 2 ux): run /cairn:suggestions
