# Phase end

Finish the built phase and keep going. The CLI checks the phase; there is no human step.

Talk to the user per `references/reporting.md`. `cairn` is on PATH; if not, run `node "${CLAUDE_PLUGIN_ROOT}/dist/cairn.mjs"`. Run every `cairn` command from the plan worktree: `cd <plan worktree> && cairn <command>`.

**Questions that block the plan.** Before an AskUserQuestion only the user can answer (not the approval question: the step `approving` already says that one waits), run `cd <plan worktree> && cairn step asking`, so the pane of a session in another plan shows that this plan waits for the user in its session. Once it is answered, run `cd <plan worktree> && cairn step clear`; a phase end has no other step.

## At this level
Read `level` from `cairn status --json`; `references/levels.md` has the full table. 
- MVP and Standard: as written below. The on-track check is optional.
- Polished: after `cairn phase finish`, run the on-track check for the phase without being asked: follow `procedures/direction.md` and treat a red result as in step 3.

## 1. Finish the phase
When `cairn status --json` shows `state.linear`, first re-read the plan's issues from Linear: dispatch the `linear-sender` agent (`model: haiku`, `description` "Record · Linear refresh") in the foreground, so it finishes before `cairn phase finish`, with the plan worktree path, the plugin root, and the job "phase-end refresh". It fetches each issue again through the Linear MCP and runs `cairn linear import --refresh`. When it returns, its message holds what changed in Linear since the plan started: a new blocked-by link on an in-plan issue, or a sub-issue added to the epic. Decide each with the user, one at a time with AskUserQuestion, recommended first:
- A new blocker: it is a real dependency (`cairn linear depends <KEY> --on <KEY> --reason "…"`, then follow `procedures/execute-cases.md`, "A task is blocked"), or it does not hold the plan up (`cairn linear ack <id> --as noted --note "<why>"`), or the blocked issue leaves the plan (`cairn linear release <KEY> --reason "…"`).
- A new sub-issue: pull it in (`cairn linear ack <id> --as taken`, amend the PRD, re-plan) or leave it for a later plan (`cairn linear ack <id> --as later`).
Links removed in Linear are only noted. When it lists an issue's text as noted (the description changed after the PRD was approved), re-read `issues/<KEY>.md` in the plan folder and check the PRD against it; tell the user in a line if a requirement no longer matches. This does not block the phase.

Run `cd <plan worktree> && cairn phase finish`.

It succeeds only when every task in the phase is done, nothing is blocked or paused, the plan worktree is clean, and tests are green at the current commit. On success it marks the phase done, opens the next phase (or moves the plan to Check after the last one), and prints one summary line with the new-suggestion count and any out-of-scope edits.

**Done when:** `cairn phase finish` exited 0.

## 2. Continue
Relay the summary line in one or two lines. When the output holds a fresh-start line ("Context is at N%… start fresh with /clear, then /cairn:next."), relay that line as the outcome and stop. When it says Linear updates are queued, dispatch the `linear-sender` agent in the background (`model: haiku`, `description` "Record · Linear updates") and carry on, unless a `linear-sender` is already running. Then run `cd <plan worktree> && cairn next --json`; when its output holds a fresh-start line, relay it and stop. Otherwise follow the procedure it names (normally `procedures/execute.md` for the next phase) without stopping to ask.

## 3. Stop only when something is wrong
If `cairn phase finish` refuses, stop and tell the user what it names, in plain words:
- Tests are red: show the failing output tail and ask with AskUserQuestion: Fix it (Recommended; dispatch one `implementer`, `description` "Fix · <phase name>", with a prompt naming the plan worktree, the plugin root, the path after "Full output:" in the refusal (the full failing test log; implementers never run `cairn`), and a report path in `<work folder>/reports/`, then rerun step 1) / Pause.
- Changes in Linear are not handled: the refusal lists each; handle them as in step 1, then rerun.
- A task is blocked or the plan is paused: say which, and follow `procedures/execute-cases.md` ("A task is blocked") or `/cairn:resume`.
- The on-track check for the phase is red: show its report path and ask: Fix first / Pause. Never override it.

The on-track check is optional. Run `/cairn:direction` when you want it for a phase; it does not run automatically.

**Done when:** the next procedure started, or the user was told what is stopping the phase.
