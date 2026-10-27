# PRD: Pane status bar and polish

> Plan: pane-status-bar-and-polish. Keep it short. Every requirement has a stable id and a one-line acceptance check.

## Problem
The cairn pane is meant to be the one place to watch a plan, but it can't be trusted and it doesn't show enough. The header said "all phases done" while the whole-branch review and its fixes were still running, because it only counts build phases. Spend, context and the 5-hour and weekly limits are only in Claude Code's own status line. Clicking an agent card does nothing. Read all puts a long plan inline in the approval card, and the end of it can't be reached by scrolling. The PRD gets the same treatment, so it can't be read in full before approval either.

## Solution
A bar pinned to the bottom of the pane shows the plan's stages as labelled steps (done, active, upcoming), then this plan's spend in this session with model, context and tokens, then 5-hour and weekly usage that turns to a warning color near the limit. The CLI records what check, review and ship are doing (running reviewers, fixing findings, re-checking). The header, `cairn status` and the Claude Code status line all say that instead of "all phases done". Clicking anywhere on an agent card switches the terminal to that agent, and cards show live tokens with an estimated cost. Read all opens one full-height scrolling doc viewer with a Back button. It is used for the PRD, the plan, the ship record and Records entries alike.

## Requirements

### Bottom bar
- **FR-01** In the docked pane, a status bar sits at the bottom on every tab (Now, History, Records) and in the doc viewer. When the content above is taller than the pane, the content scrolls and the bar stays visible. Check: a pane test that the bar renders last on each tab and in the viewer, plus a live check that a long History tab scrolls with the bar still showing.
- **FR-02** The bar's first line shows every stage of the plan's track in order: feature Disc, PRD, Plan, Build, Check, Review, Ship, Learn; fix Repro, Build, Review, Ship. Done stages show ✓ in the success color, the active stage shows ● in bold in its stage color, and upcoming stages show ○ dimmed. Build shows the phase as `n/m` while building. A closed plan shows every step done, plus "PR open" when unmerged. It wraps to two lines rather than truncating. Check: pane tests for a feature plan at Build phase 2 of 3, a fix plan at Review, and a closed plan with PR open.
- **FR-03** The bar's second line shows the main model name, this plan's cost in this session in dollars, a context bar with its percent, and the tokens used. The cost counts from when the plan was first seen active in this session, or resumed, and includes the main session and its agents. It resets on restart. With no active plan, the line shows the session totals labelled "session". Check: a pane test with mocked session usage, where cost was $10.00 when the plan became active and $14.10 now, shows $4.10.
- **FR-04** The bar's third line shows 5-hour and weekly usage, each with a small bar and a percent. Past about 80%, that entry turns to the warning color and adds its reset time. Past about 95%, it uses the error color. When Claude Code reports no rate limits (not a subscription), the line is left out. Check: pane tests at 5%, 85% and 97%, and with no rate limits.
- **FR-05** The bar updates when Claude Code reports new usage (after each main turn and when a limit moves), not on a timer of its own. Check: a pane test that a `session.measure` event changes the shown cost and percent.
- **FR-06** In the inline 7-row pane, the bar collapses to one line: the active stage, the plan cost, and the 5-hour and weekly percents. Check: an inline pane test that the whole view stays within 7 rows with the bar line present.

### Accurate status
- **FR-07** The CLI records the current step of the check, review and ship stages with `cairn step <step>` from a fixed list:
  - check: testing, scanning, fixing;
  - review: reviewing, fixing, rechecking;
  - ship: approving, opening-pr, merging.

  It can take an optional count, such as findings being fixed. The step clears when the stage advances. `cairn status --json` includes it. Check: CLI tests that set, show and clear a step, and that refuse a step not valid for the current stage.
- **FR-08** After Build, the header, `cairn status` text, STATUS.md and the Claude Code status line show the stage and its step, such as "Review · fixing 3 findings", never "all phases done". During Build they show "phase n of m" as today. Check: render tests for each late stage, with and without a step, and a grep showing "all phases done" is gone from render.ts and pane.tsx.
- **FR-09** While any agent card for the plan is working, the pane header adds "N running" and never presents the stage as finished. This holds even when no step was recorded. Check: a pane test at the review stage with no step and one working reviewer card shows "1 running".
- **FR-10** The verify, review, ship and fix procedures run `cairn step` at each step they reach, including each fix attempt. Check: a doc test that each procedure names its steps.

### Agent cards
- **FR-11** Clicking any row of an agent card, from the title to the last line, switches the terminal to that agent. The cause of today's "nothing happens" is found and fixed. When Claude Code refuses the switch, a toast says why. Check: a pane test that each card row presses through to the switch with the card's agent id, plus a live check by the user that clicking a running reviewer's card opens its transcript.
- **FR-12** Agent cards show tokens while the agent runs, updated as it works, and when it finishes. Next to the tokens is an estimated cost marked with "~", from a small built-in price table per model. An unknown model shows tokens only. Check: pane tests that a running card's tokens rise with each step, and that a known model shows "~$" and an unknown model doesn't.

### Doc viewer
- **FR-13** Read all opens a full-height doc viewer in place of the tab content. It has the doc's title, a Back button, and the whole document. While the doc is waiting on approval, Approve is in the viewer too. The same viewer opens the PRD, the plan and the ship record from the approval card, and Records entries from the Records tab. Check: pane tests opening each kind and returning with Back.
- **FR-14** The PRD approval card has Read all, like the plan card. Check: a pane test at the PRD stage with a ready PRD shows a Read all button that opens the PRD.
- **FR-15** In the docked pane the viewer scrolls to the last line of a long document. Check: a live check with the plan of this plan, plus a pane test that the viewer tree holds the whole document text.

### Follow-ups brought in
- **FR-16** Tighter pane and approval tests:
  - Records rows have no inner gap.
  - The Now root order is right with two agent cards.
  - Approval handles two stops in one question.
  - Approval handles another stop of the same plan.
  - Unhandled rejections are really checked.

  Check: these tests exist and pass. (from roomier-pane-visuals)
- **FR-17** Tighter close and pane tests:
  - Close works when origin is ahead of the local base.
  - The docked pane has no background color.
  - fix.md naming matches tasks.ts.
  - The pane reads "PR open" from a real `status --all`.

  Check: these tests exist and pass. (from sharper-interview-and-review)

## Non-goals
- Saving plan spend across sessions, because you declined it. The bar's plan cost resets on restart.
- A dollar budget cap per plan, because you declined it.
- Total spend and tokens in RECORD.md, because you declined it.
- Broader end-to-end tests for old and renamed plans, because you declined that follow-up.
- Nerd Font glyphs, because Claude Code doesn't promise them. Icons are emoji and Unicode that already render in your status line.
- Changes to how approval is proven, because the viewer only reads.

## Open questions
- [x] What does the bar's spend count? (answer: this plan, this session, main plus agents)
- [x] What does a card show for cost? (answer: live tokens and a ~$ estimate from a built-in price table)
- [x] Which bar look? (answer: labelled steps)

## Unhappy paths
- [FR-03] When Claude Code reports no cost for the session, the bar shows tokens and context only, with no dollar figure.
- [FR-11] When the agent has ended and Claude Code refuses the switch, a toast says the agent's transcript isn't available, and the pane stays as it was.
- [FR-13] When the doc can't be read, the viewer shows "Could not read <file>" with Back, and Approve stays available from the approval card.
- [FR-07] An unknown step, or one sent at the wrong stage, exits 2 with the valid steps listed.

## Security
- Trust boundaries:
  - PRD, plan and record text, written partly by agents, is shown in the viewer as read-only Markdown.
  - Session usage comes from Claude Code.
  - `cairn step` takes its arguments from procedures.
- Assets: the approval proof, which stays in approve.ts memory; the plan state, which the CLI alone writes.
- STRIDE:
  - **Viewer (Tampering/Elevation).** Doc text can't trigger an approval. Only the Approve button and the existing proof path can, and Markdown links do nothing beyond what Claude Code allows.
  - **`cairn step` (Tampering).** It accepts only the fixed list, and only for the current stage, and the mod's guards still block direct writes to `state.json`.
  - **Usage (Information disclosure).** Cost and limits are shown only in the user's own pane.
- Misuse cases:
  - A PRD containing text like "Approve" or an approve tag does not approve when shown in the viewer. This is a Security test for the doc viewer task.
  - `cairn step review "x; rm -rf"` is refused with exit 2. This is a Security test for the step task.

## Non-functional requirements
- **NFR-01** Every bar line fits 46 columns, the docked width less padding, counting emoji as two cells. Check: a pane test with `bodyColumns: 46` that no bar line is longer.
- **NFR-02** No new approval stops, and no new timers: the bar runs on Claude Code's usage events and the existing 2-second refresh. Check: the approve kinds are unchanged, and the only `$.clock` use in the mod is the existing refresh.
