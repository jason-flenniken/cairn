# Resume

Pick a paused plan back up and continue from its recorded sub-steps.

Talk to the user per `references/reporting.md`. `cairn` is on PATH; if not, run `node "${CLAUDE_PLUGIN_ROOT}/dist/cairn.mjs"`.

## 1. Check
Run `cairn status --json`.
- On a plan branch: that plan is the target.
- On any other branch: run `cairn status --all`. When one plan is paused, take it; when several are, ask with AskUserQuestion which one (the most recently paused first, marked Recommended). Tell the user to `cd <worktree> && claude`, then `/cairn:resume`, and stop; or use EnterWorktree with the path when available and continue.

**Done when:** the session is in the target plan's worktree.

## 2. Resume
A pause under `resumeFreshAfterMinutes` (`.cairn/config.json`, default 60) resumes in this session. After a longer pause, or when the pause time is missing, tell the user the context is stale: suggest `/clear`, then `/cairn:resume`, with how long ago it was paused, and ask with AskUserQuestion: Resume here anyway / Not now. Continue only on "Resume here anyway", or in the fresh session.

Run `cairn resume`. It clears the pause and prints a recap: status, the handoff, and the next procedure.

**Done when:** the command exits 0 and you have read the recap and `docs/cairn/plans/<date>-<slug>/handoff.md`.

## 3. Previously
Tell the user in 3 lines: where the plan was (stage and phase), what was in flight, and what happens next. Surface open questions from the handoff and ask them with AskUserQuestion (recommended first) before continuing.

**Done when:** the user has the summary and the handoff's open questions are answered. Append any question still open to `handoff.md` under `## Open questions` rather than dropping it.

## 4. Continue
Run `cairn next --json` and follow the procedure it names, starting at the sub-step the handoff's Next action gives. In execute, in-progress tasks continue from their recorded sub-step.

**Done when:** the named procedure is running.
