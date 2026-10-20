# Ship

Write the completion record, get the user's go, open the pull request.

Templates live in `templates/`, next to this `procedures/` folder (`${CLAUDE_PLUGIN_ROOT}/templates/record.md`). Talk to the user per `references/reporting.md`. `cairn` is on PATH; if not, run `node "${CLAUDE_PLUGIN_ROOT}/dist/cairn.mjs"`.

## 1. Check
Run `cairn status --json`. The stage must be `ship`. Any other stage: say which and run `cairn next --json`. Stop this procedure.

**Done when:** the stage is `ship` and verify and review evidence are recorded.

## 2. Draft the record
Dispatch the `recorder` agent (`model: sonnet`). Give it: the output of `cairn status --json`, and the paths to `prd.md`, `plan.md`, `decisions.md`, the evidence notes, accepted drift, overruled findings, advisory findings, and `git log <base>..<plan-branch>`. It writes `docs/sdlc/plans/<slug>/RECORD.md` from the record template in at most 900 words.

**Done when:** `RECORD.md` exists with every template heading and is within 900 words (`wc -w`).

## 3. Show and stop
Show the user the record. Then ask with AskUserQuestion:
- Ship: open the PR (Recommended)
- Revise the record: ask what to change, edit, recheck the word count
- Hold: stop here; the plan stays at ship

**Done when:** the user chose Ship.

## 4. Approve
Run `cairn approve ship`. On refusal (a missing section or over budget), fix `RECORD.md` and rerun.

**Done when:** `cairn approve ship` exits 0.

## 5. Open the PR
From the plan worktree: push the plan branch, then `gh pr create --base <base> --head sdlc/<slug> --title "<plan title>" --body-file <file>`, where the body file is built from `RECORD.md` (the title line dropped, the Links section pointing at the PRD and plan). Put the PR URL into the record's Links section and commit it on the plan branch.

**Done when:** `gh pr create` printed a URL, and `RECORD.md` links to it.

## 6. Advance
Run `cairn advance`. Report the PR URL in one line.

**Done when:** the stage is `learn`. Then run `cairn next --json` and follow the procedure it names.
