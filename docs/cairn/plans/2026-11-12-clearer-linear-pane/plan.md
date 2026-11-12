# Plan: Clearer Linear pane

> Source: prd.md. Each task is a thin, complete path through every layer, demoable on its own, and fits one context window.

## Goal
Make the CLI compute the Linear board as status sections, plus each task's ticket keys. The pane's Linear tab, agent cards, header and UP NEXT draw them. Also fix four card bugs.

## Architecture
The CLI works out every fact; the mod only draws, as it already does for plan rows. The board computation moves out of `commands/linear.ts` `board()` into a new pure module, `cli/src/board.ts`. It takes the snapshot, the plans and their progress, and returns the JSON the PRD defines (`focus`, `milestones` with `waitsOn`, `inProgress`, `ready`, `waiting`, `done`, `wideLinks`, `unblocks`, epic `state`/`waitsOn`).

`board()` keeps its current inputs, calls the new module, and prints the text board from the same sections. `commands/status.ts` adds `taskIssues` and `epic` to plan rows. In the mod:
- the Linear tab's rows move to `hooks/mod/linear.tsx`;
- cards take `taskIssues` through `CardContext`;
- every string from Linear goes through the existing `stripControl`/`clean`.

## Global constraints
- The docked pane is 46 columns wide (cards.tsx `CARD_COLUMNS`).
- `plugins/cairn/types/index.d.ts` stays self-contained (no `import`), and every field the mod reads is declared there.
- No new runtime dependencies. After `cli/src` changes, `npm run build` regenerates `plugins/cairn/dist/cairn.mjs`, committed with the change.
- Version 0.13.0 in `plugins/cairn/.claude-plugin/plugin.json`.

## Phases

```yaml cairn-tasks
phases:
  - id: groundwork
    name: Groundwork
    tasks:
      - id: shared-shapes
        name: Declare the new board and plan-row fields, and move the Linear tab rows to their own file
        kind: prefactor
        covers: []
        blocked_by: []
        scope: ["plugins/cairn/types/index.d.ts", "plugins/cairn/hooks/mod/linear.tsx", "plugins/cairn/hooks/mod/pane.tsx"]
        complexity: simple
        risky: false
  - id: cli-facts
    name: The CLI computes the sections and ticket keys
    tasks:
      - id: board-sections
        name: Board sections, unblocks counts and wide links
        covers: [FR-01, FR-02, FR-03, FR-04, FR-05]
        blocked_by: [shared-shapes]
        scope: ["plugins/cairn/cli/src/board.ts", "plugins/cairn/cli/test/board.test.ts"]
        complexity: complex
        risky: false
      - id: plan-row-tickets
        name: Ticket keys per task on plan rows
        covers: [FR-07]
        blocked_by: [shared-shapes]
        scope: ["plugins/cairn/cli/src/commands/status.ts", "plugins/cairn/cli/test/status-tickets.test.ts"]
        complexity: simple
        risky: false
      - id: board-text
        name: Text board in the same sections
        covers: [FR-06]
        blocked_by: [board-sections]
        scope: ["plugins/cairn/cli/src/commands/linear.ts", "plugins/cairn/cli/test/linear.test.ts", "plugins/cairn/references/cli.md", "plugins/cairn/procedures/board.md"]
        complexity: standard
        risky: false
  - id: pane
    name: The pane draws them
    tasks:
      - id: linear-tab
        name: Linear tab by status
        covers: [FR-08, FR-09, FR-10, FR-11, FR-12, FR-13, FR-14]
        blocked_by: [board-text]
        scope: ["plugins/cairn/hooks/mod/linear.tsx", "plugins/cairn/hooks/test/linear.test.tsx"]
        complexity: standard
        risky: true
        riskReason: "draws ticket titles and names written in Linear by other people in the user's terminal"
      - id: card-tickets
        name: Ticket keys on cards, header and UP NEXT
        covers: [FR-15, FR-16]
        blocked_by: [plan-row-tickets]
        scope: ["plugins/cairn/hooks/mod/cards.tsx", "plugins/cairn/hooks/mod/header.tsx", "plugins/cairn/hooks/mod/pane.tsx", "plugins/cairn/hooks/test/cards.test.tsx", "plugins/cairn/hooks/test/pane.test.tsx"]
        complexity: standard
        risky: false
      - id: card-fixes
        name: Card fixes from the earlier pane plan
        covers: [FR-17, FR-18, FR-19, FR-20]
        blocked_by: [card-tickets]
        scope: ["plugins/cairn/hooks/mod/activity.ts", "plugins/cairn/hooks/mod/cards.tsx", "plugins/cairn/hooks/mod/pane.tsx", "plugins/cairn/hooks/test/toolcall.test.tsx", "plugins/cairn/hooks/test/cards.test.tsx", "plugins/cairn/hooks/test/inline.test.tsx"]
        complexity: standard
        risky: false
      - id: release
        name: Version, README and bundle
        kind: prefactor
        covers: []
        blocked_by: [linear-tab, card-fixes]
        scope: ["plugins/cairn/.claude-plugin/plugin.json", "README.md", "plugins/cairn/dist/**"]
        complexity: simple
        risky: false
```

### Task: shared-shapes

**Check:** `npm run typecheck` and `npm test` pass unchanged. The Linear tab draws exactly as before, now from `hooks/mod/linear.tsx`.

**Interfaces**
- Consumes: none.
- Produces:
  - In `types/index.d.ts`:
    - `CairnBoardIssue` gains `unblocks?: number`, and `blockedBy[].where` becomes optional.
    - `CairnBoardEpic` (named type) gains `state` and `waitsOn`.
    - `CairnBoard` gains:
      - `readyEpics: string[]`;
      - `focus: string | null`;
      - `milestones[].waitsOn?: string[]`;
      - `inProgress: { slug, stage, epic?, title?, done, total, issues: { key, title, progress }[] }[]`;
      - `ready: { key, title, kind: 'epic' | 'issue', milestone, unblocks }[]`;
      - `waiting: { key, title, kind, done?, total?, waitsOn: string[] }[]`;
      - `done: number`;
      - `wideLinks: { epic, on, holds }[]`.
    - `CairnPlanRow` gains `taskIssues?: Record<string, string[]>` and `epic?: string`.
  - In `hooks/mod/linear.tsx`: `linearRows(ui, board, note)`, moved verbatim from `pane.tsx:641-679` with `MARKS` and `MARK_COLOR`. `pane.tsx` imports it.

### Task: board-sections

**Check:** `node --test plugins/cairn/cli/test/board.test.ts` covers the PRD checks for FR-01 to FR-05:
- the same-milestone tag;
- the A←B←C plus D chain giving `unblocks: 3`;
- the E1/E2 epic state and `waitsOn`;
- wide links at 3 held issues and not at 2;
- the two-milestone sections.

**Interfaces**
- Consumes:
  - `effectiveBlockers`, `isDone`, `findIssueCycle` from `cli/src/linear.ts`;
  - `BoardSnapshot`, `LinearIssue`, `IssueProgress`.
- Produces: `buildBoard(input: { snap: BoardSnapshot; plans: { slug: string; stage: string; state: State }[]; progress: Map<string, Map<string, IssueProgress>> }): BoardData` in `cli/src/board.ts`.
  - `BoardData` matches the `CairnBoard` declaration, minus `ageMinutes`/`readAt`/`project`, which `board()` adds.
  - It keeps today's per-milestone `epics`/`issues`/`counts` for `--epic`.
  - A pure function: no file or git access.

### Task: plan-row-tickets

**Check:** for a plan whose task covers requirements tagged `[SAV-1]` and `[SAV-2]`, the `cairn status --all --json` row has `taskIssues` mapping that task to `["SAV-1","SAV-2"]` and `epic` set from `state.linear.epic`. A plan with no Linear link has neither key.

**Interfaces**
- Consumes: `takenIssues` from `cli/src/linear.ts`; `LinearIssue.requirements`; `Task.covers`.
- Produces: `taskIssuesOf(s: State): Record<string, string[]> | undefined` in `commands/status.ts`, spread into each row.

### Task: board-text

**Check:** `cairn linear board` prints, in order:
1. header;
2. milestones;
3. In progress;
4. Ready to start;
5. Waiting;
6. Done;
7. later milestones;
8. warnings, including the wide-link line worded as FR-04.

`--epic` still lists every issue of that epic. The JSON is `buildBoard`'s output plus project/readAt/age. Existing `linear.test.ts` board assertions are updated where the wording deliberately changed.

**Interfaces**
- Consumes: `buildBoard` from `cli/src/board.ts`.
- Produces: `cairn linear board [--json]` in the new shape. `references/cli.md` documents the JSON. `procedures/board.md` says to report wide links in plain words and suggest narrowing them in Linear.

### Task: linear-tab

**Check:** mod tests in `hooks/test/linear.test.tsx` cover:
- FR-08 to FR-14's checks: the section order, a collapsed waiting epic, `+2 more`, unblocks ordering, red only on the loop line, the wrapped row's indent, and the empty and refused states;
- stripped control characters in a ticket title.

**Interfaces**
- Consumes: `CairnBoard` (new fields); `stripControl`.
- Produces: `linearRows(ui, board, note)` drawing the status layout, with every indented row in `<Box paddingLeft>`.

**Test cases**
- Happy: a board with a focus milestone, one plan in progress, 2 ready, and a 9-issue waiting epic draws the sections in order, with the epic on one row.
- Unhappy: no board yet shows the "No Linear project read yet" hint, and a refusal note shows the CLI's words.
- Security: a ticket title holding `\x1b[31m` and a right-to-left override character is drawn with both removed, in the Ready, Waiting and In progress rows.

### Task: card-tickets

**Check:** card tests show:
- `8 · SAV-66 Move the app…` for one key;
- `SAV-66 +1` for two keys;
- today's title with no key.

A pane test shows `SAV-16 ` before the plan title, and `UP NEXT  SAV-80 Workspace stubs`.

**Interfaces**
- Consumes: `CairnPlanRow.taskIssues`, `CairnPlanRow.epic`.
- Produces: `CardContext.taskIssues?: Record<string, string[]>`, and `agentRole` returning `keys?: string[]`. `planHeader` reads `row.epic`. `pane.tsx` passes `here.taskIssues` and prefixes UP NEXT.

### Task: card-fixes

**Check:**
- An activity test runs A and B, then ends A; the card still shows B.
- The Main card's second row shows the session model.
- A narrow card's status row starts with the glyph in the status color.
- Inline, the merged count line and the lone other-plans line sit at the same position relative to the buttons.

**Interfaces**
- Consumes: `toolCall` in `activity.ts`; the model name the bar uses (`modelLine` input in `pane.tsx`).
- Produces: `after()` clears `call` only when `toolCall(e)` equals the shown call. `CardContext.model?: string` feeds `mainCard`. `sides()` keeps the glyph segment when cut.

### Task: release

**Check:**
- `plugin.json` is at 0.13.0.
- The README's Linear section describes the status tab and ticket keys.
- `npm run build` leaves `plugins/cairn/dist/cairn.mjs` matching the source.
- `npm run typecheck && npm test` and `claude plugin validate plugins/cairn` pass.

**Interfaces**
- Consumes: everything above.
- Produces: the shippable bundle.
