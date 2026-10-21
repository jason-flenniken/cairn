# Review

One whole-branch review before shipping. Blocking findings get fixed and re-reviewed.

v0.1 scope. A later version replaces this with a fixed set of specialist reviewers plus a ranking pass.

Templates live in `templates/`, next to this `procedures/` folder. Talk to the user per `references/reporting.md`. `cairn` is on PATH; if not, run `node "${CLAUDE_PLUGIN_ROOT}/dist/cairn.mjs"`.

## 1. Check
Run `cd <plan worktree> && cairn status --json`. The stage must be `review`. Any other stage: say which and run `cd <plan worktree> && cairn next --json`. Stop this procedure. Note the base branch and the plan branch.

**Done when:** the stage is `review` and you hold the base and plan branch names.

## 2. Review the branch
Dispatch the `branch-reviewer` agent (`model: opus`) with: the paths to `prd.md` and `plan.md`, the plan worktree path, and the diff command `git diff <base>...<plan-branch>`. It reviews correctness, security, simplicity (extra or unrequested code), performance, and test quality, and returns findings as blocking or advisory, each with `path:line` and the requirement it relates to. It starts with a simplicity pass: code the PRD does not ask for is a finding.

**Done when:** the reviewer returned a findings list (possibly empty) and a count of blocking and advisory findings.

## 3. Resolve blocking findings
For each blocking finding, add a fix task to `plan.md` in a new final phase (own scope, concrete test that reproduces the finding). Run `cd <plan worktree> && cairn plan load --replan`. Then get the user's approval of the changed plan: run `cd <plan worktree> && cairn status --json` and read `modActive`. When true, ask with AskUserQuestion, with the question text including `[cairn:approve plan <slug>]`: Approve (Recommended) / Revise. When false, tell the user to run `cairn approve plan --human` in their own terminal and wait for them to say it's done. Then run `cd <plan worktree> && cairn status --json` to confirm the approval, and `cd <plan worktree> && cairn next --json` to execute the fix. When that phase is approved the stage returns to verify and then review; rerun this procedure's step 2 on the new diff.

**Done when:** the latest review shows no blocking findings, or the remaining ones are handled in step 5.

## 4. Show advisory findings
Report advisory findings in a few lines: count, and the top items with `path:line`. They go to the record's Follow-ups section.

**Done when:** the user has seen the advisory list.

## 5. Record and advance
Count the blocking findings still open, N.
- N is 0: run `cd <plan worktree> && cairn evidence review pass --blocking 0 --note "<N advisory; overruled: M>"`, then `cd <plan worktree> && cairn advance`.
- N is more than 0: run `cd <plan worktree> && cairn evidence review fail --blocking N --note "<N blocking open; A advisory>"`, then `cd <plan worktree> && cairn advance`. The advance is refused. Ask with AskUserQuestion, once for all open blocking findings. The question text lists each finding with its `path:line`, and includes `[cairn:override <slug>]`. Options: "Fix it" or "Override". "Fix it" returns to step 3.
  - Only after the user picks "Override": run `cairn advance --override "blocking findings overruled by the user, with the reason in plain words"` on its own: no `cd`, no `&&`, because the mod refuses compound commands and resolves the plan itself. Write the reason as plain words and digits. It must hold none of ``; | & $ ` > <``, a backslash, or `# * ? ~ ( ) { } [ ]`, or the mod won't run it.
  - Then record each overruled finding for the record's Deviations section.

**Done when:** the stage is `ship`. Then run `cd <plan worktree> && cairn next --json` and follow the procedure it names.
