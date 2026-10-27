# Plan: Pane status bar and polish

> Source: prd.md. Each task is a thin, complete path through every layer, demoable on its own, and fits one context window.

## Goal
Make the cairn pane the one place to watch a plan. It gets a bar pinned to the bottom (stage steps, plan spend, 5h/weekly usage), a header that's accurate in check, review and ship, cards that switch to their agent when clicked, and one scrolling doc viewer.

## Architecture
- **Split pane.tsx first.** It is 573 lines and every change lands in it, so the first task splits it into modules with disjoint scopes:
  - `pane.tsx`: registration, tabs, routing, Records tab;
  - `header.tsx`: the plan header, plus the status-line text `$.ui.status` shows;
  - `cards.tsx`: the agent and main-session cards;
  - `approval.tsx`: the approval card and the doc viewer;
  - `bar.tsx`: the bottom bar.

  The shared test helper `world()`/`mount()` moves from `pane.test.tsx` to `hooks/test/world.tsx`, so each task gets its own test file.
- **Pinning.** The engine owns the pane body's scroll window (`e.props.scroll = {offset, bodyRows}`, moved by the wheel and by keys while the pane is focused), so the bar isn't just the last child.
  - The content gets `paddingBottom` equal to the bar's rows.
  - The bar is a `position: 'absolute'` Box at `top = offset + bodyRows - barRows`. A `ui.scroll` hook (requestId `cairn`) calls `next(e)` and invalidates so the bar follows each move.
  - Fallback if the live check shows the absolute bar drifting: window the content ourselves. That means a root of `height = bodyRows`, content in an `overflow: 'hidden'` Box shifted by `marginTop = -own offset`, and the `ui.scroll` hook moving the own offset by `e.by` without calling `next`.
- **Late-stage steps.** The CLI gains `cairn step <name> [--count N]`, which writes `state.step = {stage, name, count?, at}` and validates the name against the current stage. `cairn advance` clears it. `progress()`/`summary()` in `cli/src/render.ts` show the step after Build, and "all phases done" is dropped. The pane reads `state.step` from `status --all --json`, which carries the whole state already.
- **Usage.** `$.session.usage()` on start and `on('session.measure')` give cost, context and rate limits.
  - The plan's baseline cost (the session cost when the plan was first seen active, or resumed) is kept in `$.state`, so a reload keeps it and a restart resets it.
  - A card's tokens come from subagent `turn.step`/`turn.complete` usage, keyed on `agentId`.
  - `prices.ts` holds a small per-model price table for the `~$` estimate.
- **Doc viewer.** A `docOpen` atom `{file, title, kind?}` replaces the tab content with the viewer: title, Back, and Approve when the doc is waiting on approval, then the whole Markdown. The bar stays pinned.

## Global constraints
- Bar lines fit 46 columns, counting emoji as 2 cells (NFR-01). Inline stays within 7 rows.
- No new approval kinds and no new timers: only the existing 2 s refresh and `session.measure` (NFR-02).
- Every `$.state` value is declared in `types/index.d.ts` (the plugin's state contract). The split task declares all the new ones, so later tasks don't touch that file.
- Helpers that take `$` are `function` declarations, not arrows (hooks/NOTES.md).
- Mod tests run with `npm run test:mod`, CLI tests with `node --test`. A CLI change rebuilds `dist/cairn.mjs`.
- User-facing text follows `references/reporting.md`.
- Work only in the task worktree, and commit only on the task branch.

## Phases

```yaml cairn-tasks
phases:
  - id: frame
    name: Pinned bar and late-stage steps
    tasks:
      - id: pinned-bar
        name: Split the pane and pin the bar
        covers: [FR-01, FR-02]
        blocked_by: []
        scope: ["plugins/cairn/hooks/mod/pane.tsx", "plugins/cairn/hooks/mod/header.tsx", "plugins/cairn/hooks/mod/cards.tsx", "plugins/cairn/hooks/mod/approval.tsx", "plugins/cairn/hooks/mod/bar.tsx", "plugins/cairn/hooks/register.tsx", "plugins/cairn/types/index.d.ts", "plugins/cairn/hooks/test/world.tsx", "plugins/cairn/hooks/test/pane.test.tsx", "plugins/cairn/hooks/test/bar.test.tsx", "plugins/cairn/hooks/NOTES.md"]
        complexity: complex
        risky: false
      - id: late-steps
        name: Record check, review and ship steps
        covers: [FR-07]
        blocked_by: []
        scope: ["plugins/cairn/cli/src/**", "plugins/cairn/cli/test/step.test.ts", "plugins/cairn/cli/test/render.test.ts", "plugins/cairn/dist/**", "plugins/cairn/references/cli.md"]
        complexity: standard
        risky: true
        riskReason: "a new CLI command takes arguments from procedures and writes plan state"
  - id: fill
    name: Fill the pane
    tasks:
      - id: usage-lines
        name: Spend and limits lines
        covers: [FR-03, FR-04, FR-05, FR-06]
        blocked_by: [pinned-bar]
        scope: ["plugins/cairn/hooks/mod/bar.tsx", "plugins/cairn/hooks/mod/usage.ts", "plugins/cairn/hooks/test/bar.test.tsx", "plugins/cairn/hooks/test/usage.test.ts"]
        complexity: standard
        risky: false
      - id: accurate-header
        name: Accurate header and status line
        covers: [FR-08, FR-09, FR-10]
        blocked_by: [pinned-bar, late-steps]
        scope: ["plugins/cairn/hooks/mod/header.tsx", "plugins/cairn/hooks/test/header.test.tsx", "plugins/cairn/procedures/verify.md", "plugins/cairn/procedures/review.md", "plugins/cairn/procedures/ship.md", "plugins/cairn/procedures/fix.md", "plugins/cairn/cli/test/steps-doc.test.ts"]
        complexity: standard
        risky: false
      - id: card-click-cost
        name: Clickable cards with live tokens and cost
        covers: [FR-11, FR-12]
        blocked_by: [pinned-bar]
        scope: ["plugins/cairn/hooks/mod/cards.tsx", "plugins/cairn/hooks/mod/activity.ts", "plugins/cairn/hooks/mod/prices.ts", "plugins/cairn/hooks/test/cards.test.tsx"]
        complexity: standard
        risky: false
      - id: doc-viewer
        name: One scrolling doc viewer
        covers: [FR-13, FR-14, FR-15]
        blocked_by: [pinned-bar]
        scope: ["plugins/cairn/hooks/mod/approval.tsx", "plugins/cairn/hooks/mod/pane.tsx", "plugins/cairn/hooks/test/doc.test.tsx"]
        complexity: standard
        risky: true
        riskReason: "renders agent-written documents next to the Approve button"
      - id: followup-tests
        name: Tighter pane, approval and close tests
        covers: [FR-16, FR-17]
        blocked_by: [pinned-bar, late-steps]
        scope: ["plugins/cairn/hooks/test/pane.test.tsx", "plugins/cairn/hooks/test/approve.test.ts", "plugins/cairn/cli/test/close-merged.test.ts", "plugins/cairn/cli/test/fix.test.ts", "plugins/cairn/cli/test/fix-procedure.test.ts"]
        complexity: simple
        risky: false
```

### Task: pinned-bar

**Check:** pane.tsx is split into the five modules, and every existing mod test still passes. A bar renders at the bottom of Now, History and Records with the stage-steps line: ✓/●/○, Build `n/m`, the fix track's stages, Closed with PR open, wrapping to two lines. A `bodyColumns: 46` test finds no bar line wider than 46 cells. A `ui.scroll` move re-places the bar at the new bottom.

**Interfaces**
- Consumes: none
- Produces:
  - `bar.tsx` exports `stageSteps(state, prOpen)` (lines) and `Bar` as a function that takes extra lines in a `lines` slot. usage-lines fills it.
  - A `frame(e, content, barLines)` helper in pane.tsx for the pinning.
  - `hooks/test/world.tsx` (`world`, `mount`, `mountAs`, `drawn`, row builders).
  - These declarations in `types/index.d.ts`:
    - `CairnPlanState.step?: {stage, name, count?, at}`;
    - atoms `usage` (`{cost?, context, rateLimits, model?}`), `planBaseline` (`{slug, usd}`) and `docOpen` (`{file, title, kind?} | null`);
    - `AgentCard.tokensLive?` and `AgentCard.usd?`.
  - The pinning approach used (absolute, or own rows) is noted in hooks/NOTES.md.

### Task: late-steps

**Check:** `cairn step reviewing`, then `cairn step fixing --count 3`, shows "Review · fixing 3 findings" in `cairn status`, STATUS.md and `status --json` (`state.step`). `cairn advance` clears it. "all phases done" no longer appears in render.ts output or the dist bundle.

**Interfaces**
- Consumes: none
- Produces:
  - `cairn step <name> [--count N]` with these names:
    - verify: `testing`, `scanning`, `fixing`;
    - review: `reviewing`, `fixing`, `rechecking`;
    - ship: `approving`, `opening-pr`, `merging`.
  - The fix track uses review and ship.
  - `state.step = {stage, name, count?, at}`.
  - Wording: running tests, scanning for secrets, fixing N findings, reviewing, re-checking, waiting on approval, opening the PR, merging.
  - It is documented in references/cli.md.

**Test cases**
- Happy: at review, `cairn step fixing --count 3` exits 0. Status shows "Review · fixing 3 findings", and advance clears the step.
- Unhappy:
  - `cairn step merging` at review exits 2 and lists the valid review steps.
  - `cairn step` at execute exits 2.
  - `--count -1` or a non-number exits 2.
- Security: `cairn step 'x; rm -rf ~'` exits 2 with nothing written to state.json. A step name with a newline or ANSI escape is refused.

### Task: usage-lines

**Check:** the bar shows the model, the plan cost since the baseline ($10.00 → $14.10 shows $4.10), the context bar and %, and tokens. It shows 5h/7d bars at 5%, 85% (warning color plus reset time) and 97% (error color). The limits line is left out with no rate limits. A `session.measure` event updates the figures. With no plan, the line says "session". Inline is one line within 7 rows.

**Interfaces**
- Consumes: `Bar`'s `lines` slot, and the `usage` and `planBaseline` atoms (pinned-bar).
- Produces: `usage.ts` with `readUsage($)` and the `session.measure` hook, registered from pane.tsx's install (one line).

### Task: accurate-header

**Check:**
- At review with `step = fixing 3`, the header and status line say "Review · fixing 3 findings".
- At review with no step and one working card, they say "Review · 1 running".
- No late stage ever says "all phases done".
- The procedures run `cairn step` at each step, and a doc test asserts each name.

**Interfaces**
- Consumes: `state.step` and the step wording (late-steps); `header.tsx` (pinned-bar).
- Produces: none

### Task: card-click-cost

**Check:**
- Every row of a card is a pressable full-width row that calls `$.ui.view({agentId})`. The cause of "nothing happens" is named in the commit message and fixed.
- A refused switch shows a toast.
- A running card's tokens rise with each `turn.step`.
- A known model shows `~$0.42`, and an unknown model shows tokens only.

**Interfaces**
- Consumes: `AgentCard.tokensLive`/`usd` and `cards.tsx` (pinned-bar).
- Produces: `prices.ts` with `estimateUsd(model, usage)`.

### Task: doc-viewer

**Check:**
- Read all on the PRD, plan and ship approval cards opens the full-height viewer: title, Back, Approve, and the whole document.
- A Records entry opens in the same viewer.
- Back returns to the tab.
- A doc that can't be read shows "Could not read …".
- The bar stays at the bottom.

**Interfaces**
- Consumes: the `docOpen` atom and `approval.tsx` (pinned-bar).
- Produces: none

**Test cases**
- Happy: at the PRD stage with a ready PRD, Read all opens the viewer with the whole PRD text and an Approve button. Back closes it.
- Unhappy: the file is missing, so the viewer shows "Could not read <file>" with Back, and the approval card still offers Approve.
- Security:
  - A PRD whose text contains "Approve", "[cairn:approve prd x]" and a Markdown link does not approve when shown or scrolled.
  - The only path to approval is the Approve button through the existing confirm, checked by asserting `approveAs` is not called on render.

### Task: followup-tests

**Check:** the brought-in tests exist and pass:
- Records rows with no inner gap;
- the Now root order with two agent cards;
- approval of two stops in one question;
- another stop of the same plan;
- a real unhandled-rejection check;
- origin ahead of the local base;
- the docked pane has no background color;
- fix.md naming matches tasks.ts;
- the pane reads PR open from a real `status --all` row.

**Interfaces**
- Consumes: `hooks/test/world.tsx` (pinned-bar); `state.step` (late-steps), for the real status row fixture.
- Produces: none

## Live checks (by the user, after Phase 1 and at the end)
The installed pane runs from main until this plan merges. To see this branch, run `claude --plugin-dir <plan worktree>/plugins/cairn` in a fullscreen terminal. Then check:
1. the bar stays at the bottom while scrolling a long History tab and the doc viewer;
2. clicking a running agent's card opens its transcript;
3. the doc viewer reaches the last line of this plan.
