# Record: Richer pane cards

> Hard budget: 600 words. User-visible outcomes first. Terse.

## Links
- PRD: docs/cairn/plans/2026-10-27-richer-pane-cards/prd.md
- Plan: docs/cairn/plans/2026-10-27-richer-pane-cards/plan.md
- PR: pending
- Tracker: none

## Why
The docked pane's cards were three lines of prose whose activity line paraphrased the tool call and went blank between calls. Each card is now a fixed-height card in the style of a reference terminal dashboard. This was a Standard-level plan.

## What was built
- The new card: every agent card is five lines with its number and title in the top border, step and `● running m:ss` status on the first row, model, tokens and cost on the second, and the step count in the bottom border. The border takes the status color. The whole card is one press target.
- Real tool calls, the Main card and the polish:
  - Cards show the real tool call (`Read src/cart.ts`), kept dimmed between calls. Bash shows only the program and subcommand. Control and bidirectional characters are stripped from outside text.
  - The Main session card has working, waiting and idle states and the agents' counts. Cards are ordered running first. Finished cards linger 60s (failed 120s). "Running" is the one word everywhere.
  - The doc viewer closes after Approve. A record with no file already drew safely; a test now pins it.
  - The inline view never exceeds 7 rows.
- The plugin version is raised to 0.8.0.

## How it works
Each card is five full-width Button rows drawn by hand, because the engine cannot put text in Box borders and Button children may only be Text. `plugins/cairn/hooks/mod/cards.tsx` builds the cards from agent activity (`activity.ts`) and prices (`prices.ts`). `pane.tsx` lays them out and handles the inline view. Shared measuring, fitting, duration, token-format and press helpers are in `util.ts`. Bash text goes through an allow-list of programs.

## Findings
- Tool-call task: the security review found raw Bash text still reaching the inline view and uncleaned agent titles in the History line. Fixed in one attempt, with tests that fail without the fix. The Bash allow-list is stricter than "first bare word".
- Inline 7-row fit: the fixed rows alone filled all 7 in the worst case. You decided to merge "+N more agents" and "+N other active plans" into one line. The PRD's wording for this requirement was not updated.
- Branch review: the Main card lost its last call between calls (fixed), the version was not raised (now 0.8.0), and an unused `CardContext.accent` was removed.
- Two approved edits outside the plan's scope: `hooks/NOTES.md` (doc-viewer task) and one `pane.test.tsx` expectation (tool-call task).
- One PRD edit after approval (path examples fixed to match the last-two-parts rule), accepted with the plan approval.
- Check: 349 CLI and 608 mod tests pass. 18 of 18 requirements met, but the narrow-row drop order for the cost and tokens is untested.
- Not yet seen in a live terminal: full-width press across multi-Text rows, the orange `#ff8700` against yellow, and glyph widths.
- Time: discover 17m, PRD 3m, plan 4m, build 7h 46m, check 2m, review 10m.

## Follow-ups
- 5 open recommended follow-ups (1 tests, 1 security, 1 quality, 1 ux, 1 docs), grouped from 23 while tidying; none dismissed. Run /cairn:suggestions.
- Carried in: the `fix.md` re-checking item was already done.
- Declined: the earlier control-character and approve hardening item. Its control-character part was built here.
