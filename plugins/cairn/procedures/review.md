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
For each blocking finding, add a fix slice to `plan.md` in a new final phase (own scope, concrete test that reproduces the finding). Run `cairn plan load --replan`, get approval of the changed plan from the user via AskUserQuestion, run `cairn approve plan`, then `cairn next --json` to execute it. When that phase is approved the stage returns to verify and then review; rerun this procedure's step 2 on the new diff.

The user may overrule a blocking finding: ask with AskUserQuestion (Fix / Overrule with reason). Record an overruled finding for the record's Deviations section.

**Done when:** the latest review shows no blocking findings except those the user overruled.

## 4. Show advisory findings
Report advisory findings in a few lines: count, and the top items with `path:line`. They go to the record's Follow-ups section.

**Done when:** the user has seen the advisory list.

## 5. Record and advance
Run `cairn evidence review pass --blocking 0 --note "<N advisory; overruled: M>"`, then `cairn advance`.

**Done when:** the stage is `ship`. Then run `cairn next --json` and follow the procedure it names.
