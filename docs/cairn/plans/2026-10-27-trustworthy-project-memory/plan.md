# Plan: Trustworthy project memory

> Source: prd.md. Each task is a thin, complete path through every layer, demoable on its own, and fits one context window.

## Goal
Replace area docs, lasting decisions and recall with a per-plan `changelog.md` that feeds `OVERVIEW.md`, the session start and a new pane tab.

## Architecture
The CLI adds a changelog engine in `cli/src/memory.ts`:
- `planEntries` learns each plan's `changelog.md`, falling back to `whyLine` from RECORD.md.
- `renderChangelog` replaces `renderOverview`.
- `memoryIndex` becomes the five newest entries plus a pointer line.
- `cairn records --json` gains an `entry` field that the pane's new Changelog tab renders, reusing the Records tab's fetch and the `openDoc` viewer.

Removal follows: `areas.ts` and `decision-log.ts` go, the area check leaves `closeGates`, and `recall`, `area skip` and the lasting `decide` flags become plain refusals (exit 2). The procedures and agents swap the area-doc recorder pass for the changelog entry and drop recall. The repo's own area and decision folders are deleted and the six old plans are backfilled.

The decision "how is the pane laid out" (three tabs) is retired together with every decision file when `docs/cairn/decisions/` is deleted. This plan does not replace it.

## Global constraints
- Changelog entry file: `docs/cairn/plans/<date>-<slug>/changelog.md`, one paragraph, at most 120 words.
- Session start: at most 5 entries, each cut to 120 words, plus one pointer line naming `docs/cairn/OVERVIEW.md`. Empty output when no plan is closed.
- Control characters are stripped (except `\n` and `\t`) before entry text reaches the session start, `records --json` or the pane.
- Removed commands and flags refuse through `Refusal` (exit 2) with a message naming the changelog as the replacement.
- cairn never modifies or deletes `docs/cairn/system/` or `docs/cairn/decisions/` in a repo. Only the repo-docs task deletes them, and only in this repo.
- Only the release task rebuilds `plugins/cairn/dist/cairn.mjs`. The others leave it alone, to avoid merge conflicts on the bundle.
- This plan closes with the branch's own CLI (`node plugins/cairn/dist/cairn.mjs close`), not the installed 0.6.0, so no decision files are published.

## Phases

```yaml cairn-tasks
phases:
  - id: changelog-core
    name: Changelog in the CLI
    tasks:
      - id: changelog-engine
        name: Changelog engine
        covers: [FR-03, FR-04, FR-05]
        blocked_by: []
        scope: ["plugins/cairn/cli/src/memory.ts", "plugins/cairn/cli/src/commands/memory.ts", "plugins/cairn/cli/src/commands/records.ts", "plugins/cairn/cli/src/commands/status.ts", "plugins/cairn/cli/src/util.ts", "plugins/cairn/cli/test/changelog.test.ts", "plugins/cairn/cli/test/publish.test.ts", "plugins/cairn/cli/test/recall.test.ts", "plugins/cairn/cli/test/records.test.ts", "plugins/cairn/cli/test/legacy-paths.test.ts"]
        complexity: standard
        risky: true
        riskReason: "model-written entry text reaches every session start and the pane"
  - id: switch-over
    name: Remove the old memory and wire the changelog everywhere
    tasks:
      - id: cli-removals
        name: Remove recall, area check and lasting decisions
        covers: [FR-11, FR-12, FR-14]
        blocked_by: [changelog-engine]
        scope: ["plugins/cairn/cli/src/areas.ts", "plugins/cairn/cli/src/decision-log.ts", "plugins/cairn/cli/src/memory.ts", "plugins/cairn/cli/src/commands/memory.ts", "plugins/cairn/cli/src/commands/stages.ts", "plugins/cairn/cli/src/commands/plans.ts", "plugins/cairn/cli/src/commands.ts", "plugins/cairn/cli/src/main.ts", "plugins/cairn/cli/src/types.ts", "plugins/cairn/cli/test/areas.test.ts", "plugins/cairn/cli/test/area-check.test.ts", "plugins/cairn/cli/test/decision-log.test.ts", "plugins/cairn/cli/test/lasting.test.ts", "plugins/cairn/cli/test/recall.test.ts", "plugins/cairn/cli/test/publish.test.ts", "plugins/cairn/cli/test/removed.test.ts", "plugins/cairn/cli/test/lifecycle.test.ts"]
        complexity: standard
        risky: true
        riskReason: "changes the public CLI and must never touch user-owned area or decision files"
      - id: changelog-tab
        name: Changelog tab in the pane
        covers: [FR-06, FR-07, FR-08]
        blocked_by: [changelog-engine]
        scope: ["plugins/cairn/hooks/mod/pane.tsx", "plugins/cairn/hooks/NOTES.md", "plugins/cairn/types/index.d.ts", "plugins/cairn/hooks/test/**"]
        complexity: standard
        risky: true
        riskReason: "renders model-written text in the terminal"
      - id: procedures-and-agents
        name: Procedures and agents write the changelog, drop recall
        covers: [FR-01, FR-02, FR-09, FR-10, FR-11]
        blocked_by: [changelog-engine]
        scope: ["plugins/cairn/procedures/**", "plugins/cairn/agents/**", "plugins/cairn/skills/**", "plugins/cairn/templates/**", "plugins/cairn/references/review-checklist.md", "plugins/cairn/cli/test/memory-doc.test.ts", "plugins/cairn/cli/test/skills.test.ts"]
        complexity: standard
        risky: false
  - id: repo-and-release
    name: This repo's memory, docs and release
    tasks:
      - id: repo-docs
        name: README, CLI reference and this repo's backfill
        covers: [FR-13, FR-15]
        blocked_by: [cli-removals, procedures-and-agents]
        scope: ["README.md", "CLAUDE.md", "plugins/cairn/references/cli.md", "docs/cairn/system/**", "docs/cairn/decisions/**", "docs/cairn/plans/2026-10-20-cairn-v0-2/changelog.md", "docs/cairn/plans/2026-10-21-*/changelog.md", "plugins/cairn/cli/test/memory-readme-doc.test.ts"]
        complexity: standard
        risky: true
        riskReason: "deletes the repo's area and decision folders"
      - id: release
        name: Version bump and bundle
        covers: [FR-16]
        blocked_by: [repo-docs, cli-removals, changelog-tab]
        scope: ["plugins/cairn/.claude-plugin/plugin.json", "plugins/cairn/dist/**"]
        complexity: simple
        risky: false
```

### Task: changelog-engine

**Check:** `cairn render` on a repo with closed plans writes an OVERVIEW.md that is a newest-first changelog. `cairn index` prints the five newest entries plus the pointer line.

The task rewrites the following and leaves `recall`, `areas.ts` and `decision-log.ts` in place for the removal task:
- `refreshMemory`/`writeMemory` write only OVERVIEW.md, with no History and no decision publishing.
- `renderOverview` becomes `renderChangelog`.
- `memoryIndex`.
- The `cmdRender` message.

**Interfaces**
- Consumes: `planEntries(ctx)`, `whyLine(md)`, and `recordRel(root, e)` (existing).
- Produces:
  - `stripControl(s: string): string` in `util.ts`.
  - `PlanEntry.changelog?: string`: the absolute path to `changelog.md`, resolved in the plan folder, else the main checkout.
  - `changelogText(e: PlanEntry): string`: the entry paragraph, else the `whyLine` fallback, else `''`. Control characters are stripped.
  - `renderChangelog(root: string, plans: PlanEntry[]): string`: one `## <date> · <title>` block per closed plan, holding the paragraph and a relative record link.
  - `memoryIndex(root, plansOf): string`: at most 5 entries cut to 120 words, plus the pointer line. Returns `''` with no closed plans. A plan whose files cannot be read is skipped.
  - `RecordEntry.entry?: string` in `cairn records --json`.
  - `cmdIndex` prints nothing (not a blank line) when the index is empty.

**Test cases**
- Happy: three closed plans, two with `changelog.md` and one with only RECORD.md. OVERVIEW lists all three newest first, with paragraphs, the fallback sentence, and relative record links that resolve. There are no "Areas" or "Decisions" headings.
- Happy: with seven closed plans, `memoryIndex` holds exactly the five newest entries and ends with the line naming `docs/cairn/OVERVIEW.md`.
- Unhappy: with no closed plans, `memoryIndex` returns `''` and `cairn index` prints nothing.
- Unhappy: a plan with neither `changelog.md` nor RECORD.md shows its date and title only. A `changelog.md` that cannot be read (for example, it is a directory) is skipped, and the other entries still print.
- Unhappy: a 200-word entry is cut to 120 words in the index, and OVERVIEW keeps it whole.
- Security: an entry containing `\x1b[2J` and `\x07` comes out of `memoryIndex` and `records --json` without those bytes. Newlines are kept.

### Task: cli-removals

**Check:** each of the following exits 2 with a message pointing to the changelog:
- `cairn recall x`
- `cairn area skip a --note n`
- `cairn decide q a --lasting --areas a`
- `cairn decide --promote 1 --areas a`

A plain `cairn decide q a --why w` still appends to `decisions.md`.

**What it removes:**
- `areas.ts`, `decision-log.ts` and `recall` are deleted. `areaCheck` and `cmdAreaSkip` go too.
- The area gate is removed from `closeGates`, `cmdAdvance` and `cmdClose`.
- In `decide`, the lasting, promote, replaces, areas, paths, plan and date options are removed, along with the lasting keys in `--file`. Keep `lasting` in the boolean flag set, so the flag doesn't swallow the next argument before it is refused.
- `lasting`, `areaSkips`, `areasTouched` and `PendingDecision` are dropped from the types. Old state files still load.
- The usage text and `SUBCOMMANDS` in `skills.test.ts` are updated.

**Interfaces**
- Consumes: `closeMemory`, `memoryIndex` and `renderChangelog` from changelog-engine.
- Produces:
  - Refusal messages of the form `"<command> was removed; the changelog in docs/cairn/OVERVIEW.md replaces it."`
  - A `cairn close` with no area check.

**Test cases**
- Happy: a plain `decide` records decision n in `decisions.md`, with no `**Lasting:**` line.
- Happy: closing a feature plan and closing a fix plan through `advance` both succeed in a repo with no area docs. Both write OVERVIEW.md, and neither creates `docs/cairn/decisions/`.
- Unhappy: each removed command or flag exits 2 with the refusal text. A `--file` JSON with a `lasting` key is refused as well.
- Security: close a plan in a repo that has `docs/cairn/system/a.md` and `docs/cairn/decisions/x.md`, with code changes the old area check would have flagged. The close succeeds, and both files are byte-identical afterwards.
- Security: a state.json carrying old `lasting`, `areaSkips` and `areasTouched` fields loads and closes without publishing anything.

### Task: changelog-tab

**Check:** the docked pane shows four tabs. Changelog lists entries newest first, with the date and title emphasized and the paragraph wrapped. Clicking an entry opens its RECORD.md.

The Changelog tab uses `cairn records --json`'s `entry` field, the same fetch, poll and `frame` as Records, and `openDoc` for clicks. The pane strips control characters itself before rendering. NOTES.md gets one line on the tab.

**Interfaces**
- Consumes: `RecordEntry.entry?: string` from `cairn records --json`.
- Produces:
  - The `tab` atom union widened with `'changelog'`.
  - `CairnRecord.entry?: string` in `types/index.d.ts`.

**Test cases**
- Happy: the tab keys are `tab:now`, `tab:history`, `tab:records` and `tab:changelog`. Pressing Changelog shows the closed plans' entries in date order with their text. Open plans are left out.
- Happy: clicking an entry opens that plan's RECORD.md in the document viewer, and Back returns to the Changelog tab.
- Unhappy: with no closed plans, the tab shows one empty-state line. When `records --json` fails after a good read, the tab keeps the last entries.
- Security: an entry containing `\x1b[2J` is rendered without the escape byte.
- Layout: the tab keeps the padding and the pinned bar (extend the existing loops in `pane.test.tsx` and `bar.test.tsx`).

### Task: procedures-and-agents

**Check:** `memory-doc.test.ts` passes with the new assertions:
- `ship.md`, `fix.md` and `recorder.md` require `changelog.md` (at most 120 words, what, why, big rocks) before the ship approval, and the ship and fix stops show it.
- `discover.md` hands its research agent `docs/cairn/OVERVIEW.md`.
- No file in `procedures/`, `agents/` or `references/` mentions `cairn recall`, area docs, "decision in force" or "What to respect".

**What it changes:**
- `skills/map/`, `procedures/map.md` and `templates/area.md` are deleted.
- The `area` and `recall` allowed-tools lines are dropped from every skill.
- Lasting and promote are removed from `discover.md` and `plan.md`.
- The area-skip sentence is dropped from `learn.md`.
- The recorder's Area docs section becomes a Changelog entry section.

**Interfaces**
- Consumes: the `changelog.md` location and the 120-word limit from Global constraints.
- Produces: the recorder instruction that writes `docs/cairn/plans/<date>-<slug>/changelog.md`.

### Task: repo-docs

**Check:** the following are absent on the branch:
- `docs/cairn/system/`
- `docs/cairn/decisions/`
- `recall`, `area skip` and the lasting flags in `references/cli.md`

`node plugins/cairn/dist/cairn.mjs render` (after a local build) shows a paragraph, not a fallback sentence, for all six earlier plans. The new doc test passes against the README's Project memory section.

**What it changes:**
- Each `changelog.md` is written from its plan's RECORD.md: what was built, why, and the big rocks, at most 120 words.
- The README's Project memory section is rewritten, and the tab list goes from three to four.
- `CLAUDE.md` adds `changelog.md` to the plan folder contents.

**Interfaces**
- Consumes: the refusal wording from cli-removals and the `index`/`render`/`records` behavior from changelog-engine, for `cli.md`.
- Produces: none.

**Test cases**
- Happy: six `changelog.md` files exist, each one paragraph of at most 120 words, and `cairn render` uses them.
- Unhappy: `memory-readme-doc.test.ts` fails if the README still mentions `cairn recall` or area docs as current features.
- Security: the diff deletes only paths under `docs/cairn/system/` and `docs/cairn/decisions/`. No other file is removed.

### Task: release

**Check:** `plugins/cairn/.claude-plugin/plugin.json` has version `0.7.0`, and `npm run build` leaves `plugins/cairn/dist/cairn.mjs` unchanged after commit. `npm run typecheck && npm test` passes, and `claude plugin validate plugins/cairn` passes.

**Interfaces**
- Consumes: all source changes.
- Produces: the committed bundle.
