# Execute: rare cases

Read this only when one of these happens during `procedures/execute.md`. Talk to the user per `references/reporting.md`. Run every `cairn` command from the plan worktree: `cd <plan worktree> && cairn <command>`.

## The implementer needs context (`NEEDS_CONTEXT`)
Its `Concerns` line holds the question. Answer it from the PRD, plan, or `decisions.md` and send the answer to the implementer with SendMessage. Ask the user only when the documents don't answer it (AskUserQuestion, recommended first; record with `cairn decide`).

## A task is blocked (`BLOCKED`, or a task at step `blocked`)
Run `cd <plan worktree> && cairn task step <id> blocked --note "<what blocks it>"`. Pick the cheapest remedy:
- Missing information: answer it from the documents or ask the user, then restart the implementer.
- A dependency between Linear issues (only when `cairn status --json` shows `state.linear`; the task needs something another issue builds, for example SAV-110 needs SAV-105's API): record it with `cairn linear depends SAV-110 --on SAV-105 --reason "<what it needs>"`. It queues the blocked-by link and a comment for Linear. Then:
  - Both issues are in this plan: re-plan so the tasks for SAV-110 come after the tasks for SAV-105 (send the change to the plan-writer, which edits `plan.md` and runs `cairn plan load --replan`; ask for approval of the changed plan).
  - The blocker is outside the plan and not done: ask with AskUserQuestion, recommended first: pull it in (amend the PRD, re-plan) / release the blocked issue (`cairn linear release SAV-110 --reason "…"`, it goes back to Linear and keeps its link) / stub the dependency and file a follow-up (`cairn suggest add …`) / pause.
  - The blocker is already done in Linear: nothing waits; restart the implementer.
- Task too hard: restart with a fresh implementer one tier up, and tell the user in one line.
- Task too big or wrong: tell the user and offer a re-plan (the plan-writer edits `plan.md` and runs `cairn plan load --replan`; then ask for approval of the changed plan).

**Done when:** the task is unblocked and back at `implementing`, or the user chose to re-plan or pause.

## `cairn task merge` refuses or conflicts
- A conflict only under `docs/cairn/`: the CLI keeps the plan's side and says so. Tell the user the task broke the rule that tasks never change `docs/cairn/`. Never reset or check out `docs/cairn/` any other way: `state.json` there has live changes that aren't committed.
- Any other conflict: the CLI aborts the merge and lists the conflicting files. Run `cd <plan worktree> && cairn task brief <id> --role fix`, dispatch an `implementer` (`model: sonnet`, `description` "Fix · merge <task name>") with `Brief: <path>. Plugin root: <root>.`; it merges the plan branch into the task branch in the task worktree, resolves using the task scopes in `plan.md`, and commits. Then run `cairn task merge <id>` again. Report a resolution that involved a judgment call per the deviations rule.
- Other refusals (the task is not at the merging step, the plan is paused): read what it names, do that, and rerun.

## Tests are red after the merge
`cairn task merge` refuses when the repo's tests fail on the merged tree. Run `cd <plan worktree> && cairn task step <id> fixing`, then `cairn task brief <id> --role fix` (it carries the failing output), and send the brief path to a fresh implementer on the merged tree (`description` "Fix · <task name>"; the second fix attempt uses a model one tier above the task's complexity). Record its report with `cairn task report <id> <report path>`, then run `cairn task merge <id>` again.

## The plan is paused
Start nothing new: no `cairn task start`, no new agent, no merge. Let running agents finish and record their reports. Append any open question you are holding to `docs/cairn/plans/<date>-<slug>/handoff.md` under `## Open questions` (earlier ones stay), then stop. `/cairn:resume` continues the plan.
