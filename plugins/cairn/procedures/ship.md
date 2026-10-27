# Ship

Write the completion record, get the user's go, open the pull request.

Templates live in `templates/`, next to this `procedures/` folder (`${CLAUDE_PLUGIN_ROOT}/templates/record.md`). Talk to the user per `references/reporting.md`. `cairn` is on PATH; if not, run `node "${CLAUDE_PLUGIN_ROOT}/dist/cairn.mjs"`.

## At this level
Read `level` from `cairn status --json`; `references/levels.md` has the full table. 
- MVP: before dispatching the recorder in step 3, run `cd <plan worktree> && cairn test`. The approval question in step 4 names each open failing test command (`knownFailures` in `cairn status --json`), and the record lists them with the hardening list. The record stays short.
- Standard: as written below.
- Polished: as written below. The captured learning is added when cairn has it.

## 1. Check
Run `cairn status --json`. The stage must be `ship`. Any other stage: say which and run `cairn next --json`. Stop this procedure.

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
Run `cairn suggest list --open` and note the count by area. Dispatch the `recorder` agent (`model: sonnet`, `description` "Record · completion"). Give it: the output of `cairn status --json`, the open follow-up counts, the list of dropped follow-ups, and the paths to `prd.md`, `plan.md`, `decisions.md`, the evidence notes, any accepted findings, the plan log (the `log` array in `state.json`), and `git log <base>..<plan-branch>`. It writes `docs/cairn/plans/<date>-<slug>/RECORD.md` from the record template in at most 600 words, Findings included.

Then update the area docs. Run `cairn recall <files changed on the branch> --json`, and dispatch the `recorder` again (`model: sonnet`, `description` "Record · area docs") with that output, `git diff <base>...<plan-branch> --stat`, the plan log, and `decisions.md`. It updates Rules, How it works, and Gotchas in each area doc that covers changed code, and for uncovered code that forms a coherent area it proposes a new doc from `templates/area.md`. It never edits `## History`; cairn writes that at close. Then read `decisions.md`: promote any decision that sets a rule for the whole repo and is not yet lasting, with `cd <plan worktree> && cairn decide --promote <n> --areas <a,b>`. Commit the area docs on the plan branch, so they are in the PR the user approves. With no area docs in the repo, skip the recorder dispatch and say once that `/cairn:map` sets them up; still review `decisions.md` for decisions to promote, using `--paths "<globs>"` in place of `--areas`.

**Done when:** `RECORD.md` exists with every template heading and is within 600 words (`wc -w`), and the area docs for the changed code are updated and committed.

## 4. Show and stop
Run `cd <plan worktree> && cairn step approving`. Then show the user the record, plus one line on recommended follow-ups ("N open: 2 tests, 1 security"; `/cairn:suggestions` lists them). Run `cairn status --json`. If `state.approvals.ship` is already recorded (approved from the pane), skip the question: say it is approved and go on to the next step. Otherwise read `modActive`.
- True: ask with AskUserQuestion. The question text includes `[cairn:approve ship <slug>]`, with the plan slug from the status output:
  - Approve (Recommended): approve the record, then open the PR
  - Revise the record: ask what to change, edit, recheck the word count
  - Hold: stop here; the plan stays at ship
- False: the mod can't record a menu answer. Tell the user to run, in their own terminal, the full command `cd <planWorktree> && <plugin root>/bin/cairn approve ship --human` (fill in `planWorktree` from `cairn status --json` and the plugin root, real paths, so it runs as printed), then wait for them to say it's done.

**Done when:** the user chose Approve, or said the terminal approval ran.

## 5. Confirm
Run `cairn status --json` and check that the ship approval is recorded. If it is not, say what the menu outcome or the terminal output reported. When it names a missing section or an over-budget record, fix `RECORD.md`, recheck the word count, and return to step 4.

**Done when:** `cairn status --json` shows the ship approval.

## 6. Open the PR
Run `cd <plan worktree> && cairn step opening-pr`. Then, from the plan worktree: push the plan branch, then `gh pr create --base <base> --head <state.branch> --title "<plan title>" --body-file <file>`, where the body file is built from `RECORD.md` (the title line dropped, the Links section pointing at the PRD and plan). Put the PR URL into the record's Links section and commit it on the plan branch.

**Done when:** `gh pr create` printed a URL, and `RECORD.md` links to it.

## 7. Advance
Run `cairn advance`. Report the PR URL in one line.

**Done when:** the stage is `learn`. Then run `cairn next --json` and follow the procedure it names. The merge is the last step of the whole plan: `learn.md` (and `fix.md` for a fix) sends you back to the Merge section below once the plan is closed.

## Merge (the last step, after close)
Closing records everything first so every record lands on main with the merge; `cairn status` and the pane show "PR open" until the branch is in main. Run this once the plan is closed:
1. Push the plan branch again, so the PR carries the closing commits (findings, record, PR link).
2. Tell the user once, in one line, that the plan shows "PR open" until the PR is merged.
3. Ask with AskUserQuestion (a plain choice, not an approval):
   - Merge it now (Recommended): run `gh pr merge <PR URL> --merge`; if the repo disallows merge commits, use the method it allows (`--squash` or `--rebase`). If it fails (checks pending, conflicts, no access), say why and ask again.
   - I'll merge it: stop; the plan stays "PR open" until the user merges.

**Done when:** the PR is merged (`gh pr view <PR URL> --json state` says `MERGED`) or the user chose to merge it themselves.
