# Review

One whole-branch review before shipping. Blocking findings get fixed and re-reviewed.

v0.1 scope. A later version replaces this with a fixed set of specialist reviewers plus a ranking pass.

Templates live in `templates/`, next to this `procedures/` folder. Talk to the user per `references/reporting.md`. `cairn` is on PATH; if not, run `node "${CLAUDE_PLUGIN_ROOT}/dist/cairn.mjs"`.

## 1. Check
Run `cairn status --json`. The stage must be `review`. Any other stage: say which and run `cairn next --json`. Stop this procedure. Note the base branch and the plan branch.

**Done when:** the stage is `review` and you hold the base and plan branch names.

## 2. Review the branch
Dispatch the `branch-reviewer` agent (`model: opus`) with: the paths to `prd.md` and `plan.md`, the plan worktree path, and the diff command `git diff <base>...<plan-branch>`. It reviews correctness, security, simplicity (extra or unrequested code), performance, and test quality, and returns findings as blocking or advisory, each with `path:line` and the requirement it relates to. It starts with a simplicity pass: code the PRD does not ask for is a finding.

**Done when:** the reviewer returned a findings list (possibly empty) and a count of blocking and advisory findings.

## 3. Resolve blocking findings
For each blocking finding, add a fix slice to `plan.md` in a new final phase (own scope, concrete test that reproduces the finding). Run `cairn plan load --replan`. Then get the user's approval of the changed plan: run `cairn status --json` and read `modActive`. When true, ask with AskUserQuestion, with the question text including `[cairn:approve plan <slug>]`: Approve (Recommended) / Revise. When false, tell the user to run `cairn approve plan --human` in their own terminal and wait for them to say it's done. Then run `cairn status --json` to confirm the approval, and `cairn next --json` to execute the fix. When that phase is approved the stage returns to verify and then review; rerun this procedure's step 2 on the new diff.

**Done when:** the latest review shows no blocking findings, or the remaining ones are handled in step 5.

## 4. Show advisory findings
Report advisory findings in a few lines: count, and the top items with `path:line`. They go to the record's Follow-ups section.

**Done when:** the user has seen the advisory list.

## 5. Record and advance
Run `cairn evidence review pass --blocking <N> --note "<N advisory; overruled: M>"`, where N is the count of blocking findings still open. Then run `cairn advance`.

If the advance is refused because blocking findings remain, ask with AskUserQuestion, once for all open blocking findings. The question text lists each finding with its `path:line`, and includes `[cairn:override <slug>]`. Options: Fix it / Override. Fix it: return to step 3. Only after the user picks Override, run `cairn advance --override "<the findings and the user's reason>"`, and record each overruled finding for the record's Deviations section.

**Done when:** the stage is `ship`. Then run `cairn next --json` and follow the procedure it names.
