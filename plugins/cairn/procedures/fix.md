# Fix

Take one bug from repro to a shipped fix on a fix-track plan: a failing repro, a fix in one task, a review of every fix, and a short record.

Templates live in `templates/`, next to this `procedures/` folder. Talk to the user per `references/reporting.md`. `cairn` is on PATH; if not, run `node "${CLAUDE_PLUGIN_ROOT}/dist/cairn.mjs"`.

**Questions that block the plan.** Before an AskUserQuestion only the user can answer (not the approval question: the step `approving` already says that one waits), run `cd <plan worktree> && cairn step asking`, so the pane of a session in another plan shows that this plan waits for the user in its session. Once it is answered, put the step back with `cairn step <the step you were on>`, or run `cairn step clear` when the stage has none (repro, execute).

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

When the arguments are a Linear issue key (`/cairn:fix SAV-123`), take the bug from the ticket and put the key in the slug (`sav-123-login-redirect-loop`). Fetch the issue through the Linear MCP (`get_issue` with `relations`, `description` and `labels` in its `fields` list, mapped as `procedures/new.md` step 2a says), then pipe it to the new plan as a single-issue import, as in `procedures/new.md` step 2a: `cd <plan worktree> && cairn linear import` with `{ "selection": "SAV-123", "issues": [{ "key": "SAV-123", "title": "…", "url": "…", "stateType": "…", "description": "…", "labels": ["…"] }] }`. The fix plan then moves the issue to In Progress and posts the pull request link like any other.

Tell the user the worktree path that `cairn new` printed, in one line. Do not switch into it with EnterWorktree. Stay at the repo root and run each later `cairn` command as `cd <plan worktree> && cairn <command>`, except an override command, which runs alone.

**Done when:** `cairn status --json` shows track `fix` at stage repro, and the user has the worktree path.

## 3. Record the repro
Write a failing test or a command that reproduces the bug, in the plan worktree. Then run `cairn repro "<command>"`. The command runs in the plan worktree with the configured timeout.
- It exits non-zero: the repro works. Go to step 4.
- It exits 0: the repro does not show the bug. Ask the user for a better repro in plain text, with what you tried and what exit 0 means here. Stop until the user gives one, then run `cairn repro` again.
- It can't start or times out: the CLI refuses and quotes the error. Fix the command or the timeout cause, and rerun.

**Done when:** `cairn repro` exited with a non-zero status and the stage is execute.

## 4. Execute the fix
Run `cairn advance`. It creates the single task `fix`, with scope `**`. Follow `procedures/execute.md` for that task, except its review: step 6 below reviews the fix once, on the finished branch. Task folders are named from the plan worktree folder: `<plan worktree folder>--fix` under `.claude/worktrees`, and with `--no-worktree` (the plan worktree is the main checkout) `<repo folder>--fix`. The task branch is always `task/<slug>/fix`, including for plans recorded under old branch names. The repro is the failing test: the implementer makes it pass and adds a test for the obvious neighbouring failure. When the fix touches auth, money, deletes, migrations, a public API, untrusted input, personal data, a new dependency, model output, or shell commands and paths built from data, treat the task as risky: test-first with unhappy and security cases.

When the implementer or the reviewer names a requirement that the bug report did not state, go to step 5 before merging.

**Done when:** `cairn task done fix` exits 0 and the stage is review.

## 5. Escalate when the fix grows
Offer `cairn escalate` through AskUserQuestion in these two cases:
- `cairn task done fix` refuses because too many files changed. The refusal names `escalate`.
- The implementer or the reviewer reports a requirement the bug report did not state.

The question names the reason and offers two options: "Escalate to a feature plan (Recommended)" and "Keep the fix narrow". On "Escalate to a feature plan", run `cairn escalate`. The plan becomes a feature plan at stage prd, and this procedure stops; the user continues with `/cairn:prd`. On "Keep the fix narrow", send the implementer back to the task with the file limit as the target.

**Done when:** the user has chosen, and either the plan is escalated or the fix task is back in the loop.

## 6. Review
Run `cd <plan worktree> && cairn step reviewing`. Every fix is reviewed, risky or not. Dispatch one `task-reviewer` agent (`model: sonnet`, `description` "Review · fix"). The prompt is a few lines of paths: the plugin root (`${CLAUDE_PLUGIN_ROOT}`), the bug title, the repro command from `state.repro` in `cairn status --json`, the path of the implementer's report (for its `Tests:` line only), the plan worktree path, the diff command `git diff <base>...<plan-branch>`, and the report path `<plan worktree>/.cairn/work/<slug>/reports/fix-review.md` (`fix-security.md` for the security reviewer).

When the fix touches auth, money, deletes, migrations, a public API, untrusted input, personal data, a new dependency, model output, or shell commands and paths built from data, also dispatch the `security-reviewer` agent in the same message, so both run in parallel (`model: sonnet`, `description` "Review · fix (security)"), with the same paths.

Each reviewer ends with `Verdict`, `Counts` and `Report`. Record each: `cd <plan worktree> && cairn review record fix <report path>`. It logs the Optional, Nit and pre-existing findings as follow-ups itself (a pre-existing finding never blocks the fix; name a pre-existing Critical to the user in one line) and prints `PASS` or `FIX` with the must-fix findings, which block the fix. Mention FYI findings once to the user.

Record the result with the existing evidence command. Pre-existing findings never count as blocking here.
- No Critical or Required findings, other than pre-existing ones: `cairn evidence review pass --blocking 0 --note "<N follow-ups logged>"`.
- Critical or Required findings that are not pre-existing, N of them: `cairn evidence review fail --blocking N --note "<N blocking; A advisory>; classes: <class>, <class>"`. Tell the user each one with its `path:line` and proposed fix. Then ask with AskUserQuestion, with these options in order:
  - "Fix in place (Recommended when small)": run `cairn task start fix`. It reopens the fix task from review: the stage returns to execute, the old review result is cleared, and the repro and the task base are kept. Go to step 4, run `cairn task brief fix --role fix`, and give the implementer that brief path; the one fix attempt is that reopened task, then run `cd <plan worktree> && cairn step rechecking` and review again here, limited to those findings and the fix diff.
  - "Escalate to a feature plan": run `cairn escalate` and stop this procedure.
  - "Hold": stop here; the plan stays at review.

Run `cairn advance` only when there were no Critical or Required findings other than pre-existing ones. It is refused until a pass with zero blocking findings is recorded.

**Done when:** `cairn status --json` shows a review pass with `--blocking 0` and the stage is ship.

## 7. Draft the record
Run `cd <plan worktree> && cairn step recording`, so the pane does not offer the record for approval while it is written. Then write `docs/cairn/plans/<date>-<slug>/RECORD.md` from `templates/record-fix.md`. Keep the five sections, in that order. Fill Links with the plan path; the PR URL goes in once step 9 opens the PR.

The record is at most 200 words. Count the words with headings and HTML comments left out. Trim until it fits.

In Cause, say where the bug came from. Take the lines the fix changed from the old side of `git diff <base>...<plan-branch>` (the lines as they stand on the base) and run `cd <plan worktree> && cairn trace <path>:<start>-<end>`. It prints the commit that brought them in, the pull request and plan it landed with, the task that built it, and that plan's record. Write one line: `Introduced by: <commit>, <plan> (task <task>, PR #<n>)`, leaving out what trace could not find. When the cause is not in changed lines (a missing check, say), trace the lines nearest it. Then open that plan's record: if its review should have caught the bug, that feeds the rule you draft at step 9.

Then write the changelog entry. Dispatch the `recorder` again (`model: sonnet`, `description` "Record · changelog entry") with `RECORD.md`, the repro, and the plan log. It writes `docs/cairn/plans/<date>-<slug>/changelog.md`: one paragraph of at most 120 words covering what was fixed, why it broke, and any big rocks (API, data model, security or dependency changes a developer must know). Check it with `wc -w`, then commit both files on the plan branch, so they are in the PR the user approves.

**Done when:** `RECORD.md` has the five sections and is at most 200 words, and `changelog.md` exists, is at most 120 words, and is committed.

## 8. Ship stop
Run `cd <plan worktree> && cairn step approving`. Show the user the record in about five lines, the changelog entry, plus the count of open recommended follow-ups when there are any. Run `cairn status --json`. If `state.approvals.ship` is already recorded (approved from the pane), skip the question: say it is approved and go on to step 9. Otherwise read `modActive`.
- True: ask with AskUserQuestion. The question text includes `[cairn:approve ship <slug>]`, with the plan slug from the status output. Options:
  - Approve (Recommended): approve the record
  - Revise the record or the entry: run `cd <plan worktree> && cairn step recording`, ask what to change, edit, recheck the word counts, and return to step 8
  - Hold: stop here; the plan stays at ship
- False: the mod can't record a menu answer. Tell the user to run, in their own terminal, the full command `cd <planWorktree> && <plugin root>/bin/cairn approve ship --human` (fill in `planWorktree` from `cairn status --json` and the plugin root, real paths, so it runs as printed), then wait for them to say it's done.

**Done when:** the ship approval is already recorded, or the user chose Approve, or said the terminal approval ran.

## 9. Confirm, open the PR, advance, merge
Run `cairn status --json` and check that the ship approval is recorded. If it is not, say what the menu or the terminal reported, and return to step 8. Then propose review rules as in step 5 of `procedures/ship.md`, with one more source: the bug itself. When a reviewer reading the change that introduced it could have caught it, draft the rule that would have. Then:
1. Run `cd <plan worktree> && cairn step opening-pr`, then open the PR from the plan worktree: push the plan branch, then `gh pr create --base <base> --head <state.branch> --title "<bug title>" --body-file <file>`, where the body file is built from `RECORD.md` (the title line dropped). Put the PR URL into the record's Links section and commit it on the plan branch.
2. Run `cairn advance`. It closes the plan (a fix track has no learn stage); `cairn status` and the pane show "Closed · PR open" until the branch is in main.
3. Merge last, so the closing commits land on main too: follow the "Merge (the last step, after close)" section of `procedures/ship.md` (run `cairn merge-check`, push the plan branch, tell the user once about "PR open", then ask "Merge it now (Recommended)" or "I'll merge it").

**Done when:** `cairn advance` exits 0, `cairn status --json` shows the plan closed, and the PR is merged or the user said they will merge it.
