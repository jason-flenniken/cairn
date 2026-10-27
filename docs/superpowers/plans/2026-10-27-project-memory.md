# Project memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give future agents and humans an accurate picture of what the system is now and why:
- living area docs, kept current by a check at close
- a repo-wide log of lasting decisions, with "replaced by" links
- `cairn recall` for any paths, fed into planning, building, and review
- a short index injected at session start
- a generated `OVERVIEW.md`
- a one-time `/cairn:map` to bootstrap

**Architecture:** Three pure modules in `cli/src/` hold the logic:
- `areas.ts`: area docs and their `paths:` frontmatter.
- `decision-log.ts`: the repo-wide decision files.
- `memory.ts`: recall, the index, OVERVIEW, and area History rendering.

One command module, `commands/memory.ts`, wires them into the CLI: `recall`, `index`, `area skip`, the close-time area check, and the post-close publish. Procedures and agent prompts are taught to call `cairn recall` and to keep area docs current. Everything is path-based and deterministic.

**Tech Stack:** TypeScript, `node:test`, `yaml` (already bundled) for frontmatter, esbuild bundle.

**Spec:** `docs/superpowers/specs/2026-10-27-project-memory-design.md`. Plan 1 (`docs/superpowers/plans/2026-10-27-cairn-folder.md`) must be done first; this plan uses its `paths.ts` constants.

## Global Constraints

- **Layout:**
  - Area docs: `docs/cairn/system/<area-id>.md`
  - Decision log: `docs/cairn/decisions/<id>.md`
  - Overview: `docs/cairn/OVERVIEW.md`
  - The index is computed live and never stored as a file.
- **Area doc frontmatter:** `area` (display name), `summary` (one line), `paths` (non-empty list of globs), and `updated` (free text). The area id is the file name without `.md` and must match `SLUG` (`util.ts`).
- **Area doc sections, in order:** `## Rules`, `## How it works`, `## Gotchas`, `## History`. History is generated: only the CLI writes it.
- **Decision ids:** `<YYYY-MM-DD>-<slug of the question's first 6 words>`. Add `-2`, `-3`, … on a clash.
- **`--lasting` requires** `--areas` or `--paths`. A `--replaces <id>` naming an unknown id refuses.
- **Close's area check** reads only the plan's commits (merge-base of `state.base` and HEAD, to HEAD) and runs before close writes anything. When no area docs exist, it warns and passes.
- **One skip per area or for uncovered files.** `cairn area skip <id> --note` and `cairn area skip --uncovered --note` each satisfy the check for that plan.
- **Recall's plan matches:** closed plans only, newest first, at most 5. A plan matches when its recorded touched areas include the area. For plans without that record, it matches when its task scopes overlap, ignoring the scope `**`.
- **The index caps at 60 lines.** Plans are dropped first. Then decisions collapse to one line of ids. Areas are never dropped.
- **Hooks never fail.** Any error building the index leaves the session-start output as it would be without the index.
- **Bundle and release:** run `npm run build` and commit `dist/cairn.mjs` after `cli/src/` changes. Bump `plugin.json` `0.5.0` to `0.6.0` at the end.
- **User-facing text** follows `references/reporting.md`.
- **Every new subcommand** (`recall`, `index`, `area`) is added to each `skills/*/SKILL.md` allow-list and to `SUBCOMMANDS` in `cli/test/skills.test.ts`.

## Review Focus

1. **A repo with no `docs/cairn/system/`**, which is every existing install: close still passes, with one logged warning that suggests `/cairn:map`. Test in Task 4.
2. **An area doc with broken frontmatter** (bad YAML, missing `paths`):
   - Close refuses and names the file.
   - `recall`, `index`, and session-start skip that doc instead of crashing.
   - Tests in Tasks 1 and 6.
3. **A fix plan's task scope is `**`.** It must not show up as touching every area in recall or History, so the recorded touched areas are used instead. Test in Task 6.
4. **A plan whose base branch no longer exists** (merge-base fails): close does not throw, and the area check becomes a warning. Test in Task 4.
5. **Session-start with many areas and decisions** stays at or under 60 lines, and an exception while building the index adds nothing. Test in Task 6.

---

### Task 1: Area docs (`areas.ts`)

**Files:**
- Create: `plugins/cairn/cli/src/areas.ts`, `plugins/cairn/templates/area.md`
- Test: `plugins/cairn/cli/test/areas.test.ts`

**Interfaces:**
- Consumes `DOCS_DIR` (Plan 1 `paths.ts`), `matchesAny` and `scopesOverlap` (`glob.ts`), `SLUG` (`util.ts`), and `parse` from `yaml`.
- Produces:
  ```ts
  export const SYSTEM_DIR = `${DOCS_DIR}/system`;
  export interface Area { id: string; name: string; summary: string; paths: string[]; file: string /* repo-relative */ }
  export function parseFrontmatter(md: string): { data: Record<string, unknown>; body: string } | undefined;
  export function loadAreas(root: string): { areas: Area[]; problems: string[] };
  export const areasForFile = (file: string, areas: Area[]): Area[];   // matchesAny(file, a.paths)
  export const areasForScopes = (globs: string[], areas: Area[]): Area[]; // scopesOverlap(globs, a.paths)
  ```
- Problem strings name the file:
  - `docs/cairn/system/x.md has no frontmatter`
  - `… frontmatter is not valid YAML: <msg>`
  - `… needs a non-empty paths list`
  - `… needs area and summary`
  - `… file name must be kebab-case`
  A doc with a problem is left out of `areas`.
- `templates/area.md` holds the frontmatter skeleton and the four sections from Global Constraints, each with one placeholder line. History holds only the generated-marker comment `<!-- Generated by cairn from the decision log and plan records. Edits here are overwritten. -->`.

- [ ] **Step 1: Write the failing tests** in `areas.test.ts`, on a tmp dir:
  - `loads a valid area`: write `docs/cairn/system/approvals.md` with `paths: [src/proof.ts, src/approve/**]`. Expect `areas[0]` to deep-equal `{ id: 'approvals', name: 'Approvals', summary: 'How approval is proven.', paths: [...], file: 'docs/cairn/system/approvals.md' }`, with `problems` empty.
  - `reports bad docs and skips them`: test each case: no frontmatter, `paths: []`, invalid YAML (`paths: [`), and a file named `Bad_Name.md`. Each yields one problem naming its file, and `areas` is empty.
  - `missing system dir`: `loadAreas(emptyDir)` gives `{ areas: [], problems: [] }`.
  - `areasForFile`: `src/approve/menu.ts` gives `['approvals']`, and `src/other.ts` gives none.
  - `areasForScopes`: `['src/approve/**']` and `['src/**']` both match `approvals`.
  - `template has the four sections`: read `templates/area.md`. It has frontmatter with `paths` and the headings `## Rules`, `## How it works`, `## Gotchas`, `## History`, in order.
- [ ] **Step 2: Run** `node --test plugins/cairn/cli/test/areas.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `areas.ts` and `templates/area.md`. Frontmatter is the block between a leading `---\n` and the next `\n---\n`.
- [ ] **Step 4: Run** the test, then `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** with the message `feat(cli): area docs with path frontmatter`.

### Task 2: The decision log (`decision-log.ts`)

**Files:**
- Create: `plugins/cairn/cli/src/decision-log.ts`
- Modify: `plugins/cairn/cli/src/types.ts` (add `PendingDecision`)
- Test: `plugins/cairn/cli/test/decision-log.test.ts`

**Interfaces:**
- Consumes `parseFrontmatter` (Task 1), `scopesOverlap`, and `stringify` and `parse` from `yaml`.
- Produces:
  ```ts
  // types.ts
  export interface PendingDecision { n: number; question: string; answer: string; why?: string; replaces?: string; areas: string[]; paths: string[]; at: string }
  // decision-log.ts
  export const DECISIONS_DIR = `${DOCS_DIR}/decisions`;
  export interface LoggedDecision { id: string; question: string; answer: string; why?: string; status: 'active' | 'replaced'; replacedBy?: string; replaces?: string; areas: string[]; paths: string[]; plan: string; date: string; file: string }
  export function loadDecisions(root: string): LoggedDecision[];               // unreadable files skipped
  export function decisionId(date: string, question: string, taken: Set<string>): string;
  export function activeDecisionsFor(globs: string[], areaIds: string[], all: LoggedDecision[]): LoggedDecision[];
  export function publishDecisions(root: string, plan: string, date: string, pending: PendingDecision[]): string[]; // repo-relative files written or changed
  ```
- File format. Frontmatter keys, in this order: `id`, `status` (`active` | `replaced`), `replaced_by`, `replaces`, `areas`, `paths`, `plan`, and `date`. Keys with no value are left out. The body is:
  ```
  # <question>

  **Decision:** <answer>

  **Why:** <why>          (line omitted when no why)
  ```
- `publishDecisions` writes one file per pending decision. For each `replaces`, it rewrites that file's frontmatter to `status: replaced` with `replaced_by: <new id>` and keeps its body unchanged.

- [ ] **Step 1: Write the failing tests:**
  - `decisionId`: `('2026-10-21', 'How should plan branches be named?', new Set())` gives `'2026-10-21-how-should-plan-branches-be-named'`. With that id already taken, it gives `…-named-2`.
  - `publish then load round-trips`: publish one pending decision with areas `['locate']` and paths `['src/locate.ts']`. `loadDecisions` returns it with `status: 'active'`, `plan`, `date`, and `file: 'docs/cairn/decisions/<id>.md'`.
  - `replaces marks the old one`: publish A, then B with `replaces: A.id`. Loading shows A as `replaced` with `replacedBy: B.id`, and B as `active`. A's body text is unchanged.
  - `activeDecisionsFor`:
    - Matches by path overlap (`['src/locate.ts']`) and by area id (`[]`, `['locate']`).
    - Never returns a replaced decision.
  - `skips a malformed file`: write a decision file without frontmatter. `loadDecisions` ignores it.
- [ ] **Step 2: Run** `node --test plugins/cairn/cli/test/decision-log.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Slug the question by lowercasing, replacing runs of non-`[a-z0-9]` with `-`, taking the first 6 words, and trimming dashes.
- [ ] **Step 4: Run** the test and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** with the message `feat(cli): repo-wide decision log with replaced-by links`.

### Task 3: `cairn decide --lasting`, `--promote`, and backfill outside a plan

**Files:**
- Modify: `plugins/cairn/cli/src/commands/plans.ts` (`cmdDecide`, `appendDecision`, new `parseDecisions`), `plugins/cairn/cli/src/types.ts` (`State.lasting?: PendingDecision[]`), `plugins/cairn/cli/src/main.ts` (`BOOLEAN` gains `lasting`; `USAGE`)
- Test: `plugins/cairn/cli/test/lasting.test.ts`

**Interfaces:**
- Consumes `loadDecisions`, `publishDecisions` (Task 2), and `loadAreas` (Task 1).
- Produces:
  - `parseDecisions(md: string): { n: number; question: string; answer: string; why?: string }[]`, which reads the `### n. question / **Decision:** / **Why:**` format that `appendDecision` writes.
  - The flags `--lasting`, `--areas a,b`, `--paths "g1,g2"` (both comma-separated), `--replaces <id>`, `--promote <n>`, `--plan <slug>`, and `--date YYYY-MM-DD`.
- **Behaviour on a plan:**
  - `--lasting` appends the decision as today, adds a line `**Lasting:** areas: a, b; paths: g1; replaces: <id>` under it, and pushes a `PendingDecision` onto `s.lasting` through `mutate(pc, undefined, …)`.
  - `--promote <n> --areas … [--replaces …]` flags an existing numbered decision in `decisions.md` the same way, without appending a new one.
  - Refusals:
    - `--lasting`/`--promote` without areas or paths: `a lasting decision needs --areas or --paths, so recall can find it`.
    - Unknown `--areas` id, when area docs exist.
    - `--replaces` not in `loadDecisions(pc.plan.worktree)`.
    - `--promote` of a number not in `decisions.md`, or one already lasting.
- **Behaviour off a plan** (backfill, used by `/cairn:map`): `cairn decide "<q>" "<a>" --lasting --areas … [--why] [--plan <slug>] [--date <d>]` publishes straight to the log with `publishDecisions(ctx.top, plan ?? 'map', date ?? today, [pending])`. Any other `decide` off a plan keeps today's error.

- [ ] **Step 1: Write the failing tests** (throwaway repo as in `lifecycle.test.ts`):
  - `lasting decision is stored and annotated`: on a new plan, `decide "Q1" "A1" --lasting --areas locate`. `state().lasting[0]` has `n: 1` and `areas: ['locate']`, and `decisions.md` contains `**Lasting:** areas: locate`.
  - `promote flags an existing decision`: `decide "Q2" "A2"`, then `decide --promote 2 --paths "src/**"`. `state().lasting` has `n: 2`.
  - `refuses lasting without scope`: matches `/needs --areas or --paths/`.
  - `refuses unknown replaces`: matches `/2026-01-01-nope/`.
  - `backfill off a plan publishes directly`: on main, `decide "Q3" "A3" --lasting --paths "src/**" --plan old --date 2026-10-01` writes `docs/cairn/decisions/2026-10-01-q3.md` with `plan: old`.
  - `parseDecisions reads appendDecision output`.
- [ ] **Step 2: Run** `node --test plugins/cairn/cli/test/lasting.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run typecheck && npm test`. Expected: PASS.
- [ ] **Step 5: Commit** with the message `feat(cli): lasting decisions, promote, and backfill`.

### Task 4: The area check at close, and `cairn area skip`

**Files:**
- Create: `plugins/cairn/cli/src/commands/memory.ts`
- Modify:
  - `plugins/cairn/cli/src/commands/stages.ts` (`closeGates`, `cmdClose`, the closing branch of `cmdAdvance`)
  - `plugins/cairn/cli/src/types.ts` (`State.areaSkips?: { area: string; note: string; at: string }[]`, `State.areasTouched?: string[]`)
  - `plugins/cairn/cli/src/commands.ts`, `plugins/cairn/cli/src/main.ts` (`area skip` dispatch; `uncovered` in `BOOLEAN`)
  - `plugins/cairn/cli/src/git.ts` (`commitPaths`)
- Test: `plugins/cairn/cli/test/area-check.test.ts`

**Interfaces:**
- Consumes `loadAreas`, `areasForFile` (Task 1), and `isCairnPath` (Plan 1).
- Produces:
  ```ts
  export const UNCOVERED = '(uncovered)';
  export interface AreaCheck { problems: string[]; fixes: string[]; warning?: string; touched: string[] }
  export function areaCheck(worktree: string, s: State): AreaCheck;
  export function cmdAreaSkip(ctx: Ctx, area: string | undefined, opts: Opts): Result;
  // git.ts
  export function commitPaths(cwd: string, paths: string[], message: string): boolean; // like commitPath, over several paths
  ```
- **`areaCheck`:**
  - Changed files come from `git diff --name-only <merge-base s.base HEAD> HEAD` in the worktree. If merge-base fails, it returns a warning `could not compare with <base>; area docs were not checked` and no problems.
  - Code files are the changed files that fail `isCairnPath`. A changed area doc is one whose `file` is in the changed list.
  - With no areas: warning `no area docs under docs/cairn/system; run /cairn:map to set them up`.
  - Frontmatter problems from `loadAreas` count as problems.
  - For each area that covers code files and was neither changed nor skipped, the problem is `docs/cairn/system/<id>.md covers files this plan changed (<up to 5>) but was not updated`.
  - When code files are covered by no area and `UNCOVERED` isn't skipped: `changed files belong to no area: <up to 10>`.
  - `touched` holds the ids of every area that covers a code file.
  - **Fixes:**
    1. `update each named area doc (Rules, How it works, Gotchas) for what this plan changed, and commit it on the plan branch`
    2. `or, when a doc needs no change: cairn area skip <area> --note "<why>"`
    3. `for files no area covers: add them to an area doc's paths, or create one from templates/area.md`
    4. `or: cairn area skip --uncovered --note "<why>"`
- **`closeGates`** takes the `AreaCheck`. It calls `gate(!c.problems.length, s, 'close', opts, c.problems.join('; '), c.fixes)`, logs `c.warning` as `warning: close`, and sets `s.areasTouched = c.touched`. `cmdClose` and the fix-track closing branch of `cmdAdvance` compute `areaCheck(pc.plan.worktree, pre)` before the lock, next to `runTests`.
- **`cairn area skip <id> --note "…"`** and **`cairn area skip --uncovered --note "…"`**:
  - Requires a plan and a note, and refuses an id that `loadAreas` doesn't know.
  - Pushes onto `s.areaSkips`, logs `area skip`, and commits with the message `area skip: <id>`.

- [ ] **Step 1: Write the failing tests** using the `learnPlan` helper pattern from `close-merged.test.ts`. Commit `docs/cairn/system/core.md` (paths `[src/core/**]`) on main first, then create the plan.
  - `no area docs: close passes and warns` (a repo without `system/`): `close` succeeds, and `state().log` has an entry with event `warning: close` matching `/cairn:map/`.
  - `covered change without doc update refuses`: commit `src/core/a.ts` on the plan branch. `close` is refused matching `/core\.md covers files this plan changed \(src\/core\/a\.ts\)/`.
  - `doc update satisfies it`: also edit and commit `docs/cairn/system/core.md`. `close` succeeds, and `state().areasTouched` deep-equals `['core']`.
  - `skip satisfies it`: `area skip core --note "rename only"`, then `close` succeeds.
  - `uncovered files refuse, skip passes`: commit `lib/x.ts`. The refusal matches `/belong to no area: lib\/x\.ts/`. After `area skip --uncovered --note n`, close passes.
  - `bad frontmatter refuses naming the file`.
  - `missing base branch warns, no throw`: set `state.base = 'gone'`. `close` succeeds, with a warning matching `/could not compare with gone/`.
  - `fix track checks too`: a fix plan at ship with an approved ship, a covered change, and no doc update. `advance` is refused with the same message.
  - `area skip refuses unknown id and missing note`.
- [ ] **Step 2: Run** `node --test plugins/cairn/cli/test/area-check.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run typecheck && npm test`. Existing close tests have no `system/` dir, so they should still pass with the warning. Expected: PASS.
- [ ] **Step 5: Commit** with the message `feat(cli): close checks area docs; cairn area skip`.

### Task 5: Publish at close: decisions, area History, and OVERVIEW

**Files:**
- Create: `plugins/cairn/cli/src/memory.ts`
- Modify:
  - `plugins/cairn/cli/src/commands/records.ts` (extract `planEntries`)
  - `plugins/cairn/cli/src/commands/memory.ts` (`writeMemory`)
  - `plugins/cairn/cli/src/commands/stages.ts` (call `writeMemory` after a successful close on both tracks)
  - `plugins/cairn/cli/src/commands/status.ts` (`cmdRender` writes OVERVIEW)
  - `plugins/cairn/cli/src/render.ts` (delete the now-unused `renderIndex`)
- Delete: `docs/cairn/INDEX.md` (`git rm`)
- Test: `plugins/cairn/cli/test/publish.test.ts`

**Interfaces:**
- Consumes Tasks 1–4 and `whyLine` (`records.ts`).
- Produces:
  ```ts
  // records.ts — listRecords is rebuilt on top of this
  export interface PlanEntry { state: State; dir: string; date: string; record?: string }
  export function planEntries(ctx: Ctx): PlanEntry[];
  // memory.ts
  export const OVERVIEW_REL = `${DOCS_DIR}/OVERVIEW.md`;
  export const HISTORY_MARK = '<!-- Generated by cairn from the decision log and plan records. Edits here are overwritten. -->';
  export function plansTouching(area: Area, plans: PlanEntry[]): PlanEntry[]; // closed; areasTouched, else scope overlap ignoring '**'; newest first
  export function historyLines(root: string, area: Area, decisions: LoggedDecision[], plans: PlanEntry[]): string[];
  export function withHistory(md: string, lines: string[]): string;          // replaces the body of '## History' (adds the section if missing)
  export function renderOverview(root: string, areas: Area[], decisions: LoggedDecision[], plans: PlanEntry[]): string;
  // commands/memory.ts
  export function writeMemory(pc: PlanCtx, s: State): string[]; // repo-relative paths changed
  ```
- **History lines.** Links are relative to the area doc. Decisions come first (active, then replaced), then plans:
  - `- Decision [<id>](../decisions/<id>.md): <answer> (in force)`, or `(replaced by <id>)`
  - `- <date> [<plan title>](<relative RECORD.md path>)`
- **OVERVIEW** opens with `# System overview` and a generated comment, then:
  1. `## Areas`: a table of Area | Summary | Doc.
  2. `## Decisions in force`: a table of Decision | Areas | Plan | Date.
  3. `## Replaced decisions`: Decision | Replaced by.
  4. `## Plans`: newest first, `- <date> **<title>**: <why line>. [record](…)`, with in-progress plans marked `(in progress: <stage>)`.
  An empty section says `None yet.`
- **`writeMemory`:**
  1. Publishes `s.lasting` with `publishDecisions(worktree, s.slug, today, s.lasting ?? [])`.
  2. Rewrites History in every area doc whose output changed.
  3. Writes OVERVIEW.
  4. Calls `commitPaths(worktree, [DECISIONS_DIR, SYSTEM_DIR, OVERVIEW_REL], 'cairn(<slug>): publish decisions and area history')` when `cfg.autoCommit`.
  A thrown error is caught and appended to the close message as `Warning: the decision log and area history were not updated (<msg>); run cairn render on main.`
- **`cmdRender` off a plan** writes `OVERVIEW_REL` and rewrites every area's History from `ctx.top`.

- [ ] **Step 1: Write the failing tests:**
  - `close publishes lasting decisions`: a plan with `decide … --lasting --areas core`, updated `core.md`, at learn. After `close`, `docs/cairn/decisions/<date>-…md` exists on the plan branch (`git show HEAD:…`), and the last commit's subject matches `/publish decisions and area history/`.
  - `close writes area History`: `core.md`'s History section contains the decision link and the plan's title and date. Running close's `writeMemory` again yields no diff (idempotent).
  - `withHistory replaces only History`: a doc with hand-written Rules and a stale History keeps its Rules byte-for-byte.
  - `renderOverview sections`: given 1 area, 1 active and 1 replaced decision, and 2 plans, the output contains the four headings, both decision ids, and the plans in date order.
  - `plansTouching ignores ** scopes`: a closed fix plan with scope `['**']` and no `areasTouched` does not touch `core`. A plan with `areasTouched: ['core']` does.
  - `render on main writes OVERVIEW.md, not INDEX.md`.
- [ ] **Step 2: Run** `node --test plugins/cairn/cli/test/publish.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** `git rm docs/cairn/INDEX.md` in this repo.
- [ ] **Step 4: Run** `npm run typecheck && npm test`. Update `records.test.ts` and any render test deliberately. Expected: PASS.
- [ ] **Step 5: Commit** with the message `feat(cli): close publishes decisions, area history, and OVERVIEW`.

### Task 6: `cairn recall`, `cairn index`, and the session-start index

**Files:**
- Modify: `plugins/cairn/cli/src/memory.ts` (`recall`, `memoryIndex`), `plugins/cairn/cli/src/commands/memory.ts` (`cmdRecall`, `cmdIndex`), `plugins/cairn/cli/src/commands/hooks.ts` (`hookSessionStart`), `plugins/cairn/cli/src/main.ts`, `plugins/cairn/cli/src/commands.ts`
- Test: `plugins/cairn/cli/test/recall.test.ts`

**Interfaces:**
- Consumes Tasks 1, 2, and 5.
- Produces:
  ```ts
  export interface RecallResult { areas: Area[]; decisions: LoggedDecision[]; plans: { slug: string; title: string; date: string; record?: string }[]; uncovered: string[] }
  export function recall(root: string, globs: string[], plans: PlanEntry[]): RecallResult;
  export function memoryIndex(root: string, plans: PlanEntry[], maxLines = 60): string; // '' when nothing is recorded
  export function cmdRecall(ctx: Ctx, globs: string[], opts: Opts): Result; // data: RecallResult
  export function cmdIndex(ctx: Ctx): Result;
  ```
- **`recall`:**
  - `areas` is `areasForScopes(globs)`.
  - `decisions` is `activeDecisionsFor(globs, areaIds)`.
  - `plans` is the union of `plansTouching` over the matched areas plus closed plans whose non-`**` task scopes overlap the globs. It's deduped, newest first, max 5.
  - `uncovered` holds the globs that no area overlaps, and is empty when there are no areas.
  - Root is `ctx.top`.
- **`cmdRecall` text:**
  ```
  Areas:
    <id>: <summary> (<file>)
  Decisions in force:
    <id>: <answer> (<file>)
  Past plans:
    <date> <title>: <record path>
  Not covered by any area: <globs>
  Area docs with problems: <loadAreas problems, joined with '; '>
  ```
  Empty sections are left out. `data` also carries `problems: string[]`. With nothing at all, it prints `Nothing recorded for these paths yet.` With no args, it prints the CliError `usage: cairn recall <path or glob>...`. `run` passes `pos.slice(1)`.
- **`memoryIndex`:**
  - First line: `cairn memory (full picture: docs/cairn/OVERVIEW.md). Before changing code, run \`cairn recall <paths>\`.`
  - Then `Areas:` with `- <id>: <summary>`.
  - Then `Decisions in force:` with `- <id>: <answer cut to 100 chars>`.
  - Then `Recent plans:` with up to 5 lines of `- <date> <title>`.
  - Over `maxLines`, drop Recent plans first, then replace the decisions list with one line: `Decisions in force: <id>, <id>, …`.
- **`cmdIndex`** prints the index, or `Nothing recorded yet. Run /cairn:map to set up area docs.`
- **`hookSessionStart`** builds the index in its own `try/catch` and adds it after the existing lines in every branch:
  - On a plan: after the plan summary.
  - No active plans: the index alone, plus Plan 1's migrate hint.
  - Active plans off-plan: after the plan list.
  On a closed plan it returns the index alone, not `''`.

- [ ] **Step 1: Write the failing tests:**
  - `recall finds area, decision, and plan`: set up area `core` (`src/core/**`), an active decision on area `core`, and a closed plan with `areasTouched: ['core']`. `recall(['src/core/a.ts'])` returns all three. The text output has the `Areas:`, `Decisions in force:`, and `Past plans:` lines.
  - `recall reports uncovered globs`: `['lib/**']` gives `uncovered: ['lib/**']`.
  - `recall skips a broken area doc`: a malformed area doc does not throw, and the other areas still match.
  - `fix plan with ** is not a recall match` unless `areasTouched` names the area.
  - `index caps at 60 lines`: 70 areas give exactly 70 area lines plus headings. 20 areas plus 50 decisions plus plans stay at 60 lines or fewer, with decisions collapsed into one line.
  - `session-start includes the index on main with no active plans`: `ctxOf(hookSessionStart({cwd: repo}))` contains `cairn memory` and `core:`.
  - `session-start survives a broken memory`: make `docs/cairn/system` a file, not a dir. The hook still returns its plan lines and does not throw.
  - `index with nothing recorded prints the map hint`.
- [ ] **Step 2: Run** `node --test plugins/cairn/cli/test/recall.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run typecheck && npm test`. Expected: PASS.
- [ ] **Step 5: Commit** with the message `feat(cli): cairn recall and the session-start memory index`.

### Task 7: Procedures and agents use the memory

**Files:**
- Modify:
  - `plugins/cairn/procedures/ship.md` step 3 and `plugins/cairn/procedures/fix.md` step 7 (update area docs and check lasting flags when the record is drafted)
  - `plugins/cairn/procedures/learn.md` (close refusals name area docs)
  - `plugins/cairn/procedures/discover.md` step 2, `plugins/cairn/procedures/plan.md` step 2, `plugins/cairn/procedures/execute.md` steps 4 and 5, `plugins/cairn/procedures/review.md` step 2
  - `plugins/cairn/agents/recorder.md`, `plugins/cairn/agents/implementer.md`, `plugins/cairn/agents/task-reviewer.md`, `plugins/cairn/agents/branch-reviewer.md`
  - `plugins/cairn/references/review-checklist.md`, `plugins/cairn/references/cli.md`, `README.md` (a short "Project memory" section)
  - every `plugins/cairn/skills/*/SKILL.md` (allow `recall`, `index`, and `area`) and `plugins/cairn/cli/test/skills.test.ts`
- Test: `plugins/cairn/cli/test/memory-doc.test.ts` (new)

**What each file must say:**
- **`ship.md` step 3 and `fix.md` step 7.**
  - After the record, dispatch the `recorder` (`model: sonnet`, `description` "Record · area docs") with:
    - the output of `cairn recall <files changed on the branch> --json`
    - `git diff <base>...<plan-branch> --stat`
    - the plan log
    - `decisions.md`
  - The recorder:
    - updates Rules, How it works, and Gotchas in each covering area doc
    - proposes a new area doc from `templates/area.md` for uncovered code that forms a coherent area
    - never edits `## History`
  - Then read `decisions.md`. Promote any decision that sets a rule for the whole repo and isn't yet lasting, with `cairn decide --promote <n> --areas …`.
  - Commit the area docs on the plan branch.
  - This puts the area docs in the PR the user approves. My call: the design said "at learn", but doing it here puts the update in front of the user at the ship stop, and the same step works on the fix track, which has no learn stage.
- **`learn.md` step 4:** when close refuses on area docs, update the named docs or record `cairn area skip … --note` with the reason. Never skip just to get past the check.
- **`discover.md` step 2:**
  - Replace "prior work in `docs/sdlc/`" with: run `cairn index`, and `cairn recall <paths the request touches>`. Give the output to the Explore agent.
  - Decisions in force are facts the interview must not re-ask, unless the request would change one.
  - A new decision that overturns one is recorded with `--lasting --replaces <id>`.
  - Tell the interviewer to flag a decision `--lasting` when it sets a rule later plans must follow.
- **`plan.md` step 2:** run `cairn recall` on the candidate task scopes. The plan must not contradict a decision in force without a replacing lasting decision.
- **`execute.md` step 4:** the implementer brief gains one part, "What to respect": the text output of `cairn recall <task scope globs>`. In step 5, the task reviewer gets the same text.
- **`review.md` step 2:** the branch reviewer gets `cairn recall <files changed on the branch>`.
- **`task-reviewer.md` and `branch-reviewer.md`:**
  - Code that contradicts a decision in force is a Required finding.
  - Its fix is "change the code, or record a decision that replaces `<id>` with `cairn decide --lasting --replaces <id>`".
  - It is not a finding when the plan's `decisions.md` already records such a replacement.
- **`implementer.md`:** follow the Rules in the recalled area docs, and report anything that contradicts them as a concern.
- **`review-checklist.md`:** one line under correctness or architecture: `Contradicts a decision in force (from cairn recall)`.
- **`cli.md`:** document `recall`, `index`, `area skip`, the new `decide` flags, close's area check and publish, and that `render` writes `OVERVIEW.md`. Keep each one in the file's existing style.
- **`recorder.md`:** an "Area docs" section covering the area doc format, the four sections, what goes in Rules versus Gotchas, and never touching History.

- [ ] **Step 1: Write the failing test** `memory-doc.test.ts`. It reads each file and asserts:
  - `ship.md` and `fix.md` contain `cairn recall` and `templates/area.md`, and `--promote`.
  - `learn.md` contains `cairn area skip`.
  - `discover.md`, `plan.md`, `execute.md`, and `review.md` contain `cairn recall`. `discover.md` no longer contains `prior work in`.
  - `task-reviewer.md` and `branch-reviewer.md` contain `decision in force` and `--replaces`.
  - `recorder.md` contains `## History` and `never`.
  - `cli.md` contains `cairn recall`, `cairn index`, `cairn area skip`, `--lasting`, and `OVERVIEW.md`.
  - Every skill allows `Bash(cairn recall:*)`, `Bash(cairn index:*)`, and `Bash(cairn area:*)`. This is covered by extending `SUBCOMMANDS`.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL on the new test.
- [ ] **Step 3: Edit** the docs as specified, keeping each file's voice and its `**Done when:**` pattern.
- [ ] **Step 4: Run** `npm test`. Expected: PASS. Existing doc tests that pin step numbers or phrases are updated deliberately where a step was renumbered.
- [ ] **Step 5: Commit** with the message `docs: procedures and agents read and keep project memory`.

### Task 8: `/cairn:map`

**Files:**
- Create: `plugins/cairn/skills/map/SKILL.md` (same frontmatter shape and allow-list as `skills/product/SKILL.md`, `description: "Map the codebase into area docs and backfill lasting decisions from past plans."`), `plugins/cairn/procedures/map.md`
- Test: `plugins/cairn/cli/test/memory-doc.test.ts` (extend)

**What `procedures/map.md` says** (same header lines and `## N.` with `**Done when:**` structure as `procedures/product.md`):
1. **Check:** run on main, outside any plan. If `docs/cairn/system/` already has docs, ask with AskUserQuestion: Extend (map only uncovered code) / Start over / Cancel.
2. **Survey:**
   - Dispatch Explore agents (`model: sonnet`) in parallel. One clusters the code into 4–12 areas by responsibility, each with path globs and a one-line summary. One reads every closed plan's `decisions.md` and `RECORD.md` and lists the decisions that still hold, each with the paths it governs.
   - Every area candidate cites `path:line`.
3. **Propose areas:** show the areas (id, summary, globs) in one compact list. Ask with AskUserQuestion: Approve / Revise (which?) / Cancel. Revise loops on the named areas.
4. **Draft the docs:**
   - Dispatch one `recorder` per area in parallel (`model: sonnet`, `description` "Record · area <id>"). Each writes `docs/cairn/system/<id>.md` from `templates/area.md`: Rules from code and decisions, How it works with entry files, and Gotchas from past records' Findings.
   - Then run `cairn recall <each area's globs>` and check that each area appears with no problems reported.
5. **Backfill decisions:**
   - For each decision from step 2 that the user would call architectural, run `cairn decide "<q>" "<a>" --why "…" --lasting --areas <ids> --plan <slug> --date <plan date>`.
   - Show the list first and let the user drop any in one AskUserQuestion (multiSelect).
6. **Render and commit:** run `cairn render`, then `git add docs/cairn && git commit -m "docs: map the codebase into area docs"`. Report in one line how many areas and decisions now exist, and that sessions will now load the index.

- [ ] **Step 1: Write the failing test:** `skills/map/SKILL.md` exists, `procedures/map.md` has headings `## 1.` through `## 6.`, and it contains `templates/area.md`, `cairn decide`, `--lasting`, `cairn render`, and `AskUserQuestion`.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Write** the skill and the procedure.
- [ ] **Step 4: Run** `npm test && claude plugin validate plugins/cairn`. Expected: PASS.
- [ ] **Step 5: Commit** with the message `feat: /cairn:map bootstraps area docs and the decision log`.

### Task 9: Map this repo, then release

This task runs in the main session, not a subagent, because steps 3 and 5 of the map procedure ask the user.

- [ ] **Step 1: Run** `npm run build`, then follow `plugins/cairn/procedures/map.md` against this repo, using `node plugins/cairn/dist/cairn.mjs` as `cairn`.
- [ ] **Step 2: Run** `node plugins/cairn/dist/cairn.mjs recall plugins/cairn/cli/src/locate.ts`. Expected: the area that covers it and the branch-naming decision backfilled from `standard-branch-names`.
- [ ] **Step 3: Run** `node plugins/cairn/dist/cairn.mjs index`. Expected: 60 lines or fewer, listing every area.
- [ ] **Step 4: Bump** `plugin.json` to `0.6.0`. Then run `npm run build && npm run typecheck && npm test && claude plugin validate plugins/cairn`. Expected: all pass.
- [ ] **Step 5: Commit** the area docs, decisions, OVERVIEW, `plugin.json`, and `dist/cairn.mjs` with the message `release: cairn 0.6.0 (project memory)`.
