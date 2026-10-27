# PRD: cairn v0.2

> Plan: cairn-v0-2. Every requirement has a stable id. Acceptance criteria and unhappy paths cite those ids. Decisions 1-12 in `decisions.md` are the source; where two disagree, the later one wins (decision 10 supersedes decision 4 on yellow verdicts).

## Problem
In cairn v0.1 the model relays approvals and overrides itself, so nothing proves that a stop was approved by the user. A model can also edit plan state directly. Plan state is visible only when someone asks for it. Pausing needs an agent turn, and resuming after a long break re-reads the whole conversation. The end-of-phase check is a light pass: it has no contradicted verdict, no unplanned-work classes, no product-PRD check, and cannot block a phase. Bugs have no lightweight path.

The skills pre-approve every `cairn` command (`Bash(cairn:*)`). That will include a command that runs model-written shell once `cairn repro` exists. Dogfooding found two more gaps: the worktree guard refuses quoted text with apostrophes, and phases offer no clean-context restart.

## Solution
A Claude Code mod ships inside the cairn plugin. With it:
- **Pane.** A live side pane shows where each plan is, with Approve, Pause, Stop now, Resume, and Status buttons.
- **Proof of the user.** Approvals and overrides need proof that they came from the user: an exact menu answer the mod reads, a pane button, or a terminal run. The model can't approve, override, or edit plan state.
- **Pause and resume.** Pause is instant. Resuming after a long break starts from a small, clean context.
- **Phase end.** Each phase end runs a full drift check whose verdict the CLI computes. A red verdict blocks approval.
- **Bugs.** `/cairn:fix` gives bugs a repro-first track.
- **Dogfood fixes.** Decisions and notes can be passed as files, and each phase end offers a clean restart.

## User stories
1. As the developer, I want the pane to open by itself when I work in a plan worktree, so that I always see the stage, the phase and slice progress, and what waits on me.
2. As the developer, I want to approve a stop by picking "Approve" in the usual menu, so that approvals stay fast and are provably mine.
3. As the developer, I want the model blocked from approving, overriding, or rewriting plan state, so that the process can't drift past a checkpoint without me.
4. As the developer, I want to approve or override from my terminal when the mod isn't running, so that headless and older sessions still work.
5. As the developer, I want an instant Pause button that writes the handoff for me, so that I can stop mid-turn without waiting.
6. As the developer, I want Stop now to cancel the running turn at once and have background subagents stopped, so that billing stops as soon as possible.
7. As the developer, I want resume after a long break to start from a clean context, so that I don't pay to re-read a stale conversation.
8. As the developer, I want to resume any other active plan from the pane, so that switching plans doesn't need me to remember slugs and paths.
9. As the developer, I want each phase end to show a scorecard and verdict of plan versus code, so that drift is caught with evidence before I approve.
10. As the developer, I want a red verdict to block phase approval unless I override, so that serious drift can't slip through.
11. As the developer, I want to run the drift check anytime, so that I can check direction mid-phase.
12. As the developer, I want `/cairn:fix` to require a failing repro before any fix, so that bug fixes are proven.
13. As the developer, I want a fix that grows too big or uncovers new requirements to escalate into a full plan without losing work, so that scope creep is handled.
14. As the developer, I want to see every repro command before it runs, so that model-written shell never runs unseen.
15. As the developer, I want long text passed to cairn without quoting problems, so that decisions with apostrophes are never refused.
16. As the developer, I want each phase end to offer a clean restart, so that context stays small across a long plan.
17. As an agent running a procedure, I want to know whether the mod is active, so that I tell the user the right way to approve.

## Functional requirements

**Proof of the user**

- **FR-01 Human proof for approvals and overrides.** A `cairn approve <kind>` command, and any command run with `--override`, succeed only with human proof, and refuse otherwise. There are two kinds of human proof:
  - **The mod's secret.** The SHA-256 of `CAIRN_APPROVER` matches `<git common dir>/cairn/mod-secret.sha256`. The mod generates the random secret and keeps it only in memory. It writes just the hash, with mode 0600, and replaces both after each use. The CLI deletes the hash file after a successful match, so a secret works once. These are recorded as `source: mod`.
  - **A terminal run.** `--human` is given, stdin and stdout are TTYs, and the user types the plan slug at a prompt read synchronously from fd 0. These are recorded as `source: terminal`.

  A recorded override keeps its reason and its source.
- **FR-02 Approving through the menu.** The mod's `tool.call` hook on AskUserQuestion awaits the tool's result, then checks the answer before the model sees it. It records an approval only when all of these hold:
  - A question's text contains the tag `[cairn:approve <kind> <slug>]`, where kind is prd, plan, phase, or ship.
  - The answer to that same question, `answers[<question text>]`, is exactly "Approve" or "Approve (Recommended)".
  - The plan and stop are resolved as in FR-05, and that stop is the one waiting in state.
  - The dialog was not auto-answered because the user was away.

  When all hold, the mod runs the plan's `bin/cairn approve <kind>` in that plan's worktree, with `CAIRN_APPROVER` set to the secret. It returns the outcome, success or the refusal text, in the hook's `context`, and shows it as a toast. A re-plan approval uses kind `plan`.
- **FR-34 Mod-run overrides.** (Earlier drafts called this FR-02a.) For a question tagged `[cairn:override <slug>]` whose own answer is exactly "Override", the mod records a pending override for that plan. It expires after 10 minutes. When the model next runs a Bash `cairn … --override "<reason>"` for that plan while an override is pending, the mod's `tool.call` hook handles it:
  1. It checks that the command is a plain `cairn` invocation with no shell metacharacters (`; | & $ \` > <` and newlines). Otherwise it doesn't run it, and says why.
  2. It runs the same argv itself through `$.process.run`, with the secret set.
  3. It consumes the pending override, and returns the CLI output as the tool result.

  No file stands for an override. With nothing pending, the command runs normally, and the CLI refuses it for lack of proof.
- **FR-03 Bash guard.** The mod denies Bash tool calls whose command mentions any of these:
  - `state.json` under `docs/sdlc/plans/`
  - `CAIRN_APPROVER`
  - `mod-secret`
  - an `approve` token after `cairn`, `cairn.mjs`, `bin/cairn`, or `dist/`

  The exception is a read-only command from this list: `cat`, `head`, `tail`, `grep`, `wc`, `less`, and `jq` with no `-i` and no redirect. The deny reason says that approvals and plan state come from the user and the CLI. Main-loop calls are always covered. Subagent calls are covered when `tool.call` fires for them, which the early API check settles.
- **FR-04 Path guard for other tools.** The mod denies any non-Bash tool call (Edit, Write, MultiEdit, NotebookEdit, and any MCP tool) when the input's `file_path`, `path`, or `notebook_path` resolves to a protected path. The path is resolved to an absolute path, with `..` and symlinks resolved by `$.fs.stat` with `resolve`. The protected paths are:
  - a plan's `state.json` or `STATUS.md`
  - the `<git common dir>/cairn/` folder

  Reads are allowed.
- **FR-05 Pane Approve and `/cairn-approve`.** When a stop is waiting, the pane shows an Approve button on that plan's line. `/cairn-approve [kind]` does the same job. Either one confirms with a dialog (`$.ui.ask`) whose wording the mod fixes, then approves as in FR-02. With no kind given, the command approves the stop waiting on the session's current plan.

  The mod resolves the current plan, the plan worktree, and the waiting stop by running `bin/cairn status --json` from the session's project root. That command also resolves slice worktrees. The mod finds `bin/cairn` under `$.plugin.root`.
- **FR-06 Mod heartbeat.** On each 2-second poll, the mod writes a timestamp to `<git common dir>/cairn/mod-heartbeat`. `cairn status --json` and `cairn next --json` report `modActive: true` when that timestamp is under 10 seconds old.
- **FR-07 Procedures.** The procedures for PRD, plan, phase end, ship, and re-plan approvals change as follows:
  - Approval menus carry `[cairn:approve <kind> <slug>]`, with "Approve (Recommended)" as the first option.
  - Override offers carry `[cairn:override <slug>]`, with an option labeled exactly "Override".
  - The procedures never run `cairn approve` themselves, and confirm the result with `cairn status`.
  - When `modActive` is false, they give the user the exact terminal command instead (FR-01).

**Pane and status line**

- **FR-08 Opening the pane.** The pane opens at session start when the session's project root is a plan worktree or a slice worktree. Unasked, Claude Code places it from 144 columns; below that it waits. `/cairn-pane` asks for it, which places it from 110 columns. When `$.ui.open` returns `isPlaced: false`, the mod shows its reason as a toast.
- **FR-09 Pane content.**
  - A header: title, stage, and phase n of m.
  - The phase and slice tree, with status icons. A running slice shows its substep and fix round. A waiting slice shows what it waits on.
  - Unreviewed drift: the count and the first five paths.
  - A "Waiting on you" line that names the pending stop, or says "nothing".
  - The last phase's drift verdict.
  - Other active plans, one line each: title, stage, next step, and a Resume button.
- **FR-10 Refresh.** The pane reflects a change to `state.json` within 2 seconds. The mod polls the modification times of the state files every 2 seconds and re-reads state only when one changes.
- **FR-11 Status line.**
  - In a plan worktree or slice worktree, it shows the plan's one-line summary.
  - Elsewhere in a repo with active plans, it shows "N active plans".
  - With no active plans, it is cleared.
- **FR-12 Pane buttons.**
  - Approve: shown only when a stop is waiting.
  - Pause: shown when the plan is not paused or closed.
  - Stop now: shown when a slice is running or a turn is running.
  - Resume: shown when the plan is paused.
  - Status: always shown. It runs `/cairn:status`.

**Pause and resume**

Mod commands are registered as `cairn-pane`, `cairn-approve`, `cairn-pause-now`, `cairn-pause-mod`, and `cairn-resume-mod`, because the engine forbids ":" in names a mod registers. The plugin's skills keep their `/cairn:` names.


- **FR-13 Pause.** Pause works at any time, including mid-turn:
  1. The mod writes `handoff.md` from state:
     - **In flight:** each running slice with its substep and worktree.
     - **Open questions:** kept from the existing `handoff.md` when there is one, otherwise a placeholder for the agent to fill.
     - **Next action:** the plan's next step.
  2. The mod runs `cairn pause`, which defaults to drain mode: running work finishes its current step, and nothing new starts.
  3. The mod shows a one-line tip that `/clear` is safe now.
- **FR-14 Stop now.** Stop now works like Pause, with three differences:
  - It runs `cairn pause --now`.
  - It cancels the main loop's running turn with `$.turn.abort`, using the turn id the mod tracks from `turn.start`.
  - It then submits a fixed message, containing no plan or slice text, telling the agent to stop every background subagent with TaskStop and record their substeps.

  The mods API has no call that stops subagents directly. When no turn is running, or the abort is rejected, Stop now behaves as Pause with mode `now`.
- **FR-15 Respecting the pause.** While a plan is paused:
  - `cairn ready` returns no ready slices, and `cairn next` routes to resume.
  - The procedures check this between steps. They start nothing new, let running work finish only its current step, and add open questions to `handoff.md`.
- **FR-16 Resume and pause length.** A paused plan records the time it was paused (`paused.at`).
  - If the pause is shorter than `resumeFreshAfterMinutes` (config, default 60), Resume runs `cairn resume` and continues with `/cairn:next`.
  - If the pause is that long or longer, or `paused.at` is missing or malformed, Resume shows the pause age and the steps "/clear, then /cairn:resume". It offers "Resume here anyway" as a second choice.
- **FR-17 Resume another plan.** Resume on another plan's line runs `cairn resume <slug>`, which creates that plan's worktree when it is missing. It then shows the worktree path and the command that opens a session there.

**Drift check**

- **FR-18 The direction check.** The phase-end procedure runs a direction check over the requirements the phase covers, plus the product PRD's non-goals, NFRs, and must-not-trade-off items when `docs/sdlc/product/PRD.md` exists. It writes `docs/sdlc/plans/<slug>/direction/<phase-id>.md`: a readable report followed by one fenced `yaml cairn-direction` block with these rows:
  - `requirements`: `{id, verdict: aligned|partial|missing|contradicted, evidence: "path:line", note?}`
  - `unplanned`: `{what, class: pulled-forward|unplanned|non-goal-breach|supporting, evidence}`
  - `nfr`: `{id, verdict, evidence}`. These rows include the product-PRD items.
- **FR-19 Recording the verdict.** `cairn evidence phase [--note …]` parses the scorecard and computes the verdict by FR-22. It refuses in four cases:
  - The phase isn't waiting for approval.
  - The report or its block is missing.
  - A requirement the phase covers has no row.
  - A row lacks `path:line` evidence.

  The verdict is recorded with the plan branch's commit. A re-plan clears every recorded phase verdict.
- **FR-20 Approving the phase.** `cairn approve phase` refuses in three cases:
  - The current phase has no recorded verdict.
  - The verdict is red, unless overridden under FR-01.
  - Code outside `docs/sdlc/` changed since the verdict's commit.

  Yellow and green need no confirmation beyond the normal approval.
- **FR-21 `/cairn:direction`.** `/cairn:direction [all|changed|<requirement ids>]` runs the same check at any time. It reports only and records nothing.
- **FR-22 Verdict rules.**
  - **Red:** any contradicted or missing row, any non-goal-breach row, or a violated security or privacy NFR.
  - **Yellow:** any partial row, or any unplanned row.
  - **Green:** otherwise. Supporting rows don't count.

**Fast lane**

- **FR-23 Fix track.** `/cairn:fix "<bug>"` runs `cairn new <slug> --track fix --title …`, which starts at stage `repro`. The fix track's stages are repro, execute, review, ship, closed.
- **FR-24 Recording a repro.** `cairn repro "<command>"` runs the command in the plan worktree, with a 10-minute timeout (config `reproTimeoutMinutes`).
  - A non-zero exit records the command and its last output line.
  - A zero exit refuses with "this does not reproduce the bug".
  - A timeout or a failure to start refuses without recording.

  `cairn advance` from repro requires a recorded repro. It then creates one slice named "fix", with scope `**`, and moves the plan to execute.
- **FR-25 Finishing the fix slice.** On the fix track, `cairn slice done fix` adds three checks to the normal ones:
  - The repro command now exits 0, within the same timeout.
  - The full test suite is green.
  - The slice changed at most `fixMaxFiles` files (default 8). Changes are counted from the slice's base commit to its branch, with each added, modified, deleted, or renamed file counting once.

  When there are too many files, it refuses and names `cairn escalate`. The fix procedure also offers `cairn escalate` when the implementer or reviewer reports a requirement the bug report didn't state.
- **FR-26 Fix-track review.** The review stage runs the branch reviewer with a security focus on the diff. It records the result with the existing `cairn evidence review`. `cairn advance` to ship requires a pass with zero blocking findings.
- **FR-27 Fix-track record.** The ship stop requires a `RECORD.md` with five sections (Links, Bug, Cause, Fix, Evidence) and at most 300 words. Word counts exclude headings and HTML comments. `cairn advance` from ship closes the plan; there is no learn stage.
- **FR-28 Escalating a fix.** `cairn escalate` turns a fix plan into a feature plan at the prd stage:
  - It records the bug and the repro as a decision.
  - It keeps the fix slice and its progress.
  - It narrows the slice's scope from `**` to the files the slice has changed.

  The later plan must keep that slice id.

**Command safety and dogfood fixes**

- **FR-29 File input.** Long text can come from a file. `cairn decide --file <path>` reads JSON `{question, answer, why?}`. Every command that takes `--note` also takes `--note-file <path>`. Stdin isn't supported, because the worktree guard parses heredoc text the same way it parses arguments.
- **FR-30 Clean start at phase end.** The phase-end menu offers "Approve and start clean". It approves the phase (FR-02), then tells the user: "/clear, then /cairn:next".
- **FR-31 Pre-approved commands.** The skills' `allowed-tools` list each `cairn` subcommand by name, except `repro`. This replaces v0.1's `Bash(cairn:*)`. A repro command therefore goes through the user's normal permission prompt.
- **FR-32 Locked command config.** Plan approval records a hash of the `setup`, `test`, and `build` commands in `.sdlc/config.json`. On the fix track, the hash is taken when the repro is recorded. `slice start`, `slice done`, `repro`, and `close` refuse while the hash differs, and name the re-approval or override that fixes it.
- **FR-35 No worktree lock for the orchestrator.** The new-plan procedure never moves the session into the plan worktree with EnterWorktree. The orchestrator session runs from the repo root and runs `cairn` from the plan worktree with `cd`. A locked session blocks its subagents from editing and committing in slice worktrees.
- **FR-36 Test summary.** `slice done` and `close` record the test run's summary line, meaning the last line that reports pass or fail counts, instead of the raw last output line.
- **FR-37 Approval sources in STATUS.md.** STATUS.md shows each approval's source (mod, terminal) and each override's source.
- **FR-38 Documented formats.** `references/cli.md` documents the secret hash, heartbeat, and pending-override formats. The README states the Claude Code version requirement (NFR-04).
- **FR-39 Strict requirement ids.** `cairn plan load` refuses when a bold requirement id in the PRD's Functional requirements doesn't have the form `FR-<digits>`, so coverage can never silently skip one.
- **FR-40 Prefactor slices.** A slice may declare `kind: prefactor`, which allows an empty `covers` list.
- **FR-41 Drift from the git diff.** `slice done` compares the files the slice changed (from its starting commit to its branch) against the slice's scope, and logs each file outside scope as drift. This catches edits made through Bash, which the edit hook never sees.
- **FR-42 Re-plans keep slice progress.** A re-plan keeps every progress field of a surviving slice, including its starting commit.
- **FR-33 Clean environment for child commands.** Every child command the CLI runs (setup, test, repro) runs with `CAIRN_APPROVER` removed from its environment.

## Non-functional requirements
- **NFR-01 Idle cost.** While nothing changes, each 2-second poll does file stats plus one heartbeat write, and starts no process. The CLI runs at most once per detected change.
- **NFR-02 Guards fail closed.** Every FR-03 and FR-04 guard is registered with a `.catch` that denies the call it matched. The FR-02 approval hook has no deny catch: it must never block the user's menu.
- **NFR-03 Surfaces.** The mod works on the terminal, desktop, and VS Code surfaces. Automated tests cover the terminal surface; the others are checked live. Where nothing draws, the status line, the commands, and the terminal path (FR-07) still work.
- **NFR-04 Version.** cairn requires Claude Code v2.1.287 or later, and the README says so. The mod is added as a new `modules` entry in `hooks/hooks.json`.
- **NFR-05 Tests and checks.**
  - Every CLI change is covered by node:test.
  - Mod behavior is covered by `claude plugin test`.
  - `claude plugin validate` passes.
  - `npm run typecheck && npm test` is green.
- **NFR-06 Dependencies.** No new runtime dependencies. The mod is plain TSX that Claude Code loads directly.
- **NFR-07 Mod failures.** A mod failure never blocks the session. Only the FR-03 and FR-04 guards deny anything.
- **NFR-08 State compatibility.** New state fields are optional and default when absent, so v0.1 plans keep working with no migration. The new fields are:
  - phase verdicts
  - the repro record
  - the approval source
  - the config hash

## Non-goals
- **v0.3 agents.** The breaker, first-timer, and acceptance-runner agents and the fixed review roster belong to v0.3.
- **v0.4 features.** The Linear mirror, structured learnings, and roadmap generation belong to v0.4.
- **Pane on mobile or in `claude -p`.** The status line and `/cairn:status` cover those.
- **Tamper-proofing against a deliberate attacker.** The goal is to stop accidental or drifting approvals by the model. Accepted residual risks:
  - shell built from variables that evades the patterns
  - a model-launched pseudo-terminal (`script`, `expect`) faking a TTY
  - an option labeled exactly "Approve" at the right stop
- **Moving the session from the pane.** The mod can't change the session's directory, so it shows the command instead.
- **Stdin input.** See FR-29.

## Acceptance criteria
- [FR-01]
  - With no secret and no TTY, `cairn approve prd` exits 2 and names the menu, the terminal command, and the pane.
  - With `CAIRN_APPROVER` equal to the secret, it records `source: mod` and rotates the secret.
  - A stale or wrong secret refuses.
  - With an interactive terminal, `--human`, and the correct slug typed, it records `source: terminal`. A wrong slug records nothing.
  - `--override` with no proof refuses.
- [FR-02] Given AskUserQuestion with the tagged question answered "Approve (Recommended)" at the matching stop, then:
  - state shows the approval with `source: mod`
  - the hook's `context` contains the outcome
  - the mocked process run received `approve <kind>` with `CAIRN_APPROVER` set to the secret
- [FR-02] Given the answer "Approve the revised wording", "Revise", an auto-answered dialog, or a tag for a stop that isn't waiting, then nothing is recorded.
- [FR-34]
  - Given an answer of exactly "Override" to a `[cairn:override <slug>]` question, the model's next `cairn advance --override "r"` for that plan is run by the mod with the secret. The CLI records the override with `source: mod`.
  - A second `--override` refuses.
  - An override answered more than 10 minutes earlier refuses.
  - A command containing `;` or `$(` isn't run by the mod.
  - No file under `<git common dir>/cairn/` stands for an override.
- [FR-03] Each of these is denied, with the deny reason:
  - `cairn approve prd`
  - `node …/dist/cairn.mjs approve plan`
  - `CAIRN_APPROVER=x cairn status`
  - `export CAIRN_APPROVER=x`
  - `cat .git/cairn/mod-secret.sha256`
  - `python -c "…state.json…"`
  - `sed -i … state.json`
  - `git checkout -- …/state.json`
- [FR-03] Each of these is allowed:
  - `cat …/state.json`
  - `jq .stage …/state.json`
  - `cairn status`
  - `grep approve README.md`
- [FR-03] Inside a subagent, the same denials hold if the early API check shows `tool.call` fires there. That result is recorded in the plan.
- [FR-04]
  - Write to `docs/sdlc/plans/x/state.json` is denied, as is Write to a relative path with `..` that resolves to it.
  - Write through a symlink to it is denied.
  - Read is allowed.
- [FR-05] With a stop waiting, pressing Approve and confirming records the approval. With no stop waiting, the button is absent and `/cairn-approve` refuses with "nothing is waiting".
- [FR-06] With the mod running, `modActive` is true. Ten seconds after the heartbeat stops, it is false.
- [FR-07] A node:test checks the procedures:
  - Each approval procedure contains the tag and the `--human` fallback text.
  - No procedure contains the command `cairn approve`.
- [FR-08]
  - With a 160-column terminal mock in a plan worktree, the pane is placed.
  - At 100 columns it isn't, and `/cairn-pane` shows the placement reason.
  - At 120 columns, `/cairn-pane` places it.
- [FR-09] Fixture states render the expected text:
  - discover
  - execute with one running slice in fix round 2 and one waiting slice
  - six drift entries, showing only the first five paths
  - a pending phase stop
  - a paused plan
  - two other plans
- [FR-10] After state changes, the pane shows the change within one poll. Across ten idle polls, no process runs.
- [FR-11] In a plan worktree the status line shows the summary. On main with two plans it shows "2 active plans". With none, it is cleared.
- [FR-12] For each fixture, exactly the listed buttons appear.
- [FR-13] Mid-turn Pause:
  - `handoff.md` lists each running slice with its substep.
  - Earlier open questions are preserved.
  - State shows paused in drain mode.
  - The tip appears.
- [FR-14]
  - With a running turn, Stop now calls `$.turn.abort` with the tracked id, records pause mode `now`, and submits a message matching `/TaskStop/` and `/substep/` with no slice text.
  - With no turn running, it pauses with mode `now` and aborts nothing.
- [FR-15] While paused, `cairn ready --json` returns no ready slices, and `cairn next --json` names the resume procedure (node:test).
- [FR-16] Resume behavior:
  - Paused 30 minutes: Resume continues in place.
  - Paused 3 hours: it shows "/clear, then /cairn:resume" and the age.
  - A missing `paused.at` is treated as long.
- [FR-17] Pressing Resume on a plan with no worktree creates the worktree and shows its path and open command.
- [FR-18] Given a phase waiting for approval, the procedure writes the report with a scorecard row for each covered requirement and for each product-PRD item. This is checked live.
- [FR-19]
  - With no report, `cairn evidence phase` refuses.
  - With a covered requirement missing from the scorecard, it refuses and names it.
  - With a row lacking evidence, it refuses.
  - With one partial row and the rest aligned, it records yellow and the commit.
  - After a re-plan, no verdict remains.
- [FR-20]
  - With a red verdict, `approve phase` with mod proof refuses. After an "Override" answer, the mod-run `approve phase --override` succeeds.
  - With yellow, it succeeds.
  - With green and a later code commit, it refuses until the check runs again.
  - A commit that touches only `docs/sdlc/` doesn't refuse.
- [FR-21] Running `/cairn:direction` in any stage leaves `state.json` byte-identical.
- [FR-22] Verdict rules:
  - One contradicted row gives red.
  - One unplanned row gives yellow.
  - Only aligned and supporting rows give green.
- [FR-23] `/cairn:fix "x"` leaves a plan with `track: fix` at stage repro on its own branch and worktree.
- [FR-24]
  - A repro that exits 0 refuses.
  - One that exits 1 is recorded, and `advance` creates the fix slice and moves to execute.
  - A repro that outlives a 1-second test timeout refuses.
- [FR-25] `slice done`:
  - refuses when the repro still fails
  - refuses with 9 changed files and names `cairn escalate`
  - succeeds with 3 files and green tests
- [FR-26] In review, `advance` refuses until `evidence review pass --blocking 0` is recorded.
- [FR-27] At the ship stop, a 350-word record is refused and a 250-word record with the five sections is accepted.
- [FR-28]
  - Given a fix plan in execute, after `escalate` the track is feature, the stage is prd, and the fix slice keeps its status with its scope narrowed to the files it changed.
  - On a feature plan, `escalate` refuses.
- [FR-29] An answer with an apostrophe given through `decide --file` is recorded verbatim. `--note-file` works on `approve` and `evidence`.
- [FR-30] Choosing "Approve and start clean" approves the phase and shows the clean-start steps. This is checked live.
- [FR-31] A node:test checks that every skill lists the named subcommands and none lists `repro` or `cairn:*`.
- [FR-32] Editing the `test` command after plan approval makes `slice done` refuse. Re-approving the plan clears it.
- [FR-33] A test command that prints `$CAIRN_APPROVER` prints nothing.
- [FR-41] A slice whose branch changes a file outside its scope, through any tool, gets a drift entry at `slice done`. That entry blocks phase approval until it is reviewed.
- [FR-42] A slice started before a re-plan can be marked done after it, without an override.
- [FR-35] `new.md` contains no EnterWorktree step. `execute.md` runs `cairn` with `cd <plan worktree> &&`. Checked by a node:test.
- [FR-36] When the test output ends with an `npm notice` line after `ℹ pass 12`, the recorded summary is `ℹ pass 12`.
- [FR-37] STATUS.md shows "PRD approved … (you, in the menu)" for `source: mod` and "(you, in the terminal)" for `source: terminal`.
- [FR-38] `cli.md` names `mod-secret.sha256`, `mod-heartbeat`, and the pending-override rule. The README states "Claude Code v2.1.287 or later".
- [FR-39] A PRD with `**FR-02a**` makes `plan load` refuse and name the id.
- [FR-40] A slice with `kind: prefactor` and `covers: []` loads. Without `kind: prefactor`, empty `covers` refuses.
- [NFR-02]
  - An injected throwing guard denies the matched call and allows an unmatched one.
  - A throwing approval hook still returns the user's menu result.
- [NFR-07] A throwing pane render leaves tool calls unaffected.

## Unhappy paths
- [FR-01] With `--human` and no TTY, it exits 2 with "run this in your own terminal". When the secret file is missing or unreadable, mod proof fails and the terminal path still works.
- [FR-02] When the tag doesn't match the waiting stop, or `cairn approve` refuses, the hook's `context` and a toast carry the reason, and nothing is recorded. A dismissed dialog records nothing.
- [FR-34] When the pending override has expired, or names another plan, the command runs normally and the CLI's refusal is returned.
- [FR-03] When a guard throws, the matched call is denied (NFR-02).
- [FR-05] When the user cancels the confirm dialog, nothing is recorded.
- [FR-06] When the git common dir is unwritable, the heartbeat is skipped, `modActive` stays false, and the procedures use the terminal path.
- [FR-08] When the session root isn't a git repo, the mod only registers its commands. When the pane can't be placed, the reason is shown.
- [FR-10] When `state.json` is mid-write or isn't valid JSON, the pane keeps the last good view and retries on the next poll.
- [FR-13] When the plan is already paused, Pause is absent. When `cairn pause` refuses, a toast shows the reason and state is unchanged.
- [FR-14] When the abort is rejected or no turn is running, Stop now still pauses with mode `now`.
- [FR-17] When the other plan's branch is gone, a toast says so and the list refreshes.
- [FR-19] When the phase isn't waiting for approval, `evidence phase` refuses. When the YAML doesn't parse, the refusal quotes the parser error.
- [FR-23] When the slug already exists, `cairn new` refuses as it does today.
- [FR-24] A command that can't start, or that times out, is refused and the error is quoted.
- [FR-25] When the repro hangs past the timeout during `slice done`, it counts as still failing.
- [FR-28] On a feature plan, `escalate` refuses.
- [FR-29] When the file is missing or isn't valid JSON, the command exits 1 and names the file.
- [FR-32] When `.sdlc/config.json` is missing at plan approval, the recorded hash is of an empty config, and adding one later refuses until re-approval.

## Security considerations
- **Self-approval by the model.** The controls are layered:
  - The CLI requires the mod's single-use secret, checked against an on-disk hash, or a TTY run (FR-01). Overrides run through the mod itself (FR-34), so there is no grant file to forge.
  - The mod denies, by default, any Bash call that touches approvals, plan state, or the secret (FR-03), and any other tool that writes those paths (FR-04).
  - Every approval records its source, and STATUS.md shows it.
- **Override as a bypass.** Overrides need the same human proof as approvals (FR-01).
- **Menu wording.** The mod requires the exact label, a tag that matches the waiting stop, the tagged question's own answer, and a dialog the user actually answered (FR-02).
- **Secret exposure.** The secret file has mode 0600 and is rotated after each use. Bash and file tools can't read it (FR-03, FR-04). Child commands run without it (FR-33).
- **Model-written shell.** Repro commands go through the normal permission prompt (FR-31). Changes to the configured commands after approval are refused (FR-32).
- **Injection through mod messages.** The Stop now message is fixed text (FR-14). The mod runs processes only with argv arrays and never passes model text to a shell.
- **Verdict laundering.** The CLI computes the verdict (FR-19), and a code commit after the verdict invalidates it (FR-20).
- **Heartbeat spoofing.** A forged heartbeat only changes which approval path a procedure shows; it grants nothing.
- **Guards failing open.** Guards fail closed (NFR-02).

## Testing decisions
- **CLI tests (node:test).** These cover:
  - approval and override proof, with an injectable TTY check and an injectable stdin reader
  - the hash check, single use, and the hash file deleted after a match
  - evidence phase, scorecard parsing, and the commit check
  - the fix-track stages, repro with an injectable timeout, `escalate`, and the file count
  - `--file` and `--note-file`
  - `modActive`
  - the config hash
  - environment scrubbing
  - a scan of the procedures and skills for the FR-07 and FR-31 text
- **Mod tests (`claude plugin test`).** These cover the guards, using the FR-03 and FR-04 tables, and:
  - the AskUserQuestion approval, with a mocked process run whose argv and environment are asserted, and the `context` output asserted
  - pane fixtures for FR-09 and FR-12
  - poll spying for NFR-01
  - the pause handoff text, Stop now, and resume in place versus fresh
  - throwing-guard and throwing-render cases
- **Early API check.** This is the first slice. It answers two questions and records the results in the plan:
  - Does `tool.call` fire for subagent Bash calls?
  - Does `$.command.run` run a plugin skill command? If not, Resume falls back to `$.prompt.submit`.

  The types already confirm that a `tool.call` hook sees `answers` after `next(e)`.
- **Live check.** At the end of each phase, a smoke run in a live session covers what automation can't: placement, procedures, and the phase-end flow.

## Further notes
- The drift check is adapted from `sources/vercel-ceo/.claude/commands/direction.md`.
- The mod lives at `plugins/cairn/hooks/register.tsx`. Its types contract is at `plugins/cairn/types/index.d.ts`.

## Open questions
- [x] Does the fast lane keep a learn stage? (answer: no; the ship stop closes a fix plan)
- [x] What happens when the mod isn't running? (answer: terminal approval with a typed confirmation, decision 7)
- [x] Can a `tool.call` hook read the AskUserQuestion answer? (answer: yes, `answers` keyed by question text after `next(e)`; verified live in the first slice)
