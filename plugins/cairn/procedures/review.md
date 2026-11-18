# Review

One whole-branch review before shipping. Critical and Required findings are fixed in place; Optional, Nit and pre-existing findings become recommended follow-ups; FYI is shown once.

Templates live in `templates/`, next to this `procedures/` folder. Talk to the user per `references/reporting.md`. `cairn` is on PATH; if not, run `node "${CLAUDE_PLUGIN_ROOT}/dist/cairn.mjs"`.

## At this level
Read `level` from `cairn status --json`; `references/levels.md` has the full table. 
- MVP: in step 2 `branchReviewer` names sonnet (the `security-reviewer` runs as written). in step 3 `cairn review record` files Optional, Nit and every pre-existing finding as hardening items at this level.
- Standard: as written below.
- Polished: as written below; `branchReviewer` always names opus.
- The whole-branch security review runs at every level.

## 1. Check
Run `cd <plan worktree> && cairn status --json`. The stage must be `review`. Any other stage: say which and run `cd <plan worktree> && cairn next --json`. Stop this procedure. Note the base branch and the plan branch.

**Done when:** the stage is `review` and you hold the base and plan branch names.

## 2. Review the branch
Write the already-reported list to disk and set the step in one Bash call: `cd <plan worktree> && cairn step reviewing && mkdir -p <work folder>/briefs && cairn suggest list --json > <work folder>/briefs/already-reported.json` (`<work folder>` is `<plan worktree>/.cairn/work/<slug>/`). Then dispatch two agents in the same message, so they run in parallel: one `branch-reviewer` (`model` and `effort` from `branchReviewer` in `cairn status --json`, `description` "Review · whole branch") and one `security-reviewer` (`model: sonnet`, `description` "Review · whole branch (security)"). Each prompt is a few lines of paths and nothing else: the plugin root (`${CLAUDE_PLUGIN_ROOT}`), the paths to `prd.md` and `plan.md`, the plan worktree path, the diff command `git diff <base>...<plan-branch>`, the already-reported file (its entries whose key starts with `<slug>:` count, whatever their status), one line per finding left open on a task that was set aside during build, one line `Unreviewed tasks: <ids>` from `branchReviewer.unreviewed` when it is not empty, and the report path (`<work folder>/reports/branch-review.md`, `branch-security.md`). Add no summary of what was built and no hints. Each ends with `Verdict`, `Counts` and `Report`.

**Done when:** both reviewers returned.

## 3. Record the findings
Run `cd <plan worktree> && cairn review record branch <report path>` for each report. It logs every Optional, Nit and pre-existing finding as a follow-up itself (`--from branch-review` or `--from security-review`; at MVP as hardening items), stores the Critical and Required ones as must-fix, and prints one line: `PASS` or `FIX` with the must-fix list. A pre-existing Critical goes in the pull request: add it with `cairn suggest add --area quality --from review --text "<finding with path:line>"` if the record did not already log it. Show each FYI once in your next message.

**Done when:** both reports are recorded.

## 4. Fix Critical and Required findings in place
Skip when both recorded `PASS`. Otherwise run `cd <plan worktree> && cairn step fixing --count N` (N is the number of must-fix findings), sent in the same message as the dispatch of one `implementer` (`model: sonnet`, `description` "Fix · whole branch") on the plan worktree itself, committing directly on the plan branch. No new task, phase or re-plan. Its prompt names the plan worktree, the plugin root, the report paths to fix (only their Critical and Required findings that are not pre-existing), the report path `<work folder>/reports/branch-fix.md`, and one line: group the findings by class, fix each class everywhere on the branch, not only at the lines cited, and add a test for each fix. Then run `cd <plan worktree> && cairn step rechecking && cairn test` in one call before the re-review. The re-review runs once, limited to those findings and the fix diff, and is always a fresh reviewer agent of the kind that raised them, given only the fix diff command, the earlier must-fix findings and the earlier report's path to write again (`branch-review.md` or `branch-security.md`, never a new file). Never resume or send a message to the earlier reviewer: a resumed reviewer carries its whole earlier context into every turn. record it with `cd <plan worktree> && cairn review record branch <report path>`. Recording replaces the old must-fix findings.

Never resume an agent that ran before the findings changed (a resumed agent would carry that conversation): dispatch a fresh one from its report.

If tests fail or a Critical or Required finding is still open after that attempt, make a second one, the same way, with an implementer one tier up (`model: opus`) and the new reports and logs. Review gets two fix attempts, the same as Check. When something is still open after the second, record it and go on (step 5). Do not ask.

**Done when:** tests are green and no must-fix finding is open, or what is left is recorded in step 5.

## 5. Record and advance
Pre-existing findings never count here: they were logged in step 3. The classes come from the must-fix lines `cairn review record` printed. The note names the classes of every Critical and Required finding this review raised, so the plan log keeps them for the review rules drafted at ship.
- No Critical or Required finding is open: run `cd <plan worktree> && cairn evidence review pass --blocking 0 --note "<N follow-ups logged>; fixed classes: <class>, <class> or none" && cairn advance` (one call).
- Critical or Required findings are still open after the two attempts (N of them, which is the blocking count): run `cd <plan worktree> && cairn evidence review fail --blocking N --note "<N blocking left>"`, then run `cd <plan worktree> && cairn advance --not-done "<each finding with its path:line; what was tried; the fix you propose>"`. The pull request opens as a draft that lists them. For a finding no check covers, also run `cairn pr not-done "<finding with path:line>" --why "<why; what was tried; the fix you propose>"`. A secret or security finding still open is listed the same way, never dropped.
  - Note each one for the record's Findings.

**Done when:** the stage is `ship`. Then run `cd <plan worktree> && cairn next --json`. Follow the procedure it names.
