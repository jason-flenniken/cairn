# Plan: cairn v0.2

> Source: prd.md. Each slice is a thin, complete path through every layer, demoable on its own, and fits one context window.

## Goal
Ship the cairn mod. It gives you:
- proof that each approval and override came from you, with model access blocked
- a live pane with pause and resume
- a phase-end drift check whose verdict the CLI computes
- the `/cairn:fix` fast lane
- the two dogfood fixes

## Architecture
**The CLI** stays the only writer of state. A first, behavior-neutral refactor splits `cli/src/commands.ts` into one module per command family, plus `shared.ts`. That split lets later CLI slices run in parallel. The same refactor adds every new optional state field and config field up front.

**The mod** is plain TSX that Claude Code loads directly. `hooks/register.tsx` only wires feature modules under `hooks/mod/`. Each module exports `install(on)` and owns one concern:
- guards
- heartbeat
- approve
- pause
- pane

Every CLI call goes through one wrapper, `hooks/mod/cli.ts`, which runs `$.plugin.root/bin/cairn` with argv arrays.

**Procedures** change only as text. Mod tests use `claude plugin test`. CLI tests use node:test.

## Global constraints
- Claude Code v2.1.287 or later. Add `"modules": ["./register.tsx"]` to the existing `hooks/hooks.json`, keeping its classic hooks.
- No new runtime dependencies.
- Mod code uses only `$` APIs: no Node imports, no `require`, no dynamic `import()`.
- The mod runs processes only with `$.process.run(argv, {cwd, env})`. Model text is never passed to a shell.
- Only the SHA-256 of the mod secret is on disk, at `<git common dir>/cairn/mod-secret.sha256` with mode 0600. The mod keeps the secret in memory. The CLI deletes the hash file after a match, and the mod writes a fresh secret and hash after each use.
- Overrides: after an exact "Override" answer, the mod holds a pending override for that plan for 10 minutes and runs the next matching plain `cairn … --override` command itself. There are no grant files.
- The heartbeat lives at `<git common dir>/cairn/mod-heartbeat`. It is written every 2 s and counts as active when under 10 s old.
- Exact approval labels are "Approve" and "Approve (Recommended)". The exact override label is "Override".
- Tag formats are `[cairn:approve <kind> <slug>]` with kind prd, plan, phase, or ship, and `[cairn:override <slug>]`.
- Config defaults:
  - `resumeFreshAfterMinutes`: 60
  - `fixMaxFiles`: 8
  - `reproTimeoutMinutes`: 10
- The fix-track record is at most 300 words, counted without headings or HTML comments.
- Slices never edit `docs/sdlc/` or `plugins/cairn/dist/`. After each CLI merge, the orchestrator runs `npm run build` and commits `dist/`.
- New state fields are optional and default when absent, so v0.1 plans keep working.

## Review focus
1. **Two plans waiting at once.** When two plans wait on main and a tagged answer names one of them, only that plan is approved. The mod uses the tag's slug, never "the current plan". Test this in menu-approval.
2. **Secret rotation race.** When a menu approval and a button approval land back to back, the second must read the rotated secret fresh, not a cached one. Test this in menu-approval.
3. **Pane poll during a write.** A poll that reads `state.json` mid-write keeps the last good view. Test this in pane.
4. **Mod hot reload.** After a reload, the secret is still read from its file. Stop now with no tracked turn falls back to Pause. Test this in pause-resume.
5. **Guard false positives.** Normal orchestrator commands must stay allowed:
   - `git merge --no-ff sdlc-slice/…`
   - `git -C <wt> diff sdlc/x...HEAD`
   - `npm test`
   - `cairn ready --json`

   Test this in mod-guards.

## Deferred requirements
None. Every FR is covered.

Re-plan, 2026-10-20 (two rounds): the secret is now hashed on disk, overrides are run by the mod, and dogfood findings were added as FR-35 to FR-40. FR-02a was renamed FR-34. The cli-split, human-proof, and approval-procedures slices are done and keep their progress.

## Phases
- **Phase 1** proves the core claim end to end: the model can't approve, and your menu answer approves through the mod.
- **Phase 2** adds what you see: the pane, pause, and resume, plus the CLI side of the drift verdict.
- **Phase 3** adds the drift-check procedure and the fast lane.
- **Phase 4** fixes what dogfooding found.

```yaml cairn-slices
phases:
  - id: proof
    name: Proof of the user
    slices:
      - id: cli-split
        name: Split CLI commands into modules
        covers: [FR-33]
        blocked_by: []
        scope: ["plugins/cairn/cli/src/**", "plugins/cairn/cli/test/**"]
        complexity: standard
      - id: mod-guards
        name: Mod skeleton, guards, heartbeat
        covers: [FR-03, FR-04]
        blocked_by: []
        scope: ["plugins/cairn/hooks/register.tsx", "plugins/cairn/hooks/hooks.json", "plugins/cairn/hooks/mod/guards.ts", "plugins/cairn/hooks/mod/heartbeat.ts", "plugins/cairn/hooks/mod/cli.ts", "plugins/cairn/hooks/mod/approve.ts", "plugins/cairn/hooks/mod/pause.ts", "plugins/cairn/hooks/mod/pane.tsx", "plugins/cairn/hooks/test/guards.test.ts", "plugins/cairn/hooks/NOTES.md", "plugins/cairn/types/**", "plugins/cairn/.claude-plugin/plugin.json", "package.json"]
        complexity: complex
      - id: human-proof
        name: CLI human proof, grants, modActive
        covers: [FR-01, FR-06]
        blocked_by: [cli-split]
        scope: ["plugins/cairn/cli/src/proof.ts", "plugins/cairn/cli/src/shared.ts", "plugins/cairn/cli/src/commands/stages.ts", "plugins/cairn/cli/src/commands/status.ts", "plugins/cairn/cli/test/proof.test.ts", "plugins/cairn/cli/test/lifecycle.test.ts"]
        complexity: complex
      - id: approval-procedures
        name: Tagged approval menus in procedures
        covers: [FR-07]
        blocked_by: [cli-split]
        scope: ["plugins/cairn/procedures/prd.md", "plugins/cairn/procedures/plan.md", "plugins/cairn/procedures/ship.md", "plugins/cairn/procedures/verify.md", "plugins/cairn/procedures/review.md", "plugins/cairn/procedures/phase-end.md", "plugins/cairn/references/cli.md", "plugins/cairn/references/reporting.md", "plugins/cairn/cli/test/procedures.test.ts"]
        complexity: simple
      - id: secret-hash
        name: Hashed single-use secret in the CLI
        covers: [FR-01]
        blocked_by: [human-proof]
        scope: ["plugins/cairn/cli/src/proof.ts", "plugins/cairn/cli/src/shared.ts", "plugins/cairn/cli/test/proof.test.ts", "plugins/cairn/cli/test/lifecycle.test.ts"]
        complexity: standard
      - id: menu-approval
        name: Approve from the menu answer
        covers: [FR-02, FR-34]
        blocked_by: [secret-hash, mod-guards]
        scope: ["plugins/cairn/hooks/mod/approve.ts", "plugins/cairn/hooks/test/approve.test.ts"]
        complexity: complex
  - id: visibility
    name: Pane, pause, resume, verdict
    slices:
      - id: pause-resume
        name: Instant pause, Stop now, fresh resume
        covers: [FR-13, FR-14, FR-15, FR-16]
        blocked_by: [menu-approval]
        scope: ["plugins/cairn/hooks/register.tsx", "plugins/cairn/hooks/mod/heartbeat.ts", "plugins/cairn/hooks/test/heartbeat.test.ts", "plugins/cairn/hooks/mod/pause.ts", "plugins/cairn/hooks/test/pause.test.ts", "plugins/cairn/cli/src/commands/pause.ts", "plugins/cairn/cli/test/pause.test.ts", "plugins/cairn/procedures/execute.md", "plugins/cairn/procedures/pause.md", "plugins/cairn/procedures/resume.md", "plugins/cairn/templates/config.json"]
        complexity: standard
      - id: direction-cli
        name: Computed drift verdict in the CLI
        covers: [FR-19, FR-20, FR-22]
        blocked_by: [human-proof]
        scope: ["plugins/cairn/cli/src/direction.ts", "plugins/cairn/cli/src/commands/evidence.ts", "plugins/cairn/cli/src/commands/stages.ts", "plugins/cairn/cli/src/commands/planload.ts", "plugins/cairn/cli/test/direction.test.ts"]
        complexity: standard
      - id: pane
        name: Live pane and status line
        covers: [FR-05, FR-08, FR-09, FR-10, FR-11, FR-12, FR-17]
        blocked_by: [pause-resume]
        scope: ["plugins/cairn/hooks/mod/pane.tsx", "plugins/cairn/hooks/test/pane.test.tsx", "plugins/cairn/hooks/mod/approve.ts", "plugins/cairn/hooks/test/approve.test.ts"]
        complexity: complex
  - id: drift-and-fix
    name: Drift check and fast lane
    slices:
      - id: direction-procedure
        name: Direction check procedure and command
        covers: [FR-18, FR-21, FR-30]
        blocked_by: [direction-cli]
        scope: ["plugins/cairn/procedures/phase-end.md", "plugins/cairn/procedures/direction.md", "plugins/cairn/skills/direction/**", "plugins/cairn/agents/direction-checker.md", "plugins/cairn/cli/test/templates.test.ts"]
        complexity: standard
      - id: fix-cli
        name: Fix track in the CLI
        covers: [FR-24, FR-25, FR-27, FR-28, FR-32]
        blocked_by: [direction-cli]
        scope: ["plugins/cairn/cli/src/commands/fix.ts", "plugins/cairn/cli/src/commands/stages.ts", "plugins/cairn/cli/src/commands/slices.ts", "plugins/cairn/cli/src/commands/plans.ts", "plugins/cairn/cli/src/render.ts", "plugins/cairn/cli/src/sections.ts", "plugins/cairn/cli/test/fix.test.ts"]
        complexity: complex
      - id: fix-procedure
        name: Fix procedure and command
        covers: [FR-23, FR-26]
        blocked_by: []
        scope: ["plugins/cairn/procedures/fix.md", "plugins/cairn/skills/fix/**", "plugins/cairn/templates/record-fix.md", "plugins/cairn/cli/test/fix-procedure.test.ts"]
        complexity: simple
  - id: dogfood
    name: Dogfood fixes
    slices:
      - id: file-input
        name: Decisions and notes from files
        covers: [FR-29]
        blocked_by: []
        scope: ["plugins/cairn/cli/src/main.ts", "plugins/cairn/cli/src/commands/plans.ts", "plugins/cairn/cli/test/fileinput.test.ts"]
        complexity: simple
      - id: skill-permissions
        name: Named pre-approved cairn commands
        covers: [FR-31]
        blocked_by: []
        scope: ["plugins/cairn/skills/**", "plugins/cairn/cli/test/skills.test.ts"]
        complexity: simple
      - id: dogfood-docs
        name: Unlocked orchestrator and documented formats
        covers: [FR-35, FR-38]
        blocked_by: []
        scope: ["plugins/cairn/procedures/new.md", "plugins/cairn/procedures/execute.md", "plugins/cairn/procedures/review.md", "plugins/cairn/references/cli.md", "README.md", "plugins/cairn/cli/test/dogfood-docs.test.ts"]
        complexity: simple
      - id: cli-polish
        name: Test summary, approval sources, strict ids, prefactor slices
        covers: [FR-36, FR-37, FR-39, FR-40, FR-41, FR-42]
        blocked_by: []
        scope: ["plugins/cairn/cli/src/shared.ts", "plugins/cairn/cli/src/render.ts", "plugins/cairn/cli/src/plan-parse.ts", "plugins/cairn/cli/src/types.ts", "plugins/cairn/cli/src/commands/slices.ts", "plugins/cairn/cli/test/polish.test.ts"]
        complexity: standard
```

### Slice: cli-split

Behavior-neutral refactor, plus clean child environments (FR-33).

**Interfaces**
- Consumes: none.
- Produces:
  - `cli/src/shared.ts` exports `gate`, `planCtx`, `mutate`, `planFile`, `runTests`, `runSetup`, `docProblems`, `recordProblems`, `ensureExcluded`, `template`, `testsGate`, and the types `PlanCtx`, `Opts`, `Result`, `TestRun`.
  - `cli/src/commands/` holds one module per command family:
    - `plans.ts`: `cmdNew`, `cmdProductInit`, `cmdDecide`
    - `stages.ts`: `cmdApprove`, `cmdAdvance`, `cmdClose`
    - `planload.ts`: `cmdPlanLoad`
    - `slices.ts`: `cmdReady`, `cmdSlice`
    - `evidence.ts`: `cmdEvidence`, `cmdDriftAck`
    - `pause.ts`: `cmdPause`, `cmdResume`
    - `status.ts`: `cmdStatus`, `cmdNext`, `cmdRender`, `listPlans`, `procedurePath`
    - `hooks.ts`: `hookSessionStart`, `hookPostEdit`
  - `cli/src/commands.ts` re-exports everything, so existing imports keep working.
  - `types.ts` gains every v0.2 optional field:
    - `Approval.source?: 'mod'|'terminal'|'agent'`
    - `Phase.verdict?: {result:'green'|'yellow'|'red', at, commit, note?}`
    - `State.repro?: {cmd, tail, at}`
    - `State.configHash?: string`
    - `Config.resumeFreshAfterMinutes?`, `Config.fixMaxFiles?`, `Config.reproTimeoutMinutes?`
  - `shared.childEnv()` returns `process.env` without `CAIRN_APPROVER`. `runTests` and `runSetup` use it.

**Test cases**
- Happy: all existing tests pass unchanged. `run(['status'])` output is byte-identical before and after.
- Unhappy: a v0.1 `state.json` with none of the new fields loads, and `cairn status` renders it.
- Security: with `CAIRN_APPROVER=x` in the parent environment, a `test` command `printf "%s" "$CAIRN_APPROVER"` writes nothing (FR-33).

**Done when**
- `commands.ts` is under 40 lines of re-exports.
- No module exceeds 250 lines.
- `npm run typecheck && npm test` is green.

### Slice: mod-guards

**Interfaces**
- Consumes: none (it calls the CLI only through `cli.ts`).
- Produces:
  - `hooks/register.tsx` exports `register(on)`. It calls `install(on)` from `mod/guards.ts`, `mod/heartbeat.ts`, `mod/approve.ts`, `mod/pause.ts`, and `mod/pane.tsx`. The last three are stubs here that later slices fill.
  - `mod/cli.ts` exports `cairn($, args: string[], opts?: {cwd?: string; env?: Record<string,string>}): Promise<{exitCode, stdout, stderr, json?: any}>`. It runs `$.plugin.root + '/bin/cairn'`.
  - `mod/heartbeat.ts` writes the heartbeat every 2 s from `session.start`. It also exports `commonDir($): Promise<string>`.
  - `mod/guards.ts` exports `bashVerdict(cmd: string): {deny?: string}` and `pathProtected(abs: string): boolean`, both pure for testing. It also wires `tool.call` guards, each with a fail-closed `.catch`.
- `hooks.json` gains `"modules": ["./register.tsx"]`. `plugin.json` gains `"types": "./types/index.d.ts"`.
- `package.json` `test` also runs `claude plugin test plugins/cairn` when mod test files exist.
- First step, the API check: in a headless `claude -p --plugin-dir` run, confirm whether `tool.call` fires for a subagent's Bash call, and whether `$.command.run` runs a plugin skill command. Record both results in `hooks/NOTES.md`.

**Test cases**
- Happy: every allow row in Review focus 5 and in PRD FR-03 (cat, jq, `cairn status`, grep) gets `bashVerdict(...)` with no deny.
- Unhappy: a guard that throws denies the matched call and allows an unmatched one (NFR-02).
- Security:
  - Every FR-03 deny row is denied:
    - `cairn approve prd`
    - `node …/dist/cairn.mjs approve plan`
    - `CAIRN_APPROVER=x cairn status`
    - `export CAIRN_APPROVER=x`
    - `cat …/mod-secret`
    - `python -c "…state.json…"`
    - `sed -i … state.json`
    - `git checkout -- …/state.json`
  - The FR-04 path guard denies a Write to `state.json`, a path with `..` that resolves to it, a symlink to it, and an MCP-style `{path}` input. A Read is allowed.

**Done when**
- `claude plugin validate plugins/cairn` passes.
- The guard tests pass.
- `hooks/NOTES.md` records both API check results.
- A live headless run shows the model's `cairn approve` denied.

### Slice: human-proof

**Interfaces**
- Consumes: `shared.gate`, `commands/stages.ts`, and `commands/status.ts` from cli-split.
- Produces:
  - `proof.ts` exports:
    - `humanProof(ctx, opts, io?: {isTTY(): boolean; readLine(prompt): string}): {source:'mod'|'terminal'} | undefined`
    - `rotateSecret(commonDir)`
    - `consumeGrant(commonDir, slug): {reason} | undefined`
    - `modActive(commonDir): boolean`
  - `gate()` accepts an override only with `humanProof` or a valid grant (FR-02a). The grant's reason is recorded.
  - `cairn approve` requires `humanProof` and records `{via:'human', source}`.
  - `--human` reads the typed slug through `io.readLine`, which defaults to `fs.readSync` on fd 0.
  - `status --json` and `next --json` include `modActive`.

**Test cases**
- Happy:
  - With `CAIRN_APPROVER` equal to the secret, the approval records `source: mod` and the secret file changes.
  - An injected TTY plus the correct slug records `source: terminal`.
  - A heartbeat 3 s old gives `modActive` true.
- Unhappy:
  - With no proof, `approve` exits 2 and names the menu, terminal, and pane paths.
  - A wrong slug records nothing.
  - `--human` without a TTY says "run this in your own terminal".
  - A heartbeat 11 s old gives `modActive` false.
- Security:
  - A stale secret is refused.
  - `--override` with no proof is refused.
  - A grant is consumed once and then refused.
  - A grant older than 10 minutes is refused.
  - The secret file has mode 0600.

**Done when** the tests pass and the existing lifecycle tests are updated to approve with the secret.

### Slice: approval-procedures

**Interfaces**
- Consumes: the tag formats from Global constraints.
- Produces: the procedures for PRD, plan, ship, verify and review re-plan, and phase end:
  - Their approval menus are tagged, with "Approve (Recommended)" first.
  - Override offers use `[cairn:override <slug>]` and "Override".
  - No procedure runs `cairn approve`. Each confirms with `cairn status --json`.
  - When `modActive` is false, a procedure shows `cairn approve <kind> --human`.
  - `references/cli.md` documents proof, grants, and `modActive`.

**Test cases**
- Happy: `procedures.test.ts` checks that each approval procedure contains its tag and the `--human` fallback.
- Unhappy: the test fails if any procedure contains the literal command `cairn approve ` outside the fallback text.
- Security: the test fails if any procedure tells the agent to pass `--override` without an Override menu.

**Done when** the test passes and the procedures read cleanly.

### Slice: secret-hash

**Interfaces**
- Consumes: `proof.ts` from human-proof.
- Produces:
  - `secretMatches` hashes `CAIRN_APPROVER` with SHA-256 and compares it, in constant time, to `<common>/cairn/mod-secret.sha256`. The file is read with O_NOFOLLOW and must be a regular file.
  - After a match, it deletes the hash file, so each secret works once.
  - It removes `rotateSecret` and all grant code (`consumeGrant`, grant caching in `shared.ts`).
  - `--override` now needs the mod secret or a terminal run.
  - The test helper writes a hash file for a known secret.

**Test cases**
- Happy: the correct secret approves and the hash file is gone afterwards.
- Unhappy:
  - A second use of the same secret refuses.
  - A missing hash file refuses.
  - A hash file that is a symlink or not a regular file refuses.
- Security:
  - Reading the hash file yields no usable secret: setting `CAIRN_APPROVER` to the hash's contents refuses.
  - No grant path remains: `grep -r grant cli/src` finds nothing.

**Done when** the tests pass and the earlier human-proof tests are updated to the hash model.

### Slice: menu-approval

**Interfaces**
- Consumes: `cli.ts` and `commonDir` from mod-guards, plus human-proof's secret file and grant format.
- Produces:
  - `mod/approve.ts` exports `parseTags(questions): {kind?, slug, question, override?}[]` and `isApproveLabel(s)`, both pure.
  - It wires a `tool.call` hook on AskUserQuestion. The hook awaits `next(e)`, reads `answers[question]`, and ignores auto-answered dialogs.
  - It resolves the plan's worktree with `cairn status --all --json`.
  - It keeps the secret in memory. It writes `mod-secret.sha256` at session start and after each use, then runs `approve` with the secret. It returns the outcome in `context`, with a toast.
  - For an exact "Override" answer to a `[cairn:override <slug>]` question, it records a pending override for 10 minutes.
  - A `tool.call` hook on Bash: when an override is pending for the plan, a plain `cairn … --override …` command with no shell metacharacters is parsed into argv. The mod runs it with the secret, consumes the pending override, and returns the CLI output as the tool result.
  - The AskUserQuestion hook has no deny catch.

**Test cases**
- Happy: "Approve (Recommended)" on a tagged question at the matching stop leads to:
  - the mocked process run receiving `['approve','prd']` with `CAIRN_APPROVER` equal to the secret
  - the outcome in `context`
  - a toast
- Unhappy:
  - "Approve the revised wording", "Revise", an auto-answered dialog, a dismissed dialog, and a tag for a stop that isn't waiting all leave no process run, and `context` says why.
  - A throwing hook still returns the user's result.
- Security:
  - With two plans waiting on main, the tag's slug picks the right one (Review focus 1).
  - Back-to-back approvals read the rotated secret (Review focus 2).
  - An "Override" answer makes the next plain `cairn advance --override "r"` run by the mod, with the secret in its environment, which the mocked process run asserts. No override is pending for "Override?" or "override".
  - `cairn advance --override "r"; rm -rf x` and `$(…)` forms aren't run by the mod.
  - An override pending more than 10 minutes isn't used.

**Done when**
- The tests pass.
- A live check in a `--plugin-dir` session approves a stop by menu answer, with the user present.

### Slice: pause-resume

**Interfaces**
- Consumes: `cli.ts` and the `register` wiring.
- Produces:
  - `mod/pause.ts` exports:
    - `handoffFromState(state, existing?: string): string`, which is pure
    - `pause($, mode: 'drain'|'now')`
    - `resume($, slug?)`
    - `pauseAge(state, now): number`
  - It tracks the main-loop `turnId` from `turn.start`.
  - It registers `/cairn:pause-now`. The pane buttons call these functions.
  - Prefactor: the engine allows one unmatched `session.start` hook per module. `register.tsx` gets a single `session.start` that calls each module's exported `onSessionStart($, e)` in turn, each isolated by try/catch. The heartbeat moves to that export.
  - The execute, pause, and resume procedures check pause between steps and add open questions to the handoff.
  - `templates/config.json` gains `resumeFreshAfterMinutes`.

**Test cases**
- Happy:
  - The handoff lists running slices with their substeps and keeps earlier open questions.
  - A 30-minute pause resumes in place.
  - A 3-hour pause shows "/clear, then /cairn:resume" and the age.
- Unhappy:
  - A missing `paused.at` is treated as long.
  - When `cairn pause` refuses, a toast shows the reason and the state is unchanged.
  - Stop now with no tracked turn pauses with mode `now` and calls no abort (Review focus 4).
- Security:
  - The Stop now message matches `/TaskStop/` and `/substep/`.
  - It contains no slice names or plan text.

**Done when** the tests pass and `cairn ready --json` returns no ready slices while paused (FR-15, covered by a node:test in `cli/test/pause.test.ts`).

### Slice: direction-cli

**Interfaces**
- Consumes: `stages.ts` and `planload.ts`.
- Produces:
  - `direction.ts` exports `parseScorecard(md): {rows, problems}` and `computeVerdict(rows): 'green'|'yellow'|'red'`.
  - `cairn evidence phase [--note]` records `phase.verdict` with the plan branch commit.
  - `approve phase` checks the verdict exists, isn't red unless overridden, and isn't stale against commits outside `docs/sdlc/`.
  - A re-plan clears all verdicts.

**Test cases**
- Happy:
  - One partial row with the rest aligned gives yellow, recorded with the commit.
  - Only aligned and supporting rows give green.
  - Approval succeeds on yellow.
- Unhappy:
  - No report, an unparseable YAML block, a missing covered requirement, or a row without `path:line` each refuses with a specific message.
  - `evidence phase` refuses when no phase is waiting.
- Security:
  - A red verdict refuses approval without proof.
  - A green verdict followed by a code commit refuses until the check is re-run.
  - A commit touching only `docs/sdlc/` doesn't refuse.

**Done when** the tests pass.

### Slice: pane

**Interfaces**
- Consumes: `pause.ts` (pause, resume), `approve.ts`'s approve path, and `cli.ts`.
- Approval reuse: `approve.ts` exports its serialized secret-use path (for example `approveAs($, slug, kind)`). The pane's Approve button and `/cairn:approve` call it, so there is only one secret store and no second race (Review focus 2).
- Produces:
  - `mod/pane.tsx` opens the pane on `session.start` when the root is a plan or slice worktree, and registers `/cairn:pane` and `/cairn:approve`.
  - It polls file modification times every 2 s and re-reads `cairn status --all --json` only when one changes.
  - It keeps the status line current.
  - It renders the FR-09 layout and the FR-12 buttons.

**Test cases**
- Happy:
  - Each fixture renders the expected text and buttons: discover, execute with fix round 2, six drift entries (only five shown), a pending phase stop, a paused plan, and two other plans.
  - The status line shows the summary, or "2 active plans" on main.
- Unhappy:
  - A partial `state.json` keeps the last view (Review focus 3).
  - Placement `isPlaced:false` shows a toast with the reason.
  - Ten idle polls start no process (NFR-01).
  - A throwing render leaves tool calls unaffected (NFR-07).
- Security:
  - Approve appears only when a stop is waiting.
  - `/cairn:approve` with nothing waiting refuses.
  - The Approve button confirms through `$.ui.ask` with mod-fixed wording.

**Done when**
- The tests pass.
- A live check at 160 columns shows the pane updating within 2 s of `cairn slice step`.

### Slice: direction-procedure

**Interfaces**
- Consumes: the scorecard format from direction-cli.
- Produces:
  - A `procedures/direction.md` check that fans out a `direction-checker` agent (sonnet) per two or three requirements. It covers the product PRD when present and writes `direction/<phase-id>.md` with the `yaml cairn-direction` block.
  - `phase-end.md` runs the check, then `cairn evidence phase`, then the tagged menu, including "Approve and start clean".
  - `/cairn:direction` is report-only.

**Test cases**
- Happy: `templates.test.ts` includes `direction.md`. The procedure contains the block format and the "Approve and start clean" option.
- Unhappy: the procedure handles a refused `evidence phase` by fixing the report, not by overriding.
- Security: the procedure never records a verdict color. Only the CLI computes it.

**Done when** the tests pass. The live run happens at this plan's own phase ends.

### Slice: fix-cli

**Interfaces**
- Consumes: `stages.ts`, `slices.ts`, `plans.ts`, and `render.ts`.
- Produces:
  - `new --track fix` starts at stage repro.
  - The fix-track stages are repro, execute, review, ship, closed.
  - `cairn repro "<cmd>"` takes a timeout from config.
  - `cairn advance` from repro creates the slice `fix` with scope `**`.
  - `slice done fix` adds the repro, suite, and file-count checks.
  - `cairn escalate` is added.
  - The fix-track record is checked: five sections and at most 300 words.
  - The config hash is taken at plan approval (or at repro on the fix track) and checked by slice start, slice done, repro, and close.

**Test cases**
- Happy:
  - The full fix track runs repro → execute → review → ship → closed in a temporary repo.
  - `escalate` keeps the slice and narrows its scope.
- Unhappy:
  - A repro that exits 0 refuses.
  - A repro past a 1-second test timeout refuses.
  - Nine changed files refuse and name `escalate`.
  - A 350-word record refuses.
  - `escalate` on a feature plan refuses.
- Security:
  - Editing the `test` command after approval makes `slice done` refuse until re-approval.
  - The repro child environment has no `CAIRN_APPROVER`.

**Done when** the tests pass.

### Slice: fix-procedure

**Interfaces**
- Consumes: the CLI contract written in this plan for fix-cli.
- Produces:
  - `procedures/fix.md`:
    1. Create the plan.
    2. Write the repro (the user sees the command in the permission prompt).
    3. Implement with TDD in the fix slice worktree.
    4. Run a security-focused branch review and record the evidence.
    5. Draft the short record from `templates/record-fix.md`.
    6. Stop with the tagged ship menu.

    The procedure offers `cairn escalate` when new requirements appear.
  - `skills/fix/SKILL.md` adds `/cairn:fix`.

**Test cases**
- Happy: the template has Links, Bug, Cause, Fix, and Evidence. The skill is user-invoked only.
- Unhappy: the procedure covers a repro that passes (ask the user for a better repro) and a fix past the file limit (escalate).
- Security: the procedure never pre-approves the repro command and never runs `cairn approve`.

**Done when** `cli/test/fix-procedure.test.ts` passes. It checks the template sections, the skill frontmatter, and that `fix.md` contains no `cairn approve` command and no pre-approved repro.

### Slice: file-input

**Interfaces**
- Consumes: `main.ts` `parseArgs` and `plans.ts` `cmdDecide`.
- Produces:
  - `--note-file <path>` is read into `--note` for every command.
  - `cairn decide --file <path>` reads `{question, answer, why?}`.

**Test cases**
- Happy: an answer with an apostrophe is recorded verbatim. `--note-file` works on `approve` and `evidence`.
- Unhappy: a missing file or invalid JSON exits 1 and names the file.
- Security: `--file` reads only the given path. A relative path resolves from the current directory, with no shell expansion.

**Done when** the tests pass and the decide/note sections of `references/cli.md` list the flags.

### Slice: skill-permissions

**Interfaces**
- Consumes: the final list of skills, including direction and fix.
- Produces: every `SKILL.md` lists `allowed-tools` with each `cairn` subcommand by name, for example `Bash(cairn status:*)`, except `repro`.

**Test cases**
- Happy: `skills.test.ts` checks that every skill lists the named subcommands.
- Unhappy: the test fails when any skill lists `cairn:*`.
- Security: the test fails when any skill pre-approves `cairn repro`.

**Done when** the test passes.

### Slice: dogfood-docs

**Interfaces**
- Consumes: decision 13 and the formats in Global constraints.
- Produces:
  - `new.md` runs `cairn new` and then tells the user the worktree path. It never calls EnterWorktree, and the orchestrator stays at the repo root.
  - `execute.md` runs every `cairn` command with `cd <plan worktree> &&`.
  - `cli.md` is rewritten for the hash design: `mod-secret.sha256` (the mod keeps the secret in memory, and the CLI claims and deletes the hash on a match), the heartbeat (epoch milliseconds as plain text), and mod-run overrides. Every grant and rotation text goes, and `modActive` is documented in `status --all`.
  - `review.md`: the override command runs on its own (no `cd`, no `&&`) with a plain-text reason, free of ``; | & $ ` > <`` and backslashes.
  - The README states the Claude Code version requirement.

**Test cases**
- Happy: `dogfood-docs.test.ts` checks that `new.md` has no EnterWorktree and that `execute.md` uses `cd`.
- Unhappy: the test fails when `cli.md` lacks `mod-secret.sha256`.
- Security: `cli.md` never documents a grant file.

**Done when** the test passes.

### Slice: cli-polish

**Interfaces**
- Consumes: `shared.runTests`, `render.ts`, and `plan-parse.ts`.
- Produces:
  - Test summary extraction: the last line that matches pass/fail counts, falling back to the last line.
  - STATUS.md approval and override sources.
  - Strict FR ids in plan load.
  - `kind: prefactor` slices.
  - The `slice done` git-diff scope check, which logs drift (FR-41).
  - The re-plan keeps `base` and every other progress field (FR-42).

**Test cases**
- Happy:
  - An output ending with an `npm notice` line after `ℹ pass 12` records `ℹ pass 12`.
  - STATUS.md shows the sources.
  - A slice that changed `README.md` outside its scope gets a drift entry at `slice done`.
  - A slice started before a re-plan is marked done after it, with no override.
- Unhappy: `**FR-02a**` in the PRD refuses and names the id. Empty `covers` without `kind: prefactor` refuses.
- Security: no other plan-load check is loosened. A prefactor slice still needs `scope`.

**Done when** the tests pass.
