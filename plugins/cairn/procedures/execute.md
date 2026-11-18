# Execute

Orchestrate the current phase: start every ready task, build it, review it, merge it, repeat until the phase has no remaining tasks.

Talk to the user per `references/reporting.md`; model choices follow `references/model-tiers.md`. The build runs without asking and without stopping: read `references/autonomy.md` once. It says what you decide alone, what you record as not done, and what you never change. `cairn` is on PATH; if not, run `node "${CLAUDE_PLUGIN_ROOT}/dist/cairn.mjs"`.

You stay at the repo root. The session is not locked to a worktree, so your subagents can edit and commit in task worktrees. The plan lives in its own worktree on the plan branch (from `cairn status --json`, `state.branch`). You and the steward agents (the writers and the `linear-sender`) run `cairn`; implementers and reviewers never do, and never touch `docs/cairn/`. You are the only one who merges. Every `Agent` call sets `description` to "<Role> · <task name>" (Build, Review, Fix, Check, Record), per `references/reporting.md`.

Keep your own context small and your turns few. Agents get a path, not text: cairn writes each brief to disk, agents write their full report to disk and record it themselves, and you read only their last few lines. Every build and review agent ends with a `Next:` line that cairn printed: it names the next dispatch, so you act on it without running cairn first. Do not read a report or a brief file yourself.

**Running cairn.** Every `cairn` command below runs from the plan worktree: `cd <plan worktree> && cairn <command>`. Each model turn re-reads the whole conversation, so do the bookkeeping in as few turns as possible: when two commands follow each other, chain them in one Bash call with `&&`; when a command precedes an agent dispatch or a question, send the Bash call and that tool call in the same message. Never spend a turn on a progress message alone: the 1-3 line note goes in the same message as a dispatch or a `cairn` call, and a turn with nothing to dispatch ends with no message.

**When a stage or phase ends.** Carry on into the next step. Never stop to suggest `/clear` or a new session: long sessions are compacted automatically, and the user decides when to clear.

## At this level
Read `level` from `cairn status --json` (once, at the start); `references/levels.md` has the full table.
- MVP: skip `task-reviewer`. The floor still applies: a task that touches a trust boundary gets the `security-reviewer`, and its Critical and Required findings go through step 6. Implementers run one tier below the task's complexity (the `Builder:` line gives the model). Tests warn: a red suite at `cairn task merge` is not a refusal; the CLI files the hardening item. cairn files the unreviewed-task items itself when the plan reaches ship.
- Standard: as written below. `cairn task report` prints a `Task review:` line. On `no` (the branch review covers the task), skip the task-reviewer and go to step 7. On `yes` (the task is risky or complex), review it as written. A merge may run the quick tests (`testQuick`); the full suite runs at the phase end.
- Polished: every task gets the task-reviewer (the `Task review:` line says yes). Test-first for every task. Add a line to each build brief's prompt telling the implementer to write the failing test before the code, and have the task-reviewer check that it did.

## Changing the level
`references/levels.md` explains how a raise works. The level is the user's: do not change it during the run. When the MVP shortcuts visibly cost more than they save, say so in the pull request (`cairn suggest add`), not to the user mid-run.

## 1. Check
Run `cd <plan worktree> && cairn status --json` once. The stage must be `execute`. Any other stage: say which and run `cairn next --json`. Stop this procedure.
- Paused: tell the user the plan is paused and stop. `/cairn:resume` continues it.
- Note the plan slug, the plan branch, the plan worktree path (`planWorktree` in the status output), and the current phase.

**Done when:** the stage is `execute`, the plan is not paused, and you hold the four values above.

**Linear updates.** When a `cairn` command's output says "N Linear updates queued", dispatch the `linear-sender` agent in the background (`model: haiku`, `description` "Record · Linear updates") with the plan worktree path and the plugin root, and carry on, but only when no `linear-sender` is already running (a running one claims the queue itself). Do not wait for it. When it returns, mention its one line only if something failed.

**Pause.** Rely on the refusals: `cairn task start` and `cairn task merge` refuse while the plan is paused, and a merge's `Next:` line says so. When one does, start nothing new and read `procedures/execute-cases.md` ("The plan is paused").

## 2. Resume what is in progress
Tasks already `in_progress` carry a recorded step. Continue each from there; starting over wastes finished work.
- `implementing` (`cairn task start` records it): check whether an implementer is still running for it. If not, dispatch a fresh one (step 4) with a note to inspect the worktree's existing commits first.
- `reviewing` or `fixing`: when the agent for that step has ended, record its report yourself (step 5, "No `Next:` line") and follow the line it prints. Otherwise wait for it.
- `merging`: run step 7.
- `blocked`: read `procedures/execute-cases.md` ("A task is blocked").

**Done when:** every in-progress task is back in the loop at its recorded step.

## 3. Start ready tasks
Run `cd <plan worktree> && cairn task start --ready`. It starts every ready task: it creates the task worktree, writes the build brief and records the step `implementing`. It prints one `Start: <id> (<name>) — Brief: <path> — Builder: …` line per task and a `Next:` line. Parallelism is capped at what is ready. (`cairn task start <id>` starts one task.)

**Done when:** every ready task is started and you hold its `Start:` line. A `Next: cairn next --json` line (nothing ready, nothing running) means the phase is finished: go to step 8.

## 4. Build
For each `Start:` line, dispatch the `implementer` agent in the background, all in one message. Use the `model` (and `effort`, when named) from its `Builder:` line, and the `description` "Build · <task name>". The prompt is three lines at most:

```
Brief: <brief path>. Plugin root: <root>.
<one line only when needed: "Inspect the worktree's existing commits first." / "Write the failing test first.">
```

Tell the user in 1-3 lines which tasks started, in the same message as the dispatches.

**Done when:** each started task has a running implementer.

## 5. Follow the agent's `Next:` line
Each implementer and each task or security reviewer records its own report as the last step of its brief: `cairn task report` for a build or a fix, `cairn review record` for a review. It then ends its final message with the `Next:` line cairn printed. Do what that line says, in one message:
- `Next: dispatch …`: dispatch exactly the agents it names, with the model, effort and `description` it gives, and the prompt `Brief: <path>. Plugin root: <root>.` (the root is `${CLAUDE_PLUGIN_ROOT}`). Two reviewers go in the same message, so they run in parallel. The brief points at the implementer's report for its `Tests:` line (and its `Concerns / questions:` line when the status is `DONE_WITH_CONCERNS`) only. Never tell the reviewer to read the rest of the report: a reviewer who reads the builder's account grades the account instead of the code.
- `Next: wait …`: another review of the same task is still running. End the turn with no tool call and no message.
- `Next: cairn task merge <id>`: step 7.
- `Next: set the task aside …`: step 6, last bullet.
- `Next: read procedures/execute-cases.md for …`: that case.
- **No `Next:` line** (the agent skipped the record, or it refused): record it yourself, then follow the line it prints. For a build or a fix run `cd <plan worktree> && cairn task report <id> <report path>`; for a review run `cd <plan worktree> && cairn review record <id> <report path>`. Recording the same report twice changes nothing, so this is always safe.

How cairn chooses, so you can check it:
- `cairn task report` prints a `Task review:` line. When the `Task review:` line says `no`, skip the task-reviewer. The next bullet still applies: the security floor runs on a task with no task review.
- cairn names the `security-reviewer` when the task is `risky` or the build's `Trust boundary:` line names one. When the `Concerns` line shows auth, money, deletes, migrations, a public API, untrusted input, personal data, a new dependency, model output, or shell commands and paths built from data, and cairn named no security review, add it: run `cd <plan worktree> && cairn task brief <id> --role security` and dispatch the `security-reviewer` (`model: sonnet`, `description` "Review · <task name> (security)"), in parallel with the task-reviewer when there is one. To brief a reviewer by hand (a lost brief), use `cairn task brief <id> --role review`, or `--role review --again` after a fix.
- `cairn review record` logs the Optional, Nit and pre-existing findings as follow-ups itself (the `cairn suggest add` step, with `--from task-review` or `--from security-review`). A pre-existing finding, at any label, is logged and never sent to step 6; name a pre-existing Critical to the user in one line. FYI: mention once in your progress line. Do not log it.
- Every review in and all PASS: merge. Critical and Required: step 6. cairn has already recorded the fix attempt and written the fix brief.

**Done when:** each reported task is merging, fixing, set aside, or waiting on its other review.

## 6. Fix
Only Critical and Required findings are fixed. When the last review records a must-fix, cairn records the fix attempt itself: the step `fixing`, with the classes of the findings in its note, so the plan log keeps which kinds of mistake needed fixing. Review findings get one attempt; the CLI allows a second only for a test failure after merging, at one tier up. It also writes the fix brief (`--role fix`), with the findings grouped by class and their proposed fixes. Its `Next:` line names the model.
- Dispatch a fresh implementer as the line names, `description` "Fix · <task name>". Tell it in one line to fix each class everywhere in the task's scope, not only at the lines cited, and to list the other places it fixed. Never resume the original implementer with SendMessage. A fresh agent starts small, while a resumed one drags its whole build along, and a running agent cannot change model.
- The fix's report names the re-review. It goes only to the reviewer that raised the findings (both when both did), with a `--again` brief that lists the earlier must-fix and writes to the same report path. The re-review is always a fresh reviewer: never resume an earlier reviewer or send it a message, because a resumed reviewer drags its whole earlier context along. Recording it replaces the old must-fix findings.
- When a Critical or Required finding is still open after that attempt, cairn says so. Set the task aside (`references/autonomy.md`): `cd <plan worktree> && cairn task step <id> blocked --note "set aside: <finding>; tried: <fixes>; proposed: <next step>"`. Keep building the other tasks. The pull request lists it under Not done.

**Done when:** the task passed, or it is set aside.

## 7. Merge
Run `cd <plan worktree> && cairn task merge <id>`. It records the step `merging` itself, merges the task branch into the plan branch, runs the repo's checks and tests, and cleans up. Docs-only conflicts are settled by the CLI. It then starts every task the merge made ready, printing their `Start:` lines and a `Next:` line, so the next builders go out in the following message (step 4). The call runs the tests and each started task's `setup`, so give it, and `cairn task start --ready`, a long Bash timeout (600000 ms).

Anything else (a refusal, a conflict outside `docs/cairn/`, red tests after the merge): read `procedures/execute-cases.md`.

**Proposed proofs.** When the implementer's report proposes a proof (its Concerns line names one: an id, the requirements, the command, the files), and the merge brought the files onto the plan branch, add it: `cd <plan worktree> && cairn prove add <id> --covers <FR ids> --run "<command>" --files <paths> --note "<the case it checks>"`. It is locked at once and listed at ship. Never use this to replace a proof.

**A locked proof that is itself wrong.** Never edit, replace or retire it. When the code is right and the proof is what is wrong, add a corrected one beside it with `cairn prove add` and run it green. The old one stays red: pass it with `--not-done "<why this proof is wrong; the corrected one is <new-id>>"` when a check asks, so the pull request lists it for the user to retire after the merge.

**Done when:** `cairn task merge <id>` exits 0. Report in 1-3 lines, in the same message as the dispatches its `Start:` lines call for: the task, the test count, what starts next.

## 8. Loop
The merge's `Next:` line drives the loop:
- Dispatch the builders its `Start:` lines name (step 4).
- `wait for the running tasks`: end the turn with no message.
- `cairn next --json`: the phase has no remaining tasks.

A set-aside task never stops the loop: build every task that does not wait on it. The tasks that wait behind it are left out, and the pull request lists them.

When the phase has no remaining tasks, run `cd <plan worktree> && cairn next --json` and follow the procedure it names (phase-end for a feature plan, review for a fix plan). When the merge of the last task said the plan moved to Check, it names Check: follow it (its first step tells the user).

## Rare cases
Read `procedures/execute-cases.md` only when one of these happens: an implementer returns `NEEDS_CONTEXT` or `BLOCKED`, `cairn task merge` refuses or conflicts, tests are red after the merge, a task is blocked, or the plan is paused.

**Done when:** the phase has no remaining tasks and the next procedure started.
