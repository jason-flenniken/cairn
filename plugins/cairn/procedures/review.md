# Review

One whole-branch review before shipping. Critical and Required findings are fixed in place; Optional and Nit become recommended follow-ups; FYI is shown once.

Templates live in `templates/`, next to this `procedures/` folder. Talk to the user per `references/reporting.md`. `cairn` is on PATH; if not, run `node "${CLAUDE_PLUGIN_ROOT}/dist/cairn.mjs"`.

## At this level
Read `level` from `cairn status --json`; `references/levels.md` has the full table. 
- MVP: in step 2 dispatch the `branch-reviewer` with `model: sonnet` instead of opus (the `security-reviewer` runs as written). In step 3 file Optional and Nit findings as hardening items: `cairn suggest add --kind hardening --area <area> --from branch-review --where <path> --text "<finding>"`.
- Standard: as written below.
- Polished: as written below. The simplify pass and focused reviewers are added when cairn has them.
- The whole-branch security review runs at every level.

## 1. Check
Run `cd <plan worktree> && cairn status --json`. The stage must be `review`. Any other stage: say which and run `cd <plan worktree> && cairn next --json`. Stop this procedure. Note the base branch and the plan branch.

**Done when:** the stage is `review` and you hold the base and plan branch names.

## 2. Review the branch
Run `cd <plan worktree> && cairn step reviewing`. Then dispatch two agents in the same message, so they run in parallel: one `branch-reviewer` (`model: opus`, `description` "Review · whole branch") and one `security-reviewer` (`model: sonnet`, `description` "Review · whole branch (security)"). Give both the plugin root path (`${CLAUDE_PLUGIN_ROOT}`), the paths to `prd.md` and `plan.md`, the plan worktree path, and the diff command `git diff <base>...<plan-branch>`. Give the branch reviewer also the output of `cairn recall <files changed on the branch>`. Each returns `Verdict: PASS | FIX` and findings labelled Critical, Required, Optional, Nit or FYI, each with `path:line` and a proposed fix.

**Done when:** both reviewers returned their findings.

## 3. Log the lesser findings
For each Optional or Nit finding, log one line: `cairn suggest add --area <area> --from branch-review --where <path> --text "<finding>"` (`--from security-review` for the security reviewer's). Show each FYI once in your next message and do not log it.

**Done when:** every Optional and Nit finding is logged.

## 4. Fix Critical and Required findings in place
Skip when there are none. Otherwise run `cd <plan worktree> && cairn step fixing --count N` (N is the number of Critical and Required findings), then dispatch one `implementer` (`model: sonnet`, `description` "Fix · whole branch") on the plan worktree itself, committing directly on the plan branch. No new task, phase, re-plan or re-approval. Brief it with those findings and their proposed fixes and tell it to add a test for each fix. Then run the repo's test command in the plan worktree, and run `cd <plan worktree> && cairn step rechecking` before the re-review, which the reviewer that raised them does once, limited to those findings and the fix diff.

If tests fail or a Critical or Required finding is still open after that one attempt, ask with AskUserQuestion: Fix by hand / Accept as is (noted in the record) / Pause.

**Done when:** tests are green and no Critical or Required finding is open, or the user chose how to proceed.

## 5. Record and advance
- No Critical or Required finding is open: run `cd <plan worktree> && cairn evidence review pass --blocking 0 --note "<N follow-ups logged>"`, then `cd <plan worktree> && cairn advance`.
- The user accepted open Critical or Required findings as is (N of them, which is the blocking count): run `cd <plan worktree> && cairn evidence review fail --blocking N --note "<N blocking left>"`, then `cd <plan worktree> && cairn advance`. The advance is refused. Ask with AskUserQuestion, once for all of them. The question text lists each finding with its `path:line`, and includes `[cairn:override <slug>]`. Options: "Fix it" or "Override". "Fix it" returns to step 4.
  - Only after the user picks "Override": run `cairn advance --override "blocking findings accepted by the user, with the reason in plain words"` on its own: no `cd`, no `&&`, because the mod refuses compound commands and resolves the plan itself. Write the reason as plain words and digits. It must hold none of ``; | & $ ` > <``, a backslash, or `# * ? ~ ( ) { } [ ]`, or the mod won't run it.
  - Note each accepted finding for the record.

**Done when:** the stage is `ship`. Then run `cd <plan worktree> && cairn next --json` and follow the procedure it names.
