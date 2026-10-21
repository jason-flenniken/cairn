# PRD: Cleaner pane and records

> Plan: cleaner-pane-and-records. Keep it short. Every requirement has a stable id and a one-line acceptance check.

## Problem
The pane is hard to read. Agent cards grow and shrink by a line on every tool call, so the whole pane jumps. The timeline takes a lot of space. The Main session card sits at the bottom. Only a card's title line is clickable. The pane shows a "suggestions" count that nobody can act on, and one plan left 17 of them, which will bury anything useful as plans pile up. At the end of a plan the user is asked "Anything worth remembering?" when the system should write that down itself. Plan folders are named by slug only, so they don't sort by date, and there is no easy way to browse what was built and when.

## Solution
The pane gets three tabs: Now, History and Records. Now shows the plan header and progress in the current stage's color, then fixed-height bordered cards with Main session first, and the whole card clickable. History holds the full timeline. Records lists every plan, newest first, and opens a plan's record in place. Follow-ups stay few and high level: at most 5 per plan, grouped when a plan closes, offered again only when a new plan touches the same files, and closed after two declines or 60 days. The record of a plan gets a Findings section written automatically, with no question. Plan folders start with the plan's start date.

## Requirements

### Now tab
- **FR-01** The pane opens with a tab row (Now, History, Records) and shows Now by default; clicking a tab switches to it. Check: a render test clicks each tab and sees its content.
- **FR-02** The Main session card is always the first card on Now. Check: a render test with two working agents shows Main session above both.
- **FR-03** Agent cards are bordered and always 3 lines inside: title and model, status (working, time, steps), and an activity line that is blank when there is no current action. Check: a render test shows the same card height before, during and after a tool call.
- **FR-04** Clicking anywhere on a card switches the main view to that agent; the Main session card switches back to the main conversation. Check: a render test presses each line of a card and sees a view request for that agent.
- **FR-05** Each stage has one color, and the header, progress bar and borders of working cards use it. Check: a render test per stage sees the stage's color on all three.
- **FR-06** Now no longer shows the timeline or a follow-up count. Check: a render test of an active plan finds neither.

### History and Records tabs
- **FR-07** History shows the current plan's full timeline (plan events and agent activity), newest first. Check: a render test with 12 events shows all 12, newest at the top.
- **FR-08** Records lists plans newest first, each with its date, name and a one-line why; plans still in progress are at the top, marked in progress. Check: a render test with two closed plans and one active plan shows them in that order.
- **FR-09** Clicking a record shows the full record in the pane, including the follow-ups that plan left, with a Back button to the list. Check: a render test opens a record, sees its sections, presses Back and sees the list.

### Follow-ups
- **FR-10** A plan can close with at most 5 open follow-ups. Before closing, related follow-ups are grouped into high-level items (for example many missing-test notes become "add more detailed tests for the pane"), duplicates are merged and trivia dropped; what was dropped is listed once in the record's Follow-ups section. Check: closing a plan with 8 open follow-ups is refused until at most 5 remain; the record lists the dropped ones.
- **FR-11** Discovery offers the open follow-ups whose files overlap the files the research finds, in one multi-pick question. Picked ones become requirements in the PRD and are closed as brought into the plan; the others count as declined once. Check: a CLI test finds the follow-ups matching a set of paths; picking one closes it, and the rest show one decline.
- **FR-12** A follow-up declined twice, or older than 60 days, closes on its own and is marked expired. Check: a CLI test with one declined twice and one 61 days old lists neither as open, both as expired.
- **FR-13** The follow-ups already open from earlier plans are grouped once into at most 5 items. Check: the follow-up list shows at most 5 open after this plan.

### Findings
- **FR-14** The learn stage asks nothing. The record gets a Findings section, written automatically from the plan's log: escalated tasks, repeated review findings, failed checks, scope added mid-plan, and anything surprising. Check: closing a plan raises no question, and `cairn close` refuses a record without a Findings section.

### Plan folders
- **FR-15** New plans live in `docs/sdlc/plans/YYYY-MM-DD-<slug>/`, dated by the plan's start; branch names keep the plain slug. Check: `cairn new demo` creates `docs/sdlc/plans/<today>-demo/` on `feature/demo`.
- **FR-16** Existing plan folders, this plan's included, are renamed to the dated form, and every command and the pane still find plans under either name, including on old branches that carry the old folder name. Check: after the rename, `cairn status --all` lists every plan, and resume works for a plan on a branch with the old folder name.

### Approval hook
- **FR-17** On a stop tagged twice, answering Revise and then Approve records the approval. Check: a hook test sends Revise then Approve and the approval is recorded.
- **FR-18** The approval hook lets any malformed question through untouched. Check: a hook test with a question payload that is not a list passes through without error.
- **FR-19** The pane's waiting text comes from the same ready value as the approval card, so the two can't disagree. Check: a render test with no ready value shows neither the card nor waiting text.

## Non-goals
- A transparent pane background, because Claude Code draws it and the pane API has no setting for it; the build tries once, and logs a follow-up if it's ignored.
- Acting on follow-ups inside the pane, because they now come up in discovery, where they can become requirements.
- A separate learnings log, because findings live in each plan's dated record.
- Time in folder names, because the date is enough to sort.
- Closing an already-open chat approval question from the pane, because no API for it was found (declined follow-up).
- Pane tests on real status output, declined this time.

## Open questions
- [x] Pane structure (answer: tabs inside the pane: Now, History, Records)
- [x] Card style (answer: bordered, fixed 3 lines, stage colors)
- [x] Follow-up volume, resurfacing and expiry (answer: 5 per plan grouped at close; offered in discovery; expire after two declines or 60 days)
- [x] Where findings go (answer: a Findings section in RECORD.md, no question)
- [x] Folder names (answer: YYYY-MM-DD-<slug>, old folders renamed)

## Unhappy paths
- [FR-08] With no records yet, Records says "No finished plans yet."
- [FR-09] A closed plan whose record is missing shows "No record for this plan."
- [FR-16] A plan found under both an old and a dated folder name is listed once.
