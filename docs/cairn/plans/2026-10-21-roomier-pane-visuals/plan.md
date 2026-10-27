# Plan: Roomier pane visuals

> Source: prd.md. Each task is a thin, complete path through every layer, demoable on its own, and fits one context window.

## Goal
Give the cairn pane side padding, blank lines between sections and multi-line entries, and one try at a transparent background. Also fix two approval rough edges: the duplicate "not approved" note, and the chat question left open after approving in the pane.

## Architecture
Layout changes stay in the `ui.render` Pane hook in `plugins/cairn/hooks/mod/pane.tsx` and use Box props only: `paddingX`, `marginTop`, and `gap` on wrapper Boxes. Spacing never comes from spacer `Text` elements, because the tests count Texts by colour and keys. The approval fixes stay in the `AskUserQuestion` `tool.call` hook in `plugins/cairn/hooks/mod/approve.ts`. A module-level registry of open tagged dialogs lets `approveAs` signal the waiting hook, which races `next(e)` against that signal. The early answer mirrors the existing already-approved shortcut (approve.ts:223-231).

## Global constraints

- Side padding: `paddingX={1}` on every tab's root Box, docked and inline.
- Progress bar width uses `bodyColumns - 2` (P:406).
- Inline placement adds no `gap`/`marginTop`; docked spacing is gated on `!isInline`.
- Keep every existing element key, Button order, and the 3 Buttons per card (tests T:223-312, T:867, T:886, T:890-907).
- No new `Text` for spacing; no new bordered Box (T:743-745, T:925).

## Phases

```yaml cairn-tasks
phases:
  - id: roomier-pane
    name: Roomier pane and approval polish
    tasks:
      - id: pane-layout
        name: Pane padding and spacing
        covers: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06, FR-07, FR-08, FR-09, FR-10]
        blocked_by: []
        scope: ["plugins/cairn/hooks/mod/pane.tsx", "plugins/cairn/hooks/test/pane.test.tsx"]
        complexity: standard
        risky: false
      - id: approval-polish
        name: Approval note and open question
        covers: [FR-11, FR-12]
        blocked_by: []
        scope: ["plugins/cairn/hooks/mod/approve.ts", "plugins/cairn/hooks/test/approve.test.ts"]
        complexity: standard
        risky: true
        riskReason: "changes how the human approval question resolves"
```

### Task: pane-layout

**Check:** `npm run test:mod` passes with new tests that find `paddingX` 1 on every tab root (docked and inline), the docked spacing props between the tab row, sections, cards, and Records rows, no spacing props in the inline fit or between History lines, and a progress bar line no wider than `bodyColumns - 2`.

**Interfaces**
- Consumes: none.
- Produces: no new exports. Implementation notes:
  - Wrap the header and progress bar as one Box, and the drift heading and its paths as one Box, so a gap never splits them.
  - Give the Now, Records list and Records detail roots `gap={isInline ? 0 : 1}`, or use per-section `marginTop={1}`. Conditional `false` children must add no row.
  - Wrap History timeline lines in one Box with no gap.
  - FR-10: set a root `backgroundColor` that asks for the terminal's own background. The API has no documented value for that, so pick the most plausible and note it in a code comment. The by-eye check happens at acceptance, and if Claude Code ignores the setting it is removed there.

### Task: approval-polish

**Check:** `npm run test:mod` passes with new approval tests: Revise twice gives one note; approving while a tagged question is pending answers it early with no second approval run.

**Interfaces**
- Consumes: `approveAs($, slug, kind)` (approve.ts:108) and `ALREADY_APPROVED` (approve.ts, used at :228).
- Produces:
  - A module-level registry in approve.ts keyed `${kind} ${slug}` that resolves pending tagged dialogs. `approveAs` fires it after a recorded approval, so the pane button and `/cairn-approve` both reach it with no change to pane.tsx.
  - Skip notes are deduped per stop: collect a skip reason per key, and after the loop emit one note for each key that never reached an approval attempt.
  - The abandoned `next(e)` gets a `.catch`, and the early path skips the note block.
  - The hand-check at acceptance: in a live session, an open chat approval question closes when the stop is approved in the pane. If it stays open, report it and fall back to `$.ui.notice(tool_use_id, …)` under the open question.

**Test cases**
- Happy: a stop with two tagged questions, both answered "Revise" → `got.context` holds exactly one "not approved" note and `approveRuns()` is empty.
- Happy: Revise then Approve on the same stop → one approval run and no "not approved" note (FR-17 test at :264 still passes).
- Happy: the dialog stub never resolves; `approveAs` records the prd approval for that slug → the hook resolves with `ALREADY_APPROVED` answers, `approveRuns()` has length 1, and no "not approved" note.
- Unhappy: a pending dialog for slug A when slug B is approved → A's dialog stays pending (the hook has not resolved after B's approval).
- Unhappy: the abandoned `next(e)` rejects after the early answer → no unhandled rejection, and the hook result is unchanged.
- Security: a pending tagged dialog with no approval recorded is never answered early. The early answer only follows a successful `approveAs` (CLI exit 0), never a failed or refused approve run, and never the model's own `AskUserQuestion` input answers.
