# Ship

Write the completion record, get the user's go, open the pull request.

Templates live in `templates/`, next to this `procedures/` folder (`${CLAUDE_PLUGIN_ROOT}/templates/record.md`). Talk to the user per `references/reporting.md`. `cairn` is on PATH; if not, run `node "${CLAUDE_PLUGIN_ROOT}/dist/cairn.mjs"`.

## At this level
Read `level` from `cairn status --json`; `references/levels.md` has the full table. 
- MVP: before dispatching the recorder in step 3, run `cd <plan worktree> && cairn test`. The approval question in step 4 names each open failing test command (`knownFailures` in `cairn status --json`), and the record lists them with the hardening list. The record stays short.
- Standard: as written below.
- Polished: as written below. The captured learning is added when cairn has it.

## 1. Check
Run `cairn status --json`. When `state.reapprove` is set (the plan can be at learn or closed), code changed after the ship approval: go to the Merge section, step 1, the "Code changed after the approval" case. Otherwise the stage must be `ship`. Any other stage: say which and run `cairn next --json`. Stop this procedure.

**Done when:** the stage is `ship` and verify and review evidence are recorded.

## 2. Tidy the follow-ups
A plan closes with at most 5 open recommended follow-ups from itself. Run `cairn suggest list --open --json` and look at the ones whose key starts with `<slug>:`.
- Group related ones into a high-level item (for example many missing-test notes become "add more detailed tests for the pane"): `cairn suggest merge <key> <key>... --area <a> --text "<high-level item>"`. The merged ones show as merged; the new item is the one left open.
- Duplicates: merge them too. Trivia: `cairn suggest resolve <key> --dismiss --note "<reason>"`.
- Hardening items (marked `[hardening]`) are not counted toward the 5 and are merged only with each other.
- Keep a list of what was dropped (merged away or dismissed) for the record.
Follow-ups declined twice, or older than 60 days, expire on their own and need nothing.

**Done when:** at most 5 open follow-ups remain from this plan (`cairn close` refuses otherwise and names them).

## 3. Draft the record
Run `cd <plan worktree> && cairn step recording`, so the pane does not offer the record for approval while it is written. Then run `cairn suggest list --open` and note the count by area. Dispatch the `recorder` agent (`model: sonnet`, `description` "Record · completion"). Give it: the output of `cairn status --json`, the open follow-up counts, the list of dropped follow-ups, and the paths to `prd.md`, `plan.md`, `decisions.md`, the evidence notes, any accepted findings, the plan log (the `log` array in `state.json`), and `git log <base>..<plan-branch>`. It writes `docs/cairn/plans/<date>-<slug>/RECORD.md` from the record template in at most 600 words, Findings included.

Then write the changelog entry. Dispatch the `recorder` again (`model: sonnet`, `description` "Record · changelog entry") with the finished `RECORD.md`, `prd.md`, and the plan log. It writes `docs/cairn/plans/<date>-<slug>/changelog.md`: one paragraph of at most 120 words covering what was built, why, and the big rocks (API, data model, security or dependency changes a developer must know). Check it with `wc -w`, then commit `RECORD.md` and `changelog.md` on the plan branch, so both are in the PR the user approves. After approval the entry belongs to the user: cairn reads it and never rewrites it.

**Done when:** `RECORD.md` exists with every template heading and is within 600 words (`wc -w`), and `changelog.md` exists, is at most 120 words, and is committed.

## 4. Show and stop
Run `cd <plan worktree> && cairn step approving`. Then show the user the record and the changelog entry, plus one line on recommended follow-ups ("N open: 2 tests, 1 security"; `/cairn:suggestions` lists them). Run `cairn status --json`. If `state.approvals.ship` is already recorded (approved from the pane), skip the question: say it is approved and go on to the next step. Otherwise read `modActive`.
- True: ask with AskUserQuestion. The question text includes `[cairn:approve ship <slug>]`, with the plan slug from the status output:
  - Approve (Recommended): approve the record, then open the PR
  - Revise the record or the entry: run `cd <plan worktree> && cairn step recording`, ask what to change, edit, recheck the word counts, and return to step 4
  - Hold: stop here; the plan stays at ship
- False: the mod can't record a menu answer. Tell the user to run, in their own terminal, the full command `cd <planWorktree> && <plugin root>/bin/cairn approve ship --human` (fill in `planWorktree` from `cairn status --json` and the plugin root, real paths, so it runs as printed), then wait for them to say it's done.

**Done when:** the user chose Approve, or said the terminal approval ran.

## 5. Confirm
Run `cairn status --json` and check that the ship approval is recorded. If it is not, say what the menu outcome or the terminal output reported. When it names a missing section or an over-budget record, fix `RECORD.md`, recheck the word count, and return to step 4.

Then propose review rules. When a review keeps flagging the same thing, the fix belongs at the source: a one-line rule in the repo's `REVIEW.md` that every later review reads. Draft them now, from what the plan kept, so a pause or a Hold loses nothing. Draft at most 3, and none when nothing qualifies. Sources:
- the plan log (the `log` array in `state.json`): a class in the `fixing classes:` notes of two or more tasks, or in a task's notes and again in the branch review's evidence note (`fixed classes:`), which is a finding the branch review caught that a task review should have;
- this plan's follow-ups (`cairn suggest list --json`, keys starting with `<slug>:`, whose text starts with its class): a class logged two or more times;
- follow-ups the user dismissed (not the ones you dismissed while tidying in step 2), when the same kind was raised more than once: the rule says what not to flag.

A rule is a check an agent can act on, written about the project, not about this plan's code: "A new CLI command is listed in the CLI reference in the same change", not "the pane was buggy". Skip a rule `REVIEW.md` already states.

When you drafted any, ask with AskUserQuestion as its own question (a plain choice, not an approval, and never inside the approval question), `multiSelect: true`, one option per rule, with its one-line why as the description: "Add these rules to REVIEW.md? Later reviews will check them." Add only the ones the user ticks, under `## Rules learned` in `REVIEW.md` at the repo root, as `- **YYYY-MM-DD · <area>** — <rule>. *Why:* <what happened>.` With no `REVIEW.md` yet, create it from `${CLAUDE_PLUGIN_ROOT}/templates/review.md` first and tell the user once that its other sections are theirs to fill in. Commit the change on the plan branch, so it is in the PR. Nothing ticked: add nothing.

**Done when:** `cairn status --json` shows the ship approval, and any rules the user ticked are committed.

## 6. Open the PR
Run `cd <plan worktree> && cairn step opening-pr`. Then, from the plan worktree: push the plan branch, then `gh pr create --base <base> --head <state.branch> --title "<plan title>" --body-file <file>`, where the body file is built from `RECORD.md` (the title line dropped, the Links section pointing at the PRD and plan, and keeping its Revert line). Put the PR URL into the record's Links section and commit it on the plan branch.

**Done when:** `gh pr create` printed a URL, and `RECORD.md` links to it.

## 7. Advance
Run `cairn advance`. Report the PR URL in one line.

**Done when:** the stage is `learn`. Then run `cairn next --json` and follow the procedure it names. The merge is the last step of the whole plan: `learn.md` (and `fix.md` for a fix) sends you back to the Merge section below once the plan is closed.

## Merge (the last step, after close)
Closing records everything first so every record lands on main with the merge; `cairn status` and the pane show "PR open" until the branch is in main. Run this once the plan is closed:
1. Run `cd <plan worktree> && cairn merge-check`. It fetches the base, refuses when code changed after the ship approval, merges the base in when it moved (a clean merge it makes needs no new approval), and runs the tests on the merged tree. On success it prints the HEAD it checked: keep that sha for step 4. On a refusal:
   - **Code changed after the approval** (a commit, or a merge resolved by hand): the approval is cleared and the plan waits on it, even though it is closed. Tell the user in one line what changed. Then ask for the approval again. When `modActive` is true, ask with AskUserQuestion; the question text holds the reason from the refusal and `[cairn:approve ship <slug>]`, with options Approve (Recommended) and Hold (stop here; the plan waits for the approval). Otherwise tell the user to run, in their own terminal, the full command `cd <planWorktree> && <plugin root>/bin/cairn approve ship --human` (real paths, so it runs as printed), and wait for them to say it's done. Then run `cairn merge-check` again.
   - **The base conflicts with the branch:** the merge was aborted and nothing changed. (A conflict only in `docs/cairn/OVERVIEW.md` never gets here: `merge-check` regenerates that file and finishes the merge itself.) Dispatch one `implementer` (`model: sonnet`, `description` "Fix · merge conflict") on the plan worktree to merge the base in, resolve the conflicts, run the tests and commit. Tell it plainly that this is not a task: it works on the plan branch in the plan worktree, and may resolve conflicts under `docs/cairn/` by keeping both sides' entries. Then run `cairn merge-check` again; it asks for the approval again, since a resolved merge is new code.
   - **Tests fail with the base merged in:** the clean merge stays. Dispatch one `implementer` (`model: sonnet`, `description` "Fix · after merging the base") on the plan worktree with the failing output; it fixes, adds a test, and commits. Then run `cairn merge-check` again; the fix is new code, so it asks for the approval again.
   - **The fetch failed:** say why in one line and ask with AskUserQuestion: Retry / Pause.
2. Push the plan branch, so the PR carries the closing commits (findings, record, PR link) and any merge from the base.
3. Tell the user once, in one line, that the plan shows "PR open" until the PR is merged.
4. Ask with AskUserQuestion (a plain choice, not an approval):
   - Merge it now (Recommended): run `gh pr merge <PR URL> --merge --match-head-commit <sha>`, with the sha `cairn merge-check` printed, so GitHub merges exactly what was checked. If the repo disallows merge commits, use the method it allows (`--squash` or `--rebase`) with the same flag. If it fails (checks pending, the head moved, no access), say why; when the branch moved, run step 1 again before asking again.
   - I'll merge it: stop; the plan stays "PR open" until the user merges. The pushed branch is the one that was checked.

**Done when:** the PR is merged (`gh pr view <PR URL> --json state` says `MERGED`) or the user chose to merge it themselves.
