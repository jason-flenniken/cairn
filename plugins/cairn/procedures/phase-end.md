# Phase end

Finish a built phase that has another phase after it, and keep going. The CLI checks the phase; there is no human step.

The last phase has no phase end: merging its last task moves the plan to Check, and Check runs the full suite and that phase's on-track check (`procedures/verify.md`). You reach this procedure for the last phase only when the merge could not move it: overlap phases built out of order (the last one built before an earlier one finished), the plan paused, Linear changes not handled, or a red on-track check. (A task set aside does not stop it: the phase finishes without that task, and the pull request lists it.) Then `cairn phase finish` moves it to Check without running the suite.

Talk to the user per `references/reporting.md`. `cairn` is on PATH; if not, run `node "${CLAUDE_PLUGIN_ROOT}/dist/cairn.mjs"`. Run every `cairn` command from the plan worktree: `cd <plan worktree> && cairn <command>`.

## At this level
Read `level` from `cairn status --json`; `references/levels.md` has the full table. 
- MVP and Standard: as written below. The on-track check is optional.
- Polished: before `cairn phase finish`, run the on-track check for the phase without being asked: follow `procedures/direction.md` and treat a red result as in step 3. The last phase's on-track check runs in Check instead.

## 1. Finish the phase
Run `cd <plan worktree> && cairn step wrapping` (so the pane shows "Build · wrapping up phase"), and when `state.linear` is not set, chain the next command in that same call (`cairn step wrapping && cairn phase finish`). Tell the user in one line that phase N is built and you are wrapping it up (the full suite, and the on-track check at Polished) before phase N+1; for the last phase, that it moves to Check, which runs them. Call this "wrapping up phase N", never "checks": Check is the stage after Build.

When `cairn status --json` shows `state.linear`, first re-read the plan's issues from Linear: dispatch the `linear-sender` agent (`model: haiku`, `description` "Record · Linear refresh") in the foreground, so it finishes before `cairn phase finish`, with the plan worktree path, the plugin root, and the job "phase-end refresh". It fetches each issue again through the Linear MCP and runs `cairn linear import --refresh`. When it returns, its message holds what changed in Linear since the plan started: a new blocked-by link on an in-plan issue, or a sub-issue added to the epic. Decide each yourself, without asking, and record it:
- A new blocker: it is a real dependency (`cairn linear depends <KEY> --on <KEY> --reason "…"`, then follow `procedures/execute-cases.md`, "A task is blocked"), or it does not hold the plan up (`cairn linear ack <id> --as noted --note "<why>"`). Do not release the blocked issue: that drops part of the PRD.
- A new sub-issue: leave it for a later plan (`cairn linear ack <id> --as later`). Pulling it in would change the PRD, which is the user's.
The pull request lists what you chose. When `cairn phase finish` still refuses because a change is not handled and you have chosen, run it again with `--call "<what you chose for each change, and why>"`.
Links removed in Linear are only noted. When it lists an issue's text as noted (the description changed after the PRD was approved), re-read `issues/<KEY>.md` in the plan folder and check the PRD against it; tell the user in a line if a requirement no longer matches. This does not block the phase.

Run `cd <plan worktree> && cairn phase finish`.

It succeeds only when every task in the phase is done, nothing is blocked or paused, the plan worktree is clean, and tests are green at the current commit. On success it marks the phase done, opens the next phase (for the last phase: moves the plan to Check without running the suite, which Check runs next), and prints one summary line with the new-suggestion count and any out-of-scope edits.

**Done when:** `cairn phase finish` exited 0.

## 2. Continue
Relay the summary line in one or two lines. When it says Linear updates are queued, dispatch the `linear-sender` agent in the background (`model: haiku`, `description` "Record · Linear updates") and carry on, unless a `linear-sender` is already running. Then run `cd <plan worktree> && cairn next --json` and follow the procedure it names (normally `procedures/execute.md` for the next phase) without stopping to ask.

## 3. When `cairn phase finish` refuses
If it refuses, do what the refusal names, and go on. Do not stop. Say in one line what it was:
- Tests are red: fix without asking (`references/autonomy.md`). Dispatch one `implementer`, `description` "Fix · <phase name>", with a prompt naming the plan worktree, the plugin root, the path after "Full output:" in the refusal (the full failing test log; implementers never run `cairn`), and a report path in `<work folder>/reports/`. Then rerun step 1. Allow two fix attempts. When it is still red after them, run `cairn phase finish --not-done "<why; what was tried; the fix you propose>"` and go on: the pull request opens as a draft that lists it.
- Changes in Linear are not handled: the refusal lists each; handle them as in step 1, then rerun with `--call` as above.
- The plan is paused: go back to `/cairn:resume`. Pausing is the user's.
- The on-track check for the phase is red: dispatch one fix implementer on what its report flags, then run the check again (`cairn evidence phase`). Allow two attempts. When it is still red, run `cairn phase finish --not-done "<why; what was tried; the fix you propose>"`.

Below Polished the on-track check is optional: run `/cairn:direction` when you want it for a phase.

**Done when:** the next procedure started.
