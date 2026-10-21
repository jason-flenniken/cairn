# Execute

Orchestrate the current phase: start every ready task, build it, review it, merge it, repeat until the phase has no remaining tasks.

Templates live in `templates/`, next to this `procedures/` folder. Talk to the user per `references/reporting.md`; model choices follow `references/model-tiers.md`. `cairn` is on PATH; if not, run `node "${CLAUDE_PLUGIN_ROOT}/dist/cairn.mjs"`.

You stay at the repo root. The session is not locked to a worktree, so your subagents can edit and commit in task worktrees. The plan lives in its own worktree on the plan branch (from `cairn status --json`, `state.branch`). You are the only one who merges, and the only one who runs `cairn`. Agents get a worktree path and a brief; they never touch `docs/sdlc/`. Every `Agent` call sets `description` to "<Role> · <task name>" (Build, Review, Fix, Check, Record), per `references/reporting.md`.

**Running cairn.** Every `cairn` command below runs from the plan worktree: `cd <plan worktree> && cairn <command>`. The one exception is an override command (a `cairn` command the user chose to override). It runs alone, with no `cd` and no `&&`, because the mod refuses compound commands and resolves the plan itself. Keep its reason plain text, as `procedures/review.md` describes.

## 1. Check
Run `cd <plan worktree> && cairn status --json`. The stage must be `execute`. Any other stage: say which and run `cairn next --json`. Stop this procedure.
- Paused: tell the user the plan is paused and stop. `/cairn:resume` continues it.
- Note the plan slug, the plan branch, the plan worktree path (`planWorktree` in the status output), and the current phase.

**Done when:** the stage is `execute`, the plan is not paused, and you hold the four values above.

**Pause check.** Between any two steps below (before starting a task, dispatching or messaging an agent, merging), run `cd <plan worktree> && cairn status --json`. When it shows `paused`, start nothing new: no `cairn task start`, no new agent, no merge. Let running steps finish and record them. Append any open question you are holding to `docs/sdlc/plans/<date>-<slug>/handoff.md` under `## Open questions` (earlier ones stay), then stop. `/cairn:resume` continues the plan.

## 2. Resume what is in progress
Tasks already `in_progress` carry a recorded step. Continue each from there; starting over wastes finished work.
- `implementing`: check whether an implementer is still running for it. If not, dispatch a fresh implementer (step 4) with a note to inspect the worktree's existing commits first.
- `reviewing`: run step 5 (the review).
- `fixing`: run step 6.
- `merging`: run step 7.
- `blocked`: run step 8.

**Done when:** every in-progress task is back in the loop at its recorded substep.

## 3. Find ready tasks
Run `cd <plan worktree> && cairn ready --json`. For each ready task run `cd <plan worktree> && cairn task start <id>`; it prints the task worktree path. Cap parallelism at what `cairn ready` returns.

**Done when:** every ready task is started and you hold its worktree path. An empty ready list with no in-progress tasks means the phase is finished: go to step 9.

## 4. Implement
For each started task, dispatch the `implementer` agent in the background, with an explicit `model` from the task's complexity (simple: haiku, standard: sonnet, complex: opus) and `description` "Build · <task name>". Build the brief from these parts and nothing else:
1. The task's `### Task: <id>` section from `plan.md`, verbatim, and whether the task is `risky`.
2. The PRD requirements the task covers, quoted verbatim from `prd.md`.
3. The plan's Global constraints, when it has that section.
4. The task worktree path and the plan branch name (from `cairn status --json`, `state.branch`).

Then run `cd <plan worktree> && cairn task step <id> implementing`.

**Done when:** each started task has a running implementer, and you've told the user in 1-3 lines which tasks started.

## 5. Read the report, review every task
When an implementer reports, read its status line.
- `NEEDS_CONTEXT`: answer from the PRD, plan, or `decisions.md` and send it to the implementer with SendMessage. Ask the user only when the documents don't answer it (AskUserQuestion, recommended first; record with `cd <plan worktree> && cairn decide`).
- `BLOCKED`: step 8.
- `DONE` or `DONE_WITH_CONCERNS`: first log the report's `Suggestions:` lines (up to 3) with `cd <plan worktree> && cairn suggest add --area <area> --where <path> --from implementer --text "<text>"`. Then review the task, risky or not: run `cd <plan worktree> && cairn task step <id> reviewing`.
  - Dispatch the `task-reviewer` agent (`model: sonnet`, `description` "Review · <task name>") with the plugin root path (`${CLAUDE_PLUGIN_ROOT}`), the task section, the covered requirements, the implementer's report, and the diff command `git -C <worktree> diff <plan-branch>...HEAD`.
  - When the task is `risky` (or the report or the diff shows auth, money, deletes, migrations, a public API, untrusted input, personal data, a new dependency, model output, or shell commands and paths built from data), dispatch the `security-reviewer` agent in the same message, so both run in parallel (`model: sonnet`, `description` "Review · <task name> (security)"), with the same brief and diff.
  - Each reviewer returns `Verdict: PASS | FIX` and findings labelled Critical, Required, Optional, Nit or FYI. Route them:
    - Critical and Required: step 6. Each one names its proposed fix.
    - Optional and Nit: log each with `cd <plan worktree> && cairn suggest add --area <area> --from task-review --where <path> --text "<finding>"` (`--from security-review` for the security reviewer's).
    - FYI: mention once in your progress line. Do not log it.
  - No Critical or Required finding from either reviewer: step 7.

**Done when:** each reported task is ready to merge, or in step 6 or 8.

## 6. Fix (Critical and Required findings)
Only Critical and Required findings are fixed. Run `cd <plan worktree> && cairn task step <id> fixing`. Plan on one fix attempt for review findings; the CLI refuses past 2 per task (the second is for a test failure after merging).
- Send those findings, with their proposed fixes, back to the same implementer with SendMessage (or a fresh implementer on the same worktree when the old one has ended), `description` "Fix · <task name>".
- After it reports DONE, re-review once with the reviewer that raised them (both when both did), limited to those findings and the fix diff.
- When a Critical or Required finding is still open after that attempt (or the CLI refuses another), stop work on the task and ask the user with AskUserQuestion: Fix by hand / Accept as is (noted in the record) / Re-plan this task / Pause.

**Done when:** the task passed, or the user chose how to proceed.

## 7. Merge
When the task is ready to merge: run `cd <plan worktree> && cairn task step <id> merging`. Then, in the plan worktree:
1. `cd <plan worktree> && git merge --no-ff <task branch> -m "merge task <id>"`, where the task branch is the one `cairn task start` printed (also `branch` on the task in `cairn status --json`).
2. Tasks never change `docs/sdlc/`, so the merge leaves it alone. If git reports a conflict under `docs/sdlc/`, keep the plan branch's side (`cd <plan worktree> && git checkout --ours -- docs/sdlc`) and tell the user the task broke that rule. Don't reset or check out `docs/sdlc/` any other way: `state.json` there has live changes that aren't committed.
3. On conflicts, resolve them using the task scopes in `plan.md`; when the resolution involves a judgment call, report it per the deviations rule.
4. Run `cd <plan worktree> && cairn task done <id>`. The CLI runs the repo's test command in the plan worktree.

If `cairn task done` is refused because tests fail, send the failures to a fresh implementer on the merged tree (`cd <plan worktree> && cairn task step <id> fixing`), then merge again.

**Done when:** `cairn task done <id>` exits 0. Report in 1-3 lines: the task, the test count, what starts next.

## 8. Blocked
Run `cd <plan worktree> && cairn task step <id> blocked --note "<what blocks it>"`. Pick the cheapest remedy:
- Missing information: answer it from the documents or ask the user, then restart the implementer.
- Task too hard: restart with a fresh implementer one tier up.
- Task too big or wrong: tell the user and offer a re-plan (edit `plan.md`, then `cd <plan worktree> && cairn plan load --replan`, then ask for approval of the changed plan).

**Done when:** the task is unblocked and back at `implementing`, or the user chose to re-plan or pause.

## 9. Loop
After every completion, return to step 3. Make the pause check above between rounds.

When `cairn ready` is empty and no task is in progress, the phase has no remaining tasks.

**Done when:** the phase has no remaining tasks. Then run `cd <plan worktree> && cairn next --json` and follow the procedure it names (phase-end for a feature plan, review for a fix plan).
