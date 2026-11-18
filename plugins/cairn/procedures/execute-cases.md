# Execute: rare cases

Read this only when one of these happens during `procedures/execute.md`. Talk to the user per `references/reporting.md`. Run every `cairn` command from the plan worktree: `cd <plan worktree> && cairn <command>`.

## The implementer needs context (`NEEDS_CONTEXT`)
Its `Concerns` line holds the question. Answer it from the PRD, the plan, `proofs.md` or `decisions.md`, and send the answer to the implementer with SendMessage. When the documents do not answer it, take the default that is easiest to undo and record it as `references/autonomy.md` says (`cairn decide "Assumed: …"`). Never pass the question to the user. Only when the task cannot go on even with a default, set it aside with the question in its note and keep building.

## A task is blocked (`BLOCKED`, or a task at step `blocked`)
Run `cd <plan worktree> && cairn task step <id> blocked --note "<what blocks it>"`. Pick the cheapest remedy:
- Missing information: answer it from the documents, or take an easy-to-undo default and record it, then restart the implementer. When neither works, leave the task set aside with the question in its note (`references/autonomy.md`); the pull request lists it.
- A dependency between Linear issues (only when `cairn status --json` shows `state.linear`; the task needs something another issue builds, for example SAV-110 needs SAV-105's API): record it with `cd <plan worktree> && cairn linear depends SAV-110 --on SAV-105 --reason "<what it needs>"`. It queues the blocked-by link and a comment for Linear. Then:
  - Both issues are in this plan: re-plan so the tasks for SAV-110 come after the tasks for SAV-105 (send the change to the plan-writer, which edits `plan.md` and runs `cd <plan worktree> && cairn plan load --replan --call "<why>"`; no approval is needed, and the proofs stay as they are).
  - The blocker is outside the plan and not done: stub the dependency, build the task against the stub, and record the call (`cairn decide "Assumed: stub <KEY>" "<what the stub does>" --why "<the blocker is outside this plan>"`). File a follow-up for the real thing (`cd <plan worktree> && cairn suggest add …`). When the task cannot be built against a stub at all, set it aside with that reason. Never pull the blocker into the plan (that would change the PRD) and never release the blocked issue on your own.
  - The blocker is already done in Linear: nothing waits; restart the implementer.
- Task too hard: restart with a fresh implementer one tier up, and tell the user in one line.
- Task too big or wrong: re-plan it yourself: split it, or write a different approach (the plan-writer edits `plan.md` and runs `cd <plan worktree> && cairn plan load --replan --call "<why>"`, which needs no approval), and record the call. The proofs and requirements do not change. When a re-plan cannot reach them, set the task aside.

**Done when:** the task is unblocked and back at `implementing`, re-planned, or set aside.

## `cairn task merge` refuses or conflicts
- A conflict only under `docs/cairn/`: the CLI keeps the plan's side and says so. Tell the user the task broke the rule that tasks never change `docs/cairn/`. Never reset or check out `docs/cairn/` any other way: `state.json` there has live changes that aren't committed.
- Any other conflict: the CLI aborts the merge and lists the conflicting files. Run `cd <plan worktree> && cairn task brief <id> --role fix`, dispatch an `implementer` (the `model` from the brief's `Builder:` line, `description` "Fix · merge <task name>") with `Brief: <path>. Plugin root: <root>.`; it merges the plan branch into the task branch in the task worktree, resolves using the task scopes in `plan.md`, and commits. Then run `cd <plan worktree> && cairn task merge <id>` again. Report a resolution that involved a judgment call per the deviations rule.
- Other refusals (the task worktree has uncommitted changes, the task has no commits, the plan is paused): read what it names, do that, and rerun. These checks run before anything is merged.

## Tests are red after the merge
`cairn task merge` refuses when the repo's tests fail on the merged tree; the merge stays in place and the refusal ends with "Full output: <log path>". Run `cd <plan worktree> && cairn task step <id> fixing && cairn task brief <id> --role fix` in one call (the brief carries the last red test run: the failing lines and the log path), and send the brief path to a fresh implementer (`description` "Fix · <task name>"; use the `model` from the fix brief's `Builder:` line). It merges the plan branch into the task branch in the task worktree, fixes and commits there (never on the plan branch). Record its report with `cd <plan worktree> && cairn task report <id> <report path>`, then run `cd <plan worktree> && cairn task merge <id>` again.

## The plan is paused
Start nothing new: no `cairn task start`, no new agent, no merge. Let running agents finish and record their reports. Append any open question you are holding to `docs/cairn/plans/<date>-<slug>/handoff.md` under `## Open questions` (earlier ones stay), then stop. A pause is the user's: it is the one way the run stops before the pull request. `/cairn:resume` continues the plan.
