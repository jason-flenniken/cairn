# Execute

Orchestrate the current phase: start every ready task, build it, review it, merge it, repeat until the phase has no remaining tasks.

Talk to the user per `references/reporting.md`; model choices follow `references/model-tiers.md`. `cairn` is on PATH; if not, run `node "${CLAUDE_PLUGIN_ROOT}/dist/cairn.mjs"`.

**Questions that block the plan.** Before an AskUserQuestion only the user can answer (not the approval question: the step `approving` already says that one waits), run `cd <plan worktree> && cairn step asking`, so the pane of a session in another plan shows that this plan waits for the user in its session. Once it is answered, run `cd <plan worktree> && cairn step clear`; Build has no other step.

You stay at the repo root. The session is not locked to a worktree, so your subagents can edit and commit in task worktrees. The plan lives in its own worktree on the plan branch (from `cairn status --json`, `state.branch`). You and the steward agents (the writers and the `linear-sender`) run `cairn`; implementers and reviewers never do, and never touch `docs/cairn/`. You are the only one who merges. Every `Agent` call sets `description` to "<Role> · <task name>" (Build, Review, Fix, Check, Record), per `references/reporting.md`.

Keep your own context small. Agents get a path, not text: `cairn task brief` writes each brief to disk, agents write their full report to disk, and you read only their last few lines. Do not read a report or a brief file yourself; `cairn task report` and `cairn review record` read them for you.

**Running cairn.** Every `cairn` command below runs from the plan worktree: `cd <plan worktree> && cairn <command>`. The one exception is an override command (a `cairn` command the user chose to override). It runs alone, with no `cd` and no `&&`, because the mod refuses compound commands and resolves the plan itself. Keep its reason plain text, as `procedures/review.md` describes.

**When a stage ends.** After `cairn advance`, `cairn phase finish` or `cairn next`, when the output holds a line like "Context is at 62%. Everything is saved: start fresh with /clear, then /cairn:next.", tell the user that line as the outcome and stop. Do not start the next step.

## At this level
Read `level` from `cairn status --json` (once, at the start); `references/levels.md` has the full table.
- MVP: skip `task-reviewer`. The floor still applies: a task that touches a trust boundary gets the `security-reviewer`, and its Critical and Required findings go through step 6. Implementers run one tier below the task's complexity (the MVP table in `references/model-tiers.md`). Tests warn: a red suite at `cairn task merge` is not a refusal; the CLI files the hardening item. cairn files the unreviewed-task items itself when the plan reaches ship.
- Standard: as written below.
- Polished: test-first for every task. Add a line to each build brief's prompt telling the implementer to write the failing test before the code, and have the task-reviewer check that it did.

## Changing the level
`references/levels.md` explains how a raise works. Only suggest one when the MVP shortcuts are visibly costing more than they save; the user decides. After a raise, run `cairn suggest list --open --json`, take the entries with `hardening: true` whose `where` overlaps this plan's tasks (or use `--for <path>`), and ask whether to work through them now.

## 1. Check
Run `cd <plan worktree> && cairn status --json` once. The stage must be `execute`. Any other stage: say which and run `cairn next --json`. Stop this procedure.
- Paused: tell the user the plan is paused and stop. `/cairn:resume` continues it.
- Note the plan slug, the plan branch, the plan worktree path (`planWorktree` in the status output), and the current phase.

**Done when:** the stage is `execute`, the plan is not paused, and you hold the four values above.

**Linear updates.** When a `cairn` command's output says "N Linear updates queued", dispatch the `linear-sender` agent in the background (`model: haiku`, `description` "Record · Linear updates") with the plan worktree path and the plugin root, and carry on, but only when no `linear-sender` is already running (a running one claims the queue itself). Do not wait for it. When it returns, mention its one line only if something failed.

**Pause check.** Between any two steps below (before starting a task, dispatching or messaging an agent, merging), run `cd <plan worktree> && cairn status` (one line). When it says paused, start nothing new and read `procedures/execute-cases.md` ("The plan is paused").

## 2. Resume what is in progress
Tasks already `in_progress` carry a recorded step. Continue each from there; starting over wastes finished work.
- `implementing`: check whether an implementer is still running for it. If not, dispatch a fresh one (step 4) with a note to inspect the worktree's existing commits first.
- `reviewing`: run step 5.
- `fixing`: run step 6.
- `merging`: run step 7.
- `blocked`: read `procedures/execute-cases.md` ("A task is blocked").

**Done when:** every in-progress task is back in the loop at its recorded step.

## 3. Start ready tasks
Run `cd <plan worktree> && cairn ready --json`. For each ready task run `cd <plan worktree> && cairn task start <id>`; it creates the task worktree and writes the build brief, and prints "Brief: <path>". Cap parallelism at what `cairn ready` returns.

**Done when:** every ready task is started and you hold its brief path. An empty ready list with no in-progress tasks means the phase is finished: go to step 8.

## 4. Build
For each started task, dispatch the `implementer` agent in the background, with an explicit `model` from the task's complexity (simple: haiku, standard: sonnet, complex: opus; the status shows it) and `description` "Build · <task name>". The prompt is three lines at most:

```
Brief: <brief path>. Plugin root: <root>.
<one line only when needed: "Inspect the worktree's existing commits first." / "Write the failing test first.">
```

Then run `cd <plan worktree> && cairn task step <id> implementing`. Tell the user in 1-3 lines which tasks started.

**Done when:** each started task has a running implementer.

## 5. Record the report, review the task
An implementer's final message is five lines: `Status`, `Commits`, `Tests`, `Concerns`, `Report`. Record it: `cd <plan worktree> && cairn task report <id> <report path>`. It prints one line (the status and how many follow-ups it logged).
- `NEEDS_CONTEXT`, `BLOCKED`, a merge refusal or red tests after merging: read `procedures/execute-cases.md` for that case.
- `DONE` or `DONE_WITH_CONCERNS`: review every task, risky or not. Run `cd <plan worktree> && cairn task step <id> reviewing`, then `cd <plan worktree> && cairn task brief <id> --role review`; it prints the brief path and the report path. Dispatch the `task-reviewer` agent (`model: sonnet`, `description` "Review · <task name>") with the prompt `Brief: <path>. Plugin root: <root>.` (the root is `${CLAUDE_PLUGIN_ROOT}`). The brief points at the implementer's report for its `Tests:` line (and its `Concerns / questions:` line when the status is `DONE_WITH_CONCERNS`) only. Never tell the reviewer to read the rest of the report: a reviewer who reads the builder's account grades the account instead of the code.
- When the task is `risky` (or the build's `Concerns` line or the diff shows auth, money, deletes, migrations, a public API, untrusted input, personal data, a new dependency, model output, or shell commands and paths built from data), also run `cd <plan worktree> && cairn task brief <id> --role security` and dispatch the `security-reviewer` agent in the same message, so both run in parallel (`model: sonnet`, `description` "Review · <task name> (security)").
- Each reviewer ends with `Verdict`, `Counts` and `Report`. Record each: `cd <plan worktree> && cairn review record <id> <report path>`. It logs the Optional, Nit and pre-existing findings as follow-ups itself (the `cairn suggest add` step, with `--from task-review` or `--from security-review`) and prints one line: `PASS`, or `FIX` with the must-fix findings. A pre-existing finding, at any label, is logged and never sent to step 6; name a pre-existing Critical to the user in one line. FYI: mention once in your progress line. Do not log it.
- Both recorded `PASS`: step 7. Critical and Required: step 6 (the `FIX` line names each with its proposed fix).

**Done when:** each reported task is ready to merge, or in step 6.

## 6. Fix
Only Critical and Required findings are fixed. Run `cd <plan worktree> && cairn task step <id> fixing --note "fixing classes: <class>, <class>"` (the classes come from the `FIX` line), so the plan log keeps which kinds of mistake needed fixing. Plan on one fix attempt for review findings; the CLI refuses past 2 per task (the second is for a test failure after merging).
- Run `cd <plan worktree> && cairn task brief <id> --role fix`. It writes the must-fix findings, grouped by class, with their proposed fixes (and the last red test run, when there is one). Send the brief path to the same implementer with SendMessage (or dispatch a fresh implementer on the same worktree when the old one has ended), `description` "Fix · <task name>". Tell it in one line to fix each class everywhere in the task's scope, not only at the lines cited, and to list the other places it fixed.
- When it ends, run `cd <plan worktree> && cairn task report <id> <report path>`, then re-review once with the reviewer that raised the findings (both when both did): `cd <plan worktree> && cairn task brief <id> --role review --again` (or `security`). It lists the earlier must-fix findings and writes to the same report path as the first review. Dispatch the reviewer with the brief path, then `cd <plan worktree> && cairn review record <id> <report path>`; recording replaces the old must-fix findings.
- When a Critical or Required finding is still open after that attempt (or the CLI refuses another), stop work on the task and ask the user with AskUserQuestion: Fix by hand / Accept as is (noted in the record) / Re-plan this task / Pause.

**Done when:** the task passed, or the user chose how to proceed.

## 7. Merge
When the task is ready to merge: run `cd <plan worktree> && cairn task step <id> merging`, then `cd <plan worktree> && cairn task merge <id>`. It merges the task branch into the plan branch, runs the repo's checks and tests, and cleans up. Docs-only conflicts are settled by the CLI.

Anything else (a refusal, a conflict outside `docs/cairn/`, red tests after the merge): read `procedures/execute-cases.md`.

**Done when:** `cairn task merge <id>` exits 0. Report in 1-3 lines: the task, the test count, what starts next.

## 8. Loop
After every completion, return to step 3. Make the pause check between rounds.

When `cairn ready` is empty and no task is in progress, the phase has no remaining tasks. Run `cd <plan worktree> && cairn next --json`, follow the procedure it names (phase-end for a feature plan, review for a fix plan), and relay a fresh-start line if its output holds one.

## Rare cases
Read `procedures/execute-cases.md` only when one of these happens: an implementer returns `NEEDS_CONTEXT` or `BLOCKED`, `cairn task merge` refuses or conflicts, tests are red after the merge, a task is blocked, or the plan is paused.

**Done when:** the phase has no remaining tasks and the next procedure started, or you relayed the fresh-start line and stopped.
