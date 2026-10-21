# Phase end

Finish the built phase and keep going. The CLI checks the phase; there is no human step.

Talk to the user per `references/reporting.md`. `cairn` is on PATH; if not, run `node "${CLAUDE_PLUGIN_ROOT}/dist/cairn.mjs"`. Run every `cairn` command from the plan worktree: `cd <plan worktree> && cairn <command>`.

## 1. Finish the phase
Run `cd <plan worktree> && cairn phase finish`.

It succeeds only when every task in the phase is done, nothing is blocked or paused, the plan worktree is clean, and tests are green at the current commit. On success it marks the phase done, opens the next phase (or moves the plan to Check after the last one), and prints one summary line with the new-suggestion count and any out-of-scope edits.

**Done when:** `cairn phase finish` exited 0.

## 2. Continue
Relay the summary line in one or two lines. Then run `cd <plan worktree> && cairn next --json` and follow the procedure it names (normally `procedures/execute.md` for the next phase) without stopping to ask.

## 3. Stop only when something is wrong
If `cairn phase finish` refuses, stop and tell the user what it names, in plain words:
- Tests are red: show the failing output tail and ask with AskUserQuestion: Fix it (Recommended; dispatch one `implementer`, `description` "Fix · <phase name>", on the failing tests, then rerun step 1) / Pause.
- A task is blocked or the plan is paused: say which, and follow `procedures/execute.md` step 8 or `/cairn:resume`.
- The on-track check for the phase is red: show its report path and ask: Fix first / Pause. Never override it.

The on-track check is optional. Run `/cairn:direction` when you want it for a phase; it does not run automatically.

**Done when:** the next procedure started, or the user was told what is stopping the phase.
