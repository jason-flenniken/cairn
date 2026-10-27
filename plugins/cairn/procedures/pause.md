# Pause

Stop cleanly: write the handoff, let in-flight work reach a safe point, and tell the user how to resume.

Templates live in `templates/`, next to this `procedures/` folder (`${CLAUDE_PLUGIN_ROOT}/templates/handoff.md`). Talk to the user per `references/reporting.md`. `cairn` is on PATH; if not, run `node "${CLAUDE_PLUGIN_ROOT}/dist/cairn.mjs"`.

## 1. Check
Run `cairn status --json`. A plan must be active (current branch is a plan or task branch) and not already paused. Otherwise say so and stop.

**Done when:** an active, unpaused plan is identified.

## 2. Choose drain or stop-now
When tasks are running, ask with AskUserQuestion: Drain (Recommended: in-flight tasks finish their current sub-step first) / Stop now (leave work as it is, commit work in progress in each worktree). With nothing in flight, skip the question.

**Done when:** you know whether to drain or stop now.

## 3. Settle in-flight work
- Drain: wait for each running agent to finish its current sub-step; start nothing new. The mod's `/cairn-pause-mod` command does this from the pane.
- Stop now: the mod's `/cairn-pause-now` command cuts the running turn and sends you here. Stop every running subagent with TaskStop, record each in-progress task's current substep with `cairn task step <id> <substep>`, then for each in-progress task worktree, commit work in progress: `git -C <worktree> add -A && git -C <worktree> commit -m "wip: <task id>"`.

**Done when:** no agent is mid-edit and every task worktree is committed.

## 4. Write handoff.md
Write `docs/cairn/plans/<date>-<slug>/handoff.md` from `${CLAUDE_PLUGIN_ROOT}/templates/handoff.md`, keeping its three `## ` headings:
- **In flight:** each in-progress task with its recorded substep (from `cairn status --json`), its worktree path, and what is committed.
- **Open questions:** anything waiting on the user, with your recommendation. Keep the questions an earlier handoff already lists and append the new ones; the mod's pause does the same.
- **Next action:** the exact first step on resume, for example "re-run review for the cart API task" or "continue the plan procedure at step 4".

**Done when:** all three sections have content a fresh session can act on.

## 5. Pause
Run `cairn pause` (add `--now` for stop-now). If refused, fix the handoff as it says and rerun.

**Done when:** the command exits 0.

## 6. Tell the user how to resume
Say in 2-3 lines: where the plan stands, and how to continue: `/cairn:resume` from this plan's worktree, or `cd <worktree> && claude` then `/cairn:resume`.

**Done when:** the user has the resume instruction.
