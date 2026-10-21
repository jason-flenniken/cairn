# Review

One whole-branch review before shipping. Blocking findings are fixed in place; everything else becomes a recommended follow-up.

Templates live in `templates/`, next to this `procedures/` folder. Talk to the user per `references/reporting.md`. `cairn` is on PATH; if not, run `node "${CLAUDE_PLUGIN_ROOT}/dist/cairn.mjs"`.

## 1. Check
Run `cd <plan worktree> && cairn status --json`. The stage must be `review`. Any other stage: say which and run `cd <plan worktree> && cairn next --json`. Stop this procedure. Note the base branch and the plan branch.

**Done when:** the stage is `review` and you hold the base and plan branch names.

## 2. Review the branch
Dispatch one `branch-reviewer` agent (`model: opus`, `description` "Review · whole branch") with the paths to `prd.md` and `plan.md`, the plan worktree path, and the diff command `git diff <base>...<plan-branch>`. It returns blocking findings (bugs, security holes, data loss, an unmet requirement) and non-blocking ones, each with `path:line`.

**Done when:** the reviewer returned its findings.

## 3. Log the non-blocking findings
For each non-blocking finding, log one line: `cairn suggest add --area <area> --from branch-review --where <path> --text "<finding>"`.

**Done when:** every non-blocking finding is logged.

## 4. Fix blocking findings in place
Skip when there are none. Otherwise dispatch one `implementer` (`model: sonnet`, `description` "Fix · whole branch") on the plan worktree itself, committing directly on the plan branch. No new task, phase, re-plan or re-approval. Brief it with the blocking findings and tell it to add a test for each fix. Then run the repo's test command in the plan worktree.

If tests fail or a finding is still open after that one attempt, ask with AskUserQuestion: Fix by hand / Accept as is (noted in the record) / Pause.

**Done when:** tests are green and no blocking finding is open, or the user chose how to proceed.

## 5. Record and advance
- Nothing blocking is open: run `cd <plan worktree> && cairn evidence review pass --blocking 0 --note "<N follow-ups logged>"`, then `cd <plan worktree> && cairn advance`.
- The user accepted blocking findings as is: run `cd <plan worktree> && cairn evidence review fail --blocking N --note "<N blocking left>"`, then `cd <plan worktree> && cairn advance`. The advance is refused. Ask with AskUserQuestion, once for all of them. The question text lists each finding with its `path:line`, and includes `[cairn:override <slug>]`. Options: "Fix it" or "Override". "Fix it" returns to step 4.
  - Only after the user picks "Override": run `cairn advance --override "blocking findings accepted by the user, with the reason in plain words"` on its own: no `cd`, no `&&`, because the mod refuses compound commands and resolves the plan itself. Write the reason as plain words and digits. It must hold none of ``; | & $ ` > <``, a backslash, or `# * ? ~ ( ) { } [ ]`, or the mod won't run it.
  - Note each accepted finding for the record.

**Done when:** the stage is `ship`. Then run `cd <plan worktree> && cairn next --json` and follow the procedure it names.
