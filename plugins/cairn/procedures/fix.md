# Fix

Take one bug from repro to a shipped fix on a fix-track plan: a failing repro, a fix in one task, a review only when the fix is risky, and a short record.

Templates live in `templates/`, next to this `procedures/` folder. Talk to the user per `references/reporting.md`. `cairn` is on PATH; if not, run `node "${CLAUDE_PLUGIN_ROOT}/dist/cairn.mjs"`.

The repro command is shown to the user in their normal permission prompt, and the user decides on it there. Never ask the user to approve it ahead of time.

## 1. Check the stage
Run `cairn status --json`. Read the stage, the plan slug, and the track.
- No plan yet, or the status reports no plan: go to step 2.
- Track `fix` at stage `repro`: go to step 3.
- Track `fix` at stage `execute`: go to step 4.
- Track `fix` at stage `review`: go to step 6.
- Track `fix` at stage `ship`: go to step 7.
- Any other stage or track: say which and run `cairn next --json`. Stop this procedure.

**Done when:** you know the plan slug, the track, and the stage, and you have routed to the matching step.

## 2. Create the plan
Pick a slug: lowercase words joined by hyphens, from the bug (for example `login-redirect-loop`). Run `cairn new <slug> --track fix --title "<bug>"`. It starts the plan at stage repro on its own branch and worktree.

Tell the user the worktree path that `cairn new` printed, in one line. Do not switch into it with EnterWorktree. Stay at the repo root and run each later `cairn` command as `cd <plan worktree> && cairn <command>`, except an override command, which runs alone.

**Done when:** `cairn status --json` shows track `fix` at stage repro, and the user has the worktree path.

## 3. Record the repro
Write a failing test or a command that reproduces the bug, in the plan worktree. Then run `cairn repro "<command>"`. The command runs in the plan worktree with the configured timeout.
- It exits non-zero: the repro works. Go to step 4.
- It exits 0: the repro does not show the bug. Ask the user for a better repro in plain text, with what you tried and what exit 0 means here. Stop until the user gives one, then run `cairn repro` again.
- It can't start or times out: the CLI refuses and quotes the error. Fix the command or the timeout cause, and rerun.

**Done when:** `cairn repro` exited with a non-zero status and the stage is execute.

## 4. Execute the fix
Run `cairn advance`. It creates the single task `fix`, with scope `**`. Follow `procedures/execute.md` for that task. The repro is the failing test: the implementer makes it pass and adds a test for the obvious neighbouring failure. When the fix touches auth, money, deleting data, a migration, or a public API, treat the task as risky: test-first with unhappy and security cases.

When the implementer or the reviewer names a requirement that the bug report did not state, go to step 5 before merging.

**Done when:** `cairn task done fix` exits 0 and the stage is review.

## 5. Escalate when the fix grows
Offer `cairn escalate` through AskUserQuestion in these two cases:
- `cairn task done fix` refuses because too many files changed. The refusal names `escalate`.
- The implementer or the reviewer reports a requirement the bug report did not state.

The question names the reason and offers two options: "Escalate to a feature plan (Recommended)" and "Keep the fix narrow". On "Escalate to a feature plan", run `cairn escalate`. The plan becomes a feature plan at stage prd, and this procedure stops; the user continues with `/cairn:prd`. On "Keep the fix narrow", send the implementer back to the task with the file limit as the target.

**Done when:** the user has chosen, and either the plan is escalated or the fix task is back in the loop.

## 6. Review
Decide whether the fix is risky (auth, money, deleting data, migrations, public API). If it is not, run the repo's tests and record `cairn evidence review pass --blocking 0 --note "not risky: no review"`, then run `cairn advance`; skip to step 7.

If it is risky, dispatch one `branch-reviewer` agent (`model: sonnet`, `description` "Review · fix"). Give it only the bug title, the repro command from `state.repro` in `cairn status --json`, the plan worktree path, and the diff command `git diff <base>...<plan-branch>`. It returns blocking and non-blocking findings, each with `path:line`. Log each non-blocking one with `cd <plan worktree> && cairn suggest add --area <area> --from branch-review --where <path> --text "<finding>"`.

Record the result with the existing evidence command:
- No blocking findings: `cairn evidence review pass --blocking 0 --note "<N follow-ups logged>"`.
- Blocking findings, N of them: `cairn evidence review fail --blocking N --note "<N blocking; A advisory>"`. Tell the user the blocking findings, each with its `path:line`. Then ask with AskUserQuestion, with these options in order:
  - "Fix in place (Recommended when small)": run `cairn task start fix`. It reopens the fix task from review: the stage returns to execute, the old review result is cleared, and the repro and the task base are kept. Go to step 4 and give the implementer the blocking findings.
  - "Escalate to a feature plan": run `cairn escalate` and stop this procedure.
  - "Hold": stop here; the plan stays at review.

Run `cairn advance` only when there were no blocking findings. It is refused until a pass with zero blocking findings is recorded. 

**Done when:** `cairn status --json` shows a review pass with `--blocking 0` and the stage is ship.

## 7. Draft the record
Write `docs/sdlc/plans/<date>-<slug>/RECORD.md` from `templates/record-fix.md`. Keep the five sections, in that order. Fill Links with the plan path and the PR URL once it exists.

The record is at most 200 words. Count the words with headings and HTML comments left out. Trim until it fits.

**Done when:** `RECORD.md` has the five sections and is at most 200 words.

## 8. Ship stop
Show the user the record in about five lines, plus the count of open recommended follow-ups when there are any. Run `cairn status --json` and read `modActive`.
- True: ask with AskUserQuestion. The question text includes `[cairn:approve ship <slug>]`, with the plan slug from the status output. Options:
  - Approve (Recommended): approve the record
  - Revise the record: ask what to change, edit, recheck the word count, and show it again
  - Hold: stop here; the plan stays at ship
- False: the mod can't record a menu answer. Tell the user to run, in their own terminal, the full command `cd <planWorktree> && <plugin root>/bin/cairn approve ship --human` (fill in `planWorktree` from `cairn status --json` and the plugin root, real paths, so it runs as printed), then wait for them to say it's done.

**Done when:** the user chose Approve, or said the terminal approval ran.

## 9. Confirm and advance
Run `cairn status --json` and check that the ship approval is recorded. If it is not, say what the menu or the terminal reported, and return to step 8. Then run `cairn advance`. It closes the plan; a fix track has no learn stage.

**Done when:** `cairn advance` exits 0 and `cairn status --json` shows the plan closed.
