# Ship

Write the completion record, get the user's go, open the pull request.

Templates live in `templates/`, next to this `procedures/` folder (`${CLAUDE_PLUGIN_ROOT}/templates/record.md`). Talk to the user per `references/reporting.md`. `cairn` is on PATH; if not, run `node "${CLAUDE_PLUGIN_ROOT}/dist/cairn.mjs"`.

## 1. Check
Run `cairn status --json`. The stage must be `ship`. Any other stage: say which and run `cairn next --json`. Stop this procedure.

**Done when:** the stage is `ship` and verify and review evidence are recorded.

## 2. Draft the record
Run `cairn suggest list --open` and note the count by area. Dispatch the `recorder` agent (`model: sonnet`, `description` "Record · completion"). Give it: the output of `cairn status --json`, the open-suggestion counts, and the paths to `prd.md`, `plan.md`, `decisions.md`, the evidence notes, any accepted findings, and `git log <base>..<plan-branch>`. It writes `docs/sdlc/plans/<slug>/RECORD.md` from the record template in at most 500 words.

**Done when:** `RECORD.md` exists with every template heading and is within 500 words (`wc -w`).

## 3. Show and stop
Show the user the record, plus one line on recommended follow-ups ("N open: 2 tests, 1 security"; `/cairn:suggestions` lists them). Run `cairn status --json` and read `modActive`.
- True: ask with AskUserQuestion. The question text includes `[cairn:approve ship <slug>]`, with the plan slug from the status output:
  - Approve (Recommended): approve the record, then open the PR
  - Revise the record: ask what to change, edit, recheck the word count
  - Hold: stop here; the plan stays at ship
- False: the mod can't record a menu answer. Tell the user to run, in their own terminal, the full command `cd <planWorktree> && <plugin root>/bin/cairn approve ship --human` (fill in `planWorktree` from `cairn status --json` and the plugin root, real paths, so it runs as printed), then wait for them to say it's done.

**Done when:** the user chose Approve, or said the terminal approval ran.

## 4. Confirm
Run `cairn status --json` and check that the ship approval is recorded. If it is not, say what the menu outcome or the terminal output reported. When it names a missing section or an over-budget record, fix `RECORD.md`, recheck the word count, and return to step 3.

**Done when:** `cairn status --json` shows the ship approval.

## 5. Open the PR
From the plan worktree: push the plan branch, then `gh pr create --base <base> --head <state.branch> --title "<plan title>" --body-file <file>`, where the body file is built from `RECORD.md` (the title line dropped, the Links section pointing at the PRD and plan). Put the PR URL into the record's Links section and commit it on the plan branch.

**Done when:** `gh pr create` printed a URL, and `RECORD.md` links to it.

## 6. Advance
Run `cairn advance`. Report the PR URL in one line.

**Done when:** the stage is `learn`. Then run `cairn next --json` and follow the procedure it names.
