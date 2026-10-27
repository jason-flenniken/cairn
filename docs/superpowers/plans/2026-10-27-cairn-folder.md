# cairn folder move Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move cairn's files from `.sdlc/` to `.cairn/` and from `docs/sdlc/` to `docs/cairn/`. Repos and plan branches still on the old paths keep working.

**Architecture:** One new module, `cli/src/paths.ts`, owns every folder name. Code that reads checks the new path first and then the legacy one. Code that writes always uses the new path. A `cairn migrate` command moves an existing repo over with `git mv`. The mod's state-file guard covers both roots.

**Tech Stack:** TypeScript (Node runs `.ts` directly in tests), `node:test`, esbuild bundle at `plugins/cairn/dist/cairn.mjs`, Claude Code mod (`hooks/`, tested with `claude plugin test`).

**Spec:** `docs/superpowers/specs/2026-10-27-project-memory-design.md` (sections "Decisions made with the user" 5, "Calls I made", "Plan 1: the folder move").

## Global Constraints

- **New paths:** `.cairn/config.json`, `docs/cairn/plans/<date>-<slug>/`, and `docs/cairn/product/`. **Legacy paths:** `.sdlc/config.json`, `docs/sdlc/plans/`, and `docs/sdlc/product/`.
- Legacy paths are read, never written. New plans, the product PRD, and render output always go to the new paths.
- If both `.cairn/config.json` and `.sdlc/config.json` exist, `.cairn` wins, and `cairn status` warns.
- The CLI has zero runtime deps beyond what is already bundled (`yaml`).
- After any change in `cli/src/`, run `npm run build` and commit `plugins/cairn/dist/cairn.mjs`.
- Bump `plugins/cairn/.claude-plugin/plugin.json` `version` from `0.4.0` to `0.5.0`.
- `plugins/cairn/types/index.d.ts` stays self-contained (no `import`).
- User-facing text follows `plugins/cairn/references/reporting.md`: outcome first, plain words, no internal ids.
- All verification is `npm run typecheck && npm test`, run from the repo root.

## Review Focus

1. **A plan branch made before the upgrade with no worktree** (state only on the branch, under `docs/sdlc/plans/`): `cairn status --all` and `cairn records` still list it. Test in Task 2.
2. **A write to `docs/cairn/plans/x/state.json`** is denied by the mod guard exactly like the legacy path. A regression here is a security hole. Test in Task 4.
3. **Edits under `docs/cairn/` or `.cairn/`** are never logged as out-of-scope drift by the post-edit hook, and neither are the legacy roots. Test in Task 3.
4. **`cairn migrate` with an in-flight plan or a dirty tree** refuses and names why. A second run says there is nothing to migrate. Test in Task 5.
5. **A repo with both config files:** the `.cairn` values apply, and status shows one warning. Test in Task 1.

---

### Task 1: Path constants and the config fallback

**Files:**
- Create: `plugins/cairn/cli/src/paths.ts`
- Modify: `plugins/cairn/cli/src/config.ts`
- Modify: `plugins/cairn/cli/src/commands/status.ts` (`warnings`)
- Test: `plugins/cairn/cli/test/paths.test.ts`

**Interfaces:**
- Produces, in `paths.ts`:
  - `CAIRN_DIR = '.cairn'`, `LEGACY_CAIRN_DIR = '.sdlc'`, `DOCS_DIR = 'docs/cairn'`, and `LEGACY_DOCS_DIR = 'docs/sdlc'`.
  - `DOCS_DIRS: readonly string[]`, which is `[DOCS_DIR, LEGACY_DOCS_DIR]`.
  - `isCairnPath(rel: string): boolean`. True for anything under either docs root, either config root, or `.claude/`, which are the paths the edit hook ignores.
  - `cairnPathspecExcludes(): string[]`, which returns `[':!docs/cairn', ':!docs/sdlc']`.
- Produces, in `config.ts`:
  - `CONFIG_REL = '.cairn/config.json'` and `LEGACY_CONFIG_REL = '.sdlc/config.json'`.
  - `configWarning(root: string): string | undefined`.
  - `loadConfig` keeps its signature. For each root it reads `CONFIG_REL` first and falls back to `LEGACY_CONFIG_REL`. A JSON error names the file that was actually read.

- [ ] **Step 1: Write the failing tests** in `paths.test.ts`, building a throwaway dir with `mkdtempSync`:
  - `loadConfig reads .cairn/config.json`: write `{"test":"t1"}`, then `assert.equal(loadConfig(dir).test, 't1')`.
  - `loadConfig falls back to .sdlc/config.json`: write only the legacy file with `{"test":"t2"}`, then expect `'t2'`.
  - `.cairn wins when both exist`: write both, then expect the `.cairn` value. `configWarning(dir)` matches `/both .cairn\/config.json and .sdlc\/config.json/`.
  - `configWarning is undefined with one file`.
  - `isCairnPath`: true for `docs/cairn/plans/x/state.json`, `docs/sdlc/plans/x/a.md`, `.cairn/config.json`, `.sdlc/config.json`, and `.claude/worktrees/x`. False for `docs/cairnish.md` and `src/a.ts`.
- [ ] **Step 2: Run** `node --test plugins/cairn/cli/test/paths.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `paths.ts` and the `config.ts` changes. Then add `configWarning(pc.plan.worktree)`, when set, to the list `warnings()` returns in `commands/status.ts`.
  - Warning text: `both .cairn/config.json and .sdlc/config.json exist; .cairn/config.json is used. Delete .sdlc/config.json.`
- [ ] **Step 4: Run** the same test, then `npm run typecheck && npm test`. Expected: PASS.
- [ ] **Step 5: Commit** with the message `feat(cli): .cairn config path with .sdlc fallback`.

### Task 2: Plan folders under both docs roots

**Files:**
- Modify: `plugins/cairn/cli/src/locate.ts` (`PLANS_DIR`, `resolvePlanDir`, `planRel`)
- Modify: `plugins/cairn/cli/src/commands/plans.ts` (`cmdNew` writes `PLANS_DIR`, `cmdProductInit` writes `${DOCS_DIR}/product`)
- Modify: `plugins/cairn/cli/src/commands/records.ts:38`, `plugins/cairn/cli/src/commands/suggest.ts:35`, `plugins/cairn/cli/src/commands/status.ts:61`
- Test: `plugins/cairn/cli/test/dated-folders.test.ts` (extend), `plugins/cairn/cli/test/legacy-paths.test.ts` (new)

**Interfaces:**
- Consumes `DOCS_DIR` and `LEGACY_DOCS_DIR` from Task 1.
- Produces, in `locate.ts`:
  - `PLANS_DIR = 'docs/cairn/plans'`, `LEGACY_PLANS_DIR = 'docs/sdlc/plans'`, and `PLANS_DIRS = [PLANS_DIR, LEGACY_PLANS_DIR]`.
  - `resolvePlanDir` keeps its signature. It searches `PLANS_DIRS` in order, applying the existing `pickPlanDir` rule within each, and returns the first hit, prefixed with the root it was found under.
  - `plansDirsIn(root: string): string[]` returns the absolute plan dirs that exist under `root`, new root first.
  - `planRel(slug)` keeps using `PLANS_DIR`.
- `records.ts` and `suggest.ts` scan every dir from `plansDirsIn(main)` (or `ctx.top`) instead of one. A slug found under both roots counts once, and the new root wins.
- `status.ts:61` computes the plan's relative folder as `relative(r.worktree ?? ctx.mainRoot, r.dir)`, not `${PLANS_DIR}/${basename(r.dir)}`.

- [ ] **Step 1: Write the failing tests** in `legacy-paths.test.ts`, building a throwaway repo the way `lifecycle.test.ts` does:
  - `new plans land under docs/cairn/plans`: `run(['new','alpha','--title','A'], repo)`. Its `data.dir` matches `/docs\/cairn\/plans\/\d{4}-\d{2}-\d{2}-alpha$/`.
  - `a legacy plan branch with no worktree is still listed`:
    1. Create branch `feature/old` by hand, with `docs/sdlc/plans/2026-10-01-old/state.json` committed. The state comes from `newState('old','Old','feature','feature/old','main')` with stage `closed`.
    2. Run `run(['status','--all','--json'], repo).data.plans`. It contains slug `old`.
    3. `run(['records'], repo).message` includes `Old`.
  - `a legacy plan checked out in a worktree resolves`: `git worktree add` the branch, then `run(['status','--json'], thatWorktree).data.state.slug === 'old'`.
  - `product init writes docs/cairn/product/PRD.md`.
- [ ] **Step 2: Run** `node --test plugins/cairn/cli/test/legacy-paths.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the interface changes above.
- [ ] **Step 4: Run** `npm run typecheck && npm test`. Update tests that hard-code `docs/sdlc/plans` for *new* plans (for example `dated-folders.test.ts`, `records.test.ts`, `fix.test.ts`, `levels.test.ts`, `branch-guard.test.ts`, `step.test.ts`, `lifecycle.test.ts`) to the new path. Leave any assertion that is explicitly about legacy folders. Expected: PASS.
- [ ] **Step 5: Commit** with the message `feat(cli): plans under docs/cairn, legacy docs/sdlc still read`.

### Task 3: The cairn-docs exclusions cover both roots

**Files:**
- Modify: `plugins/cairn/cli/src/commands/tasks.ts:137-146`
  - The stray check (`!f.startsWith('docs/sdlc/')`) becomes `!isCairnPath(f)`.
  - The refusal text "outside docs/sdlc" becomes "outside cairn's files".
- Modify: `plugins/cairn/cli/src/commands/phase.ts:33,38`
  - Update the same text.
  - The test-reuse diff uses `...cairnPathspecExcludes()` in place of `':!docs/sdlc'`.
- Modify: `plugins/cairn/cli/src/commands/hooks.ts:28,49`
  - The task line says `Never edit docs/cairn/.`
  - The ignore check becomes `isCairnPath(rel)`.
- Modify: `plugins/cairn/cli/src/commands/status.ts:120`
  - `cmdRender` writes `${DOCS_DIR}/INDEX.md`.
- Modify: `plugins/cairn/cli/src/commands/fix.ts:29`
  - Its text names `.cairn/config.json`.
- Test: `plugins/cairn/cli/test/legacy-paths.test.ts` (extend)

**Interfaces:**
- Consumes `isCairnPath`, `cairnPathspecExcludes`, `DOCS_DIR`, and `CONFIG_REL` from Task 1.

- [ ] **Step 1: Write the failing tests:**
  - `post-edit ignores both docs roots`: on a plan in execute, `hookPostEdit({ cwd: wt, tool_input: { file_path: join(wt,'docs/cairn/system/a.md') } })` returns `''`. The same holds for `docs/sdlc/x.md` and `.cairn/config.json`. `state().drift` is empty.
  - `render writes docs/cairn/INDEX.md` on main.
- [ ] **Step 2: Run** the test. Expected: FAIL on the `docs/cairn` cases.
- [ ] **Step 3: Implement** the edits listed under Files.
- [ ] **Step 4: Run** `npm run typecheck && npm test`. Expected: PASS. Update assertions on the old refusal text deliberately.
- [ ] **Step 5: Commit** with the message `refactor(cli): cairn file exclusions cover docs/cairn and docs/sdlc`.

### Task 4: The mod reads and guards both roots

**Files:**
- Modify: `plugins/cairn/hooks/mod/guards.ts:420-422`
  - `PLAN_FILE` becomes `/\/docs\/(?:cairn|sdlc)\/plans\/[^/]+\/(state\.json|status\.md)$/i`.
  - Fix the comment above it.
- Modify: `plugins/cairn/hooks/mod/pause.ts:130,142`
  - The handoff path uses the plan row's `dir` when present (as `pane.tsx:70` does), otherwise `${worktree}/docs/cairn/plans/${slug}`.
  - The config read tries `.cairn/config.json`, then `.sdlc/config.json`.
- Modify: `plugins/cairn/hooks/mod/pane.tsx:70`
  - The fallback uses `docs/cairn/plans`.
- Modify: `plugins/cairn/hooks/NOTES.md:119-121`
- Test: `plugins/cairn/hooks/test/guards.test.ts`, `plugins/cairn/hooks/test/pause.test.ts`, `plugins/cairn/hooks/test/world.tsx`, `plugins/cairn/hooks/test/pane.test.tsx`

**Interfaces:**
- None new. This task's contract is the guard regex.

- [ ] **Step 1: Write the failing tests** in `guards.test.ts`:
  - For each existing denied-command case written against `docs/sdlc/plans/x/state.json`, add the same case against `docs/cairn/plans/x/state.json`. A table loop over both roots is fine.
  - Keep every legacy case.
  - In `pause.test.ts`, add a case where config lives at `.cairn/config.json` and `resumeFreshAfterMinutes` is honoured.
- [ ] **Step 2: Run** `npm run test:mod`. Expected: FAIL on the `docs/cairn` cases.
- [ ] **Step 3: Implement** the edits listed under Files. Update `world.tsx` fixtures so new plans live under `docs/cairn/plans`.
- [ ] **Step 4: Run** `npm run test:mod`. Expected: PASS.
- [ ] **Step 5: Commit** with the message `feat(mod): guard and read plans under docs/cairn too`.

### Task 5: `cairn migrate`

**Files:**
- Create: `plugins/cairn/cli/src/commands/migrate.ts`
- Modify: `plugins/cairn/cli/src/commands.ts` (re-export), `plugins/cairn/cli/src/main.ts` (dispatch and `USAGE`), `plugins/cairn/cli/src/commands/hooks.ts` (`hookSessionStart` hint)
- Modify: every `plugins/cairn/skills/*/SKILL.md` (add `"Bash(cairn migrate:*)"`), `plugins/cairn/cli/test/skills.test.ts` (`SUBCOMMANDS` gains `migrate`)
- Test: `plugins/cairn/cli/test/migrate.test.ts`

**Interfaces:**
- Produces:
  - `cmdMigrate(ctx: Ctx): Result`.
  - `legacyLayout(root: string): string[]`, the legacy paths present under `root`, out of `.sdlc` and `docs/sdlc`.
- Behaviour:
  - Refuse with `Refusal` when any of these holds:
    - `ctx.plan` is set. Message: `run cairn migrate on the main branch, outside any plan`.
    - Any `listPlans(ctx)` row has stage other than `closed`. The message names those plans. Fix: `finish or close them first`.
    - `git status --porcelain` is non-empty. Fix: `commit or stash your changes first`.
  - For each legacy root:
    - If the new root doesn't exist, `git mv <old> <new>`.
    - If it exists, `git mv` each child that the new root doesn't already have, and refuse on a name clash, naming it.
    - Untracked legacy files (not in `git ls-files`) are moved with `renameSync`.
  - If `cfg.autoCommit`, commit with the message `cairn: move .sdlc to .cairn and docs/sdlc to docs/cairn`.
  - Message: `Moved .sdlc/ to .cairn/ and docs/sdlc/ to docs/cairn/.` (only the parts that applied). With nothing to move: `Nothing to migrate: this repo already uses .cairn/ and docs/cairn/.`
  - `hookSessionStart`, when no plan is active and `legacyLayout(ctx.mainRoot)` is non-empty, adds the line `cairn: this repo still uses <paths>; run \`cairn migrate\` on main to move them.`

- [ ] **Step 1: Write the failing tests** in `migrate.test.ts`:
  - `moves both roots and commits`: a repo with committed `.sdlc/config.json` and `docs/sdlc/plans/2026-10-01-old/state.json` (closed). After `run(['migrate'], repo)`:
    - `.cairn/config.json` and `docs/cairn/plans/2026-10-01-old/state.json` exist, and the old paths don't.
    - `git log -1 --format=%s` is the commit message above.
  - `second run is a no-op`: the message matches `/Nothing to migrate/`.
  - `refuses with an in-flight plan`: after `run(['new','live','--title','L'], repo)`, refusal matches `/live/`.
  - `refuses on a dirty tree`.
  - `session-start hints on a legacy repo`: `hookSessionStart({cwd: repo})` output contains `cairn migrate`.
- [ ] **Step 2: Run** `node --test plugins/cairn/cli/test/migrate.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `cmdMigrate`, the dispatch, the `USAGE` line (`migrate` on the `pause | resume | close | render | records` line), the session-start hint, and the skill allow-lists.
- [ ] **Step 4: Run** `npm run typecheck && npm test`. Expected: PASS.
- [ ] **Step 5: Commit** with the message `feat(cli): cairn migrate moves a repo to .cairn and docs/cairn`.

### Task 6: Docs say the new paths

**Files:**
- Modify every file that names `.sdlc` or `docs/sdlc`. Find them with `grep -rln 'docs/sdlc\|\.sdlc' plugins/cairn README.md CLAUDE.md --exclude-dir=dist`. That covers about 20 procedure, agent, reference, and template files, `README.md`, and `CLAUDE.md`.
- Modify `plugins/cairn/references/cli.md`: document `cairn migrate` and the legacy-read rule in one short paragraph.
- Modify `plugins/cairn/procedures/learn.md:5`: drop the "later version adds learnings under `docs/sdlc/learnings/`" sentence. Plan 2 replaces it.
- Test: the doc tests that assert paths (`*-doc.test.ts`, `procedures.test.ts`, `templates.test.ts`)

- [ ] **Step 1: Replace** `docs/sdlc/` with `docs/cairn/` and `.sdlc/` with `.cairn/` across those files. Leave `scripts/rename.sh:3`'s comment accurate, with both names listed as neutral data paths. Text that describes the legacy fallback keeps naming the old paths.
- [ ] **Step 2: Run** `npm test`. Expected: any doc test that asserted an old path fails. Update those assertions deliberately to the new path.
- [ ] **Step 3: Run** `grep -rn 'docs/sdlc\|\.sdlc' plugins/cairn README.md CLAUDE.md --exclude-dir=dist`. Expected: only legacy-fallback mentions (in `paths.ts`, `config.ts`, `locate.ts`, `cli.md`, the guards and tests, and `rename.sh`).
- [ ] **Step 4: Commit** with the message `docs: cairn files live in .cairn/ and docs/cairn/`.

### Task 7: Migrate this repo, build, and release

**Files:**
- Modify: `plugins/cairn/.claude-plugin/plugin.json` (`0.4.0` to `0.5.0`), `plugins/cairn/dist/cairn.mjs` (rebuilt)
- Moves: `.sdlc/` to `.cairn/`, `docs/sdlc/` to `docs/cairn/`

- [ ] **Step 1: Run** `npm run build`, then `node plugins/cairn/dist/cairn.mjs migrate` from the repo root on branch `project-memory`.
  - This branch is not a plan branch, so `ctx.plan` is unset. No plan is in flight; all six are closed.
  - Expected: `Moved .sdlc/ to .cairn/ and docs/sdlc/ to docs/cairn/.` and a new commit.
- [ ] **Step 2: Run** `node plugins/cairn/dist/cairn.mjs status --all`. Expected: the same six plans, all closed.
- [ ] **Step 3: Bump** the version, then run `npm run build && npm run typecheck && npm test && claude plugin validate plugins/cairn`. Expected: all pass, and validate reports no errors.
- [ ] **Step 4: Commit** `plugin.json` and `dist/cairn.mjs` with the message `release: cairn 0.5.0 (.cairn folder)`.
- [ ] **Step 5: Leave** the three leftover worktrees under `.claude/worktrees/` alone. Removing them is the user's call, so report them in the final summary.
