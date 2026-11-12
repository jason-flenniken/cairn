# PRD: Clearer Linear pane

> Plan: clearer-linear-pane. Keep it short. Every requirement has a stable id and a one-line acceptance check.

## Problem
On a real Linear project, the pane's Linear tab can't be read. Savvyling has 87 issues in 11 milestones, and 43 of them are in M0. The tab lists every milestone → epic → issue, so the one epic being built (SAV-16) sits in the middle of the list. Blocked issues are drawn red, and in M0, 31 of 43 are blocked, so most of the tab is red. Every blocker carries a `[milestone M0 Foundations]` tag, even when it is in the same milestone. Wrapped lines start at column 0. Nothing separates one epic from the next.

Most of the "blocked" count comes from a few links. A blocked-by link on an epic applies to every one of its sub-issues. On Savvyling, five epic-level links (SAV-20→19, 19→18, 18→17, 17→16, 21→16) account for all 31 blocked M0 issues, and nothing on screen says so. Agent cards and the plan header don't name the Linear ticket being built.

## Solution
The Linear tab is organized by status, and it fits the docked pane (46 columns). From the top, it shows:
- the project and how old the read is;
- one line per milestone, with full progress for the first unfinished milestone;
- **In progress**: each running plan with its issues;
- **Ready to start**: each ready epic or issue, with how many open issues are waiting on it;
- **Waiting**: one line per epic, saying what it waits on;
- **Done**: a count;
- warnings.

Blocked work is drawn dim. Red is kept for a loop in the blocked-by links. When an epic's own link holds back several sub-issues, the tab says so and suggests linking only the sub-issues that need it.

The CLI works out all of these sections. `cairn linear board` prints them in the same order the pane draws them.

Agent cards show the ticket key before the task name (`8 · SAV-66 Move the app…`). The plan header shows the epic key, and UP NEXT shows each task's key.

Four card fixes from an earlier plan are included:
- overlapping tool calls;
- the Main card's empty second row;
- the status glyph color when cut;
- the inline count line moving around.

## Requirements

### Board data (`cairn linear board --json`)

**Same-milestone tags (FR-01).** A blocker is tagged with where it sits only when that differs from the blocked issue:
- another plan: `plan <slug> (<stage>)`;
- another milestone: `milestone <name>`;
- another project: `another project`.

A blocker in the same milestone and not in a plan has no tag (`where` is absent).
- Check: a test board with a same-milestone blocker prints `blocked by SAV-2` with no bracket. A blocker in another milestone still prints `[milestone M1]`.

**Unblocks count (FR-02).** Every open issue that isn't blocked (ready or in a plan) gets `unblocks`. It counts the open issues that wait on it, directly or through a chain of blockers, using the same blocker rule the board uses today (a parent's links apply to its sub-issues). Each issue is counted once.
- Check: in the chain A ← B ← C (B waits on A, C waits on B) plus D waiting on A, A has `unblocks: 3`.

**Epic status (FR-03).** Each epic gets:
- `state`: `active` when any sub-issue is in a plan; `done` when all are done; `ready` when every open sub-issue is ready; `waiting` otherwise.
- `waitsOn`: the keys of open blockers of its sub-issues that are outside the epic.
- `unblocks`: open issues outside the epic that wait on any of its sub-issues, through chains, each counted once.
- Check: epic E2 has its own link "blocked by E1", where E1 is an open epic, and one sub-issue of E2 waits on a sibling. E2 has `state: "waiting"` and `waitsOn: ["E1"]`; the sibling is left out because it is inside the epic. An epic with one sub-issue in a plan has `state: "active"`.

**Wide epic links (FR-04).** The board returns `wideLinks: [{ epic, on, holds }]`. There is one entry for each blocked-by link set on the epic itself (not inherited from a grandparent) that points at an issue that isn't done, while the epic has 3 or more open sub-issues. `holds` is that number of open sub-issues.
- The text board prints one line per entry: `SAV-19's blocked-by link to SAV-18 makes all 9 of its open issues wait. Link only the sub-issues that need SAV-18.`
- Check: an epic with 3 open sub-issues and its own link appears. With 2 it does not. A link only on a sub-issue never appears.

**Sections (FR-05).** The board returns:
- **`focus`**: the first milestone in Linear order that isn't all done, or none when all are done.
- **`milestones`**: one row per milestone, with its name and counts (as today). Issues with no milestone form a last `No milestone` row.
  - Every milestone except the focus also has `waitsOn`: the keys of open blockers outside that milestone.
- **`inProgress`**: every plan that owns board issues and isn't closed, whatever milestone the issues are in. Each has slug, stage, the plan's epic key and title when the plan has one, done/total over its issues on the board, and its issues (key, title, and progress as `issueProgress` gives it).
- **`ready`**: ready epics, then ready issues that aren't inside a ready epic, from every milestone. This includes a ready issue inside an active or waiting epic.
  - Each row has its milestone.
  - Sorted by `unblocks`, highest first, then Linear order.
- **`waiting`**: the focus milestone's waiting epics, then its waiting issues that aren't inside an epic, in Linear order.
- **`done`**: the count of done issues on the board.

`readyEpics` stays in the JSON. Every list of keys (`waitsOn`, `blockedBy`) is in Linear order.
- Check: on a two-milestone test board with a plan owning a second-milestone issue and a ready issue in the second milestone:
  - `focus` is the first milestone;
  - the plan is in `inProgress`;
  - the ready issue is in `ready` with its milestone;
  - only the first milestone's waiting rows are in `waiting`;
  - the second milestone row carries `waitsOn`.

**Text board (FR-06).** `cairn linear board`, without `--json`, prints the same sections in the same order, as plain text (no colors; dim and red apply to the pane only):
1. header;
2. milestones;
3. In progress;
4. Ready to start;
5. Waiting;
6. Done;
7. later milestones;
8. warnings.

`--epic KEY` still lists that epic's issues in full.
- Check: a test asserts the line order of the text output.

### Plan rows (`cairn status --all --json`)

**Ticket keys per task (FR-07).** A plan row whose plan pulled in Linear issues carries:
- `taskIssues`: each task name mapped to the keys of the issues not released from the plan whose requirements include any requirement the task covers, in the order the plan pulled the issues in;
- `epic`: the epic key the plan recorded when it pulled in issues (`state.linear.epic`), when it has one. A plan started from a milestone or a list of issues has none.

Plans without Linear issues carry neither field.
- Check: a plan whose task covers requirements tagged `[SAV-1]` and `[SAV-2]` maps that task to `["SAV-1", "SAV-2"]`. A plan with no Linear link has no `taskIssues` key.

### Pane: Linear tab

**Tab header (FR-08).**
- Line 1: the project and the read age.
- Then the focus milestone: its name, a progress bar, and done/total.
- Then one line per later milestone: name, done/total, and `waits on <keys>` (dim). Show at most 3 keys, then `+N`.
- A milestone that is all done is one `✓ <name>` line in green.
- Check: a mod test with three milestones (one done, the focus, one later) draws them in that form.

**In progress section (FR-09).** It starts with `▶ IN PROGRESS` and draws every plan in the board's `inProgress`.
- Each running plan shows behind a left `┃` rule in the accent color:
  - its epic key and title, or the plan title;
  - `<slug> · <stage> · <done>/<total>`;
  - its issues, `◐` for in progress or built and `·` for not started. Show up to 4, then `+N more`.
- Check: a plan with 6 issues draws 4 issue lines and `+2 more`.

**Ready section (FR-10).** It starts with `○ READY TO START`. Each ready epic or issue is one row: key and title, with `unblocks N` when N > 0, and its milestone (dim) when it isn't the focus milestone. Rows follow the board's order. When nothing is ready, the section is the line `○ Nothing ready: everything open waits on work in progress or blocked`.
- Check: two ready issues draw in `unblocks` order. One with 0 has no `unblocks` text. One from a later milestone shows that milestone's name.

**Waiting section (FR-11).** It starts with `· WAITING`, drawn dim. Each waiting epic is one row: `KEY Title  done/total  on <keys>` (at most 3 keys, then `+N`), with its sub-issues not listed. Waiting issues outside an epic are one row each, `on <keys>`.
- Check: an epic with 9 waiting sub-issues draws one row, and no sub-issue key appears in the tab.

**Done and warnings (FR-12).**
- `✓ DONE <n> issues` is drawn in green.
- Warnings follow:
  - stalled plans (no change in over a week, as the board marks them today), in yellow;
  - wide links, in yellow, worded as in FR-04;
  - a loop in the blocked-by links, in red.
- No other text in the tab is red.
- Check: the mod test finds red only on the loop line.

**Indented wrapping (FR-13).** Every indented row is laid out with box padding, not leading spaces, so a wrapped row's second line starts at the row's indent.
- Check: a mod test with a title longer than the pane width finds the wrapped line starting at the row's indent.

**Empty and refused states (FR-14).** These keep today's behavior: no board yet shows `No Linear project read yet. Run /cairn:board <project>.`, and a refusal shows the CLI's words. A focus milestone with an empty section leaves that section out.
- Check: the existing linear mod tests for these cases still pass.

### Pane: plan view

**Ticket on agent cards (FR-15).**
- When an agent's task maps to ticket keys, the card's top border reads `<n> · <first key> <task title>`, plus ` +<k>` after the key when the task has more than one.
- An agent whose task has no key, or a plan with no Linear issues, shows today's title.
- The inline agent line shows the key the same way.
- Check: card tests for one key, two keys (`SAV-66 +1`) and none.

**Epic and keys in the plan header and UP NEXT (FR-16).** The header's title is prefixed with the epic key when the plan row has one. Each UP NEXT task is prefixed with its first key.
- Check: a mod test with `epic: "SAV-16"` shows `SAV-16 ` before the title, and UP NEXT shows `SAV-80 Workspace stubs`.

### Card fixes (from richer-pane-cards s29)

**Overlapping tool calls (FR-17).** When an agent has two tool calls open and one ends, the card keeps showing the one still running. A call that ends only clears the card's call when it is the one shown.
- Check: an activity test runs A and B before A's end, and the card still shows B.

**Main card model (FR-18).** The Main card's second row shows the session's model, the same name the bottom bar shows, instead of being empty.
- Check: a cards test finds the model name on the Main card's second row.

**Status glyph when cut (FR-19).** When a card is too narrow for its whole status, the status is cut after its glyph, and the glyph keeps the status color.
- Check: at a width where the status does not fit, the first segment of the status row is the glyph in the status color.

**Inline count line position (FR-20).** Inline, the merged "+N agents · +M other plans" line sits in the same place the other-plans line sits when it is drawn alone.
- Check: an inline test with the line merged and one with it drawn alone find it at the same position relative to the buttons.

## Non-goals
- Running several plans at once, a "can start alongside" status, starting from another plan's unmerged branch, and the parallel-task cap. These go to a separate parallelism plan.
- Collapsible epics in the pane. Waiting epics are always collapsed; `cairn linear board --epic KEY` gives the detail.
- Changing links in Linear. The tab points at wide links, and the user narrows them in Linear.
- Using Linear's own "In Progress" state. In progress means a cairn plan owns the issue, as the board already defines it.
- A new nudge to refresh the board. The read age stays in the header, and the existing full-read hint stays.

## Open questions
- [x] What does "in progress" mean? (answer: a cairn plan owns the issue)
- [x] What does a task covering several tickets show? (answer: first key + count; no key when there is none)
- [x] How are 11 milestones handled? (answer: In progress and Ready cover every milestone; Waiting details only the first unfinished milestone; each later milestone is one line)
- [x] Is blocked work dimmed in the CLI text too? (answer: no, the text board has no colors)

## Unhappy paths
- [FR-07] A plan whose PRD has not been approved yet has no requirements on its issues, so `taskIssues` maps every task to `[]`, and cards show no key.
- [FR-05] Every milestone done: there is no `focus`, and the tab shows only the header lines and `✓ DONE`.
- [FR-12] A loop in the blocked-by links: the loop warning line is red, even when its issues sit in a dim waiting row.
- [FR-02] A loop in the blocked-by links: the unblocks walk stops at issues already counted, and the loop warning shows as today.

## Security
- Trust boundaries:
  - ticket keys, titles, milestone and epic names come from Linear (other people's text), are stored in the snapshot, and are drawn in the pane and printed by the CLI;
  - plan rows come from state.json files on disk.
- Assets: the user's terminal and pane display.
- STRIDE:
  - Linear text → pane: T/S (terminal control or bidi characters that disguise text). Every string from the board or plan rows passes the pane's existing `stripControl`/`clean` before it is drawn. Keys are already checked against `ISSUE_KEY` on import.
  - Linear text → CLI text output: the same strings print as today.
- Misuse cases:
  - A ticket title with ANSI escape or bidi characters. It is drawn with them stripped in the Linear tab, on cards, and in UP NEXT.
  - A huge snapshot. Sections are capped (4 issues per plan, one row per waiting epic, one line per later milestone).

## Non-functional requirements
- **NFR-01** Building the board for 100 issues adds no Linear reads and no extra process runs. The pane still makes one `cairn linear board --json` run per refresh, as today.
- **NFR-02** No new runtime dependencies. `types/index.d.ts` stays self-contained, and every new field the mod reads is declared there.
