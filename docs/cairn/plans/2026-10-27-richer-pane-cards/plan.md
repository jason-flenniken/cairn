# Plan: Richer pane cards

> Source: prd.md. Each task is a thin, complete path through every layer, demoable on its own, and fits one context window.

## Goal
Redraw the docked pane's agent and Main session cards in the reference design (title in the top border, status word and timer at the right, the real tool call, counts in the bottom border, status-colored borders) at 48 columns and a fixed five lines, plus the carried-in pane polish.

## Architecture
The engine can't put text in a Box border, and a `Button`'s children may only be strings and `Text` (one press wherever they are drawn). So a card stops using `Box borderStyle` and becomes five full-width plain `Button`s, one per line, each a row of `Text` pieces with the border glyphs drawn in the status color (`╭ 2 · Cart API ───╮`, `│ … │`, `╰─── 14 steps ───╯`); the whole card stays one press target per line. Width math reuses the hand-rolled `cells`/`fit` helpers, moved first into one `hooks/mod/util.ts`. Tool calls are captured in `activity.ts`'s `before`/`after` (called from the `tool.call` hook in `guards.ts`) as a cleaned `Tool arg` string kept on the card after the call ends; the agent number comes from a counter atom beside the `agents` atom.

## Global constraints

- Card width: the pane's body columns less 2 (46 cells docked at 48 columns; 58 in the tests' `PANE_PROPS`, bodyColumns 60). Every line of every card measures exactly that.
- Card height: five lines in every state.
- Card glyphs: `╭ ╮ ╰ ╯ │ ─ ● ✓ ✗ ◷ ○ · …` only; no emoji.
- Status colors: running `#ff8700`, completed `green`, failed `red`, waiting for you `yellow`, idle `gray`.
- Timer: `m:ss`, `h:mm:ss` from one hour.
- Mod rules (hooks/NOTES.md): helpers that take `$` are `function` declarations; no `import * as`; every `$.state` key declared in `types/index.d.ts`, which stays free of `import`.

## Phases

```yaml cairn-tasks
phases:
  - id: new-card
    name: The new card
    tasks:
      - id: shared-helpers
        name: Shared pane helpers
        covers: [FR-17]
        blocked_by: []
        scope: ["plugins/cairn/hooks/mod/**", "plugins/cairn/hooks/test/**"]
        complexity: simple
        risky: false
      - id: card-frame
        name: Card frame
        covers: [FR-01, FR-02, FR-03, FR-04, FR-08, FR-11, FR-13, FR-14]
        blocked_by: [shared-helpers]
        scope: ["plugins/cairn/hooks/mod/cards.tsx", "plugins/cairn/hooks/mod/activity.ts", "plugins/cairn/hooks/mod/util.ts", "plugins/cairn/hooks/mod/pane.tsx", "plugins/cairn/types/index.d.ts", "plugins/cairn/hooks/test/cards.test.tsx", "plugins/cairn/hooks/test/pane.test.tsx", "plugins/cairn/hooks/NOTES.md"]
        complexity: standard
        risky: false
  - id: live-detail
    name: Real tool calls, the Main card and the polish
    tasks:
      - id: tool-calls
        name: Real tool calls on cards
        covers: [FR-05, FR-06, FR-07]
        blocked_by: [card-frame]
        scope: ["plugins/cairn/hooks/mod/activity.ts", "plugins/cairn/hooks/mod/cards.tsx", "plugins/cairn/hooks/mod/util.ts", "plugins/cairn/types/index.d.ts", "plugins/cairn/hooks/test/cards.test.tsx", "plugins/cairn/hooks/test/toolcall.test.tsx", "plugins/cairn/hooks/NOTES.md"]
        complexity: standard
        risky: true
        riskReason: "draws agent-supplied text (tool arguments, Bash commands, titles) on screen"
      - id: doc-viewer
        name: Doc viewer after Approve
        covers: [FR-18]
        blocked_by: [card-frame]
        scope: ["plugins/cairn/hooks/mod/doc.tsx", "plugins/cairn/hooks/mod/pane.tsx", "plugins/cairn/hooks/mod/approval.tsx", "plugins/cairn/hooks/test/doc.test.tsx", "plugins/cairn/hooks/test/pane.test.tsx"]
        complexity: simple
        risky: false
      - id: main-card
        name: Main card, order and wording
        covers: [FR-09, FR-10, FR-12, FR-16]
        blocked_by: [tool-calls, doc-viewer]
        scope: ["plugins/cairn/hooks/mod/activity.ts", "plugins/cairn/hooks/mod/pause.ts", "plugins/cairn/hooks/mod/cards.tsx", "plugins/cairn/hooks/mod/header.tsx", "plugins/cairn/hooks/mod/pane.tsx", "plugins/cairn/hooks/mod/util.ts", "plugins/cairn/types/index.d.ts", "plugins/cairn/hooks/test/cards.test.tsx", "plugins/cairn/hooks/test/pane.test.tsx", "plugins/cairn/hooks/test/late-header.test.tsx", "plugins/cairn/hooks/test/active.test.tsx", "plugins/cairn/hooks/NOTES.md"]
        complexity: standard
        risky: false
      - id: inline-fit
        name: Inline view fits 7 rows
        covers: [FR-15]
        blocked_by: [main-card]
        scope: ["plugins/cairn/hooks/mod/pane.tsx", "plugins/cairn/hooks/mod/cards.tsx", "plugins/cairn/hooks/test/pane.test.tsx", "plugins/cairn/hooks/test/inline.test.tsx"]
        complexity: simple
        risky: false
```

### Task: shared-helpers

Move the helpers the pane modules share into `hooks/mod/util.ts` with no change in behaviour, and make one token formatter.

**Check:** `npm run test:mod` passes with no assertion changed; `grep -rn "tokens\`" plugins/cairn/hooks/mod` finds the formatter in `util.ts` only.

**Interfaces**
- Consumes: none
- Produces: `util.ts` exporting `cells(text)`, `lineCells`, `firstFit(candidates, columns)` (from `bar.tsx`), `fit(text, columns)`, `fitting(columns, texts)` (from `cards.tsx`), `fmtDuration(ms, isCoarse?)` (from `activity.ts`), `tokenCount(n)` ("41k tokens", used by `cards.tsx` and the finished-agent line at `activity.ts:219`), and the function declarations `message(err)`, `act($, work)`, `viewPress($, agentId?)` (from `cards.tsx`). Old modules import from `util.ts`; nothing re-exports under the old path. `usage.ts`'s compact `tokensText` (" tok") may build on `tokenCount`'s rounding but keeps its output.

### Task: card-frame

Replace `card()`'s `Box borderStyle` with five hand-drawn full-width `Button` rows. Top border: `╭ <n> · <title> ─…╮` (Main: `╭ Main session ─…╮`). Row 1: step left, status word + `m:ss` right (`● running`, `✓ completed`, `✗ failed`). Row 2: model · tokens · ~cost, cost then tokens dropping first, no gap for an empty model. Row 3: today's action text (the next task changes it). Bottom border: `… 14 steps ───╯`. Border and status glyph in the status color. Number each agent once at start from a counter atom; the session-start rebuild numbers in list order and continues the counter. The Main card keeps today's three states in the new frame (the main-card task finishes it). Card width becomes `bodyColumns - 2` (`pane.tsx:356`).

**Check:** in a mounted pane at bodyColumns 48, a working agent's card draws five lines, the first starting `╭ 1 · `, the second ending `● running 0:01`, the last ending `steps ───╯`, every line 46 cells, every line a press that views that agent, border text colored `#ff8700`.

**Interfaces**
- Consumes: `util.ts` from shared-helpers.
- Produces: `AgentCard.number: number` (declared in `types/index.d.ts`); an `agentSeq` counter atom in `activity.ts`; `fmtClock(ms)` in `util.ts` (`9:52`, `1:02:03`); `STATUS_COLOR` and `cardRows($, cx, key, { number?, title, color, left, right, line2, line3, line3Dim, footer }, agentId?)` in `cards.tsx`, which the later tasks fill.

### Task: tool-calls

Capture each tool call as `Tool arg` and keep the last one. `before()` stores the cleaned call on the card (`call`) and the main activity; `after()` moves it to `lastCall` instead of clearing it. Row 3 draws `call` at full strength, else `lastCall` dimmed, else blank. Argument per tool: Read/Edit/Write/MultiEdit/NotebookEdit the path's last two parts; Grep and Glob the pattern; Agent/Task the description; Bash the program (basename, after `VAR=x` prefixes and `sudo`) plus its first bare-word subcommand (`npm run build` keeps the script name), taken from the first command only (before `|`, `&&`, `||`, `;`); unknown tools the name alone. A `clean(text)` in `util.ts` removes C0/C1 control characters, ESC sequences and bidi overrides/isolates (U+202A–202E, U+2066–2069, U+200E/200F), applied to titles, model ids and every argument before measuring.

**Check:** after a Grep for `cache.get` completes, the agent's card row 3 reads `Grep cache.get` and is dimmed; during the call it is not dimmed.

**Interfaces**
- Consumes: `cardRows`, `AgentCard.number` from card-frame.
- Produces: `toolCall(e): string` and `clean(text): string` (`activity.ts`, `util.ts`); `AgentCard.call?: string`, `AgentCard.lastCall?: string`; `MainActivity.call?: string`. `phrase()` stays for anything else that uses it.

**Test cases**
- Happy: Read `/repo/plugins/cairn/hooks/mod/cards.tsx` → row 3 `Read mod/cards.tsx`; Glob `**/*.test.ts` → `Glob **/*.test.ts`; Agent with description `Build · Checkout` → `Agent Build · Checkout`; Bash `npm run build -- --watch` → `Bash npm run build`; Bash `git commit -m "x"` → `Bash git commit`.
- Unhappy: an argument longer than the row is cut with `…` and the line still measures the card width; `WebFetch` → `WebFetch`; a tool call with no argument → the tool name; a card before its first call has a blank row 3 and five lines.
- Security: Bash `curl -H 'Authorization: Bearer abc123' https://x` → `Bash curl`, and `drawn(ui)` contains neither `abc123` nor `Bearer`; Bash `TOKEN=s3cret sudo /usr/bin/psql -c "select"` → `Bash psql`, no `s3cret`; Bash `cd x && npm test` → `Bash cd` (first command only, nothing after `&&`); Read of `a\x1b[31mb/c‮d.ts` draws without ESC, `[31m` or U+202E; an agent description containing `‮` and `\x07` draws without them.

### Task: doc-viewer

After the viewer's Approve press completes its confirm and approval, close the viewer (`closeDoc`) so the tab it was opened from shows again; a cancelled confirm leaves it open. A Records or Changelog entry with no record file draws with no Read all and no error (check today's short-note path at `pane.tsx:488`, `:525` and keep it).

**Check:** in `doc.test.tsx`, pressing Approve in an open viewer and confirming leaves `docOpen` null and the Now tab drawn; cancelling the confirm leaves the viewer open; a Records entry with no file draws without a Read all button.

**Interfaces**
- Consumes: none beyond card-frame's `pane.tsx` edits.
- Produces: none.

### Task: main-card

The Main card in the new frame: `● working m:ss` from the turn's start, `◷ waiting for you m:ss` while its question is open (wins over running agents), `○ idle m:ss` from the turn's end (a `mainIdleSince` atom set where `turnComplete` clears `mainActivity`, `activity.ts:206`); row 3 its tool call as tool-calls draws it, or `answer in the chat` while waiting; bottom border `2 running · 6 done` from the shown cards, empty with none. Order: Main, running oldest first, finished newest first (`pane.tsx:443`, `:558`). `LINGER_MS` becomes `{ done: 60_000, failed: 120_000 }` and `KEEP_ENDED_MS` 180_000 so pruning never cuts a linger. "running" replaces "working" for agents in `header.tsx:64,68`, `cards.tsx` and `idle()`.

**Check:** with the main turn ended 9 min 37 s ago and two agents working, the Main card's row 1 ends `○ idle 9:37` and its last line contains `2 running`; the header status line reads `2 running`; a done card started first is drawn below a running one started later; a card done 61 s ago is still drawn and one done 121 s ago is not.

**Interfaces**
- Consumes: `cardRows`, `fmtClock` (card-frame); `MainActivity.call`, `toolCall` (tool-calls).
- Produces: `mainIdleSince` atom and `readMainIdleSince($)`; `orderCards(cards)` in `cards.tsx`.

### Task: inline-fit

The inline 7-row view never exceeds 7 rows. When the fixed rows (`pane.tsx:433`) leave too little room, drop the repo-root "Showing" line first; whenever agent lines are hidden keep a `● +N more` line, N counting only agents; never return more lines than the budget. The one-line form is otherwise unchanged.

**Check:** inline with the repo-root fallback, a paused plan, an approval waiting, another active plan, and the main session plus five agents working draws at most 7 rows, one of them `● +N more agents`.

**Interfaces**
- Consumes: `agentLines` as main-card leaves it.
- Produces: none.
