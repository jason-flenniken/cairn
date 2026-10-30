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
Run `cd <plan worktree> && cairn step recording`, so the pane does not offer the record for approval while it is written. Then run `cairn suggest list --open` and note the count by area. Dispatch the `recorder` agent (`model: sonnet`, `description` "Record · completion"). Give it: the output of `cairn status --json`, the open follow-up counts, the list of dropped follow-ups, and the paths to `prd.md`, `plan.md`, `decisions.md`, the evidence notes, any accepted findings, the plan log (the `log` array in `state.json`), and `git log <base>..<plan-branch>`. It writes `docs/cairn/plans/<date>-<slug>/RECORD.md` from the record template in at most 600 words, Findings included.

Then write the changelog entry. Dispatch the `recorder` again (`model: sonnet`, `description` "Record · changelog entry") with the finished `RECORD.md`, `prd.md`, and the plan log. It writes `docs/cairn/plans/<date>-<slug>/changelog.md`: one paragraph of at most 120 words covering what was built, why, and the big rocks (API, data model, security or dependency changes a developer must know). Check it with `wc -w`, then commit `RECORD.md` and `changelog.md` on the plan branch, so both are in the PR the user approves. After approval the entry belongs to the user: cairn reads it and never rewrites it.

**Done when:** `RECORD.md` exists with every template heading and is within 600 words (`wc -w`), and `changelog.md` exists, is at most 120 words, and is committed.

## 3b. Propose review rules
When a review keeps flagging the same thing, fix it at the source: a one-line rule in the repo's `REVIEW.md` that every later review reads. Draft at most 3 rules, and none when nothing qualifies. Sources:
- a class of finding that came up in two or more tasks, or in a task review and again in the branch review (this plan's follow-ups start with their class; the record's Findings lists repeated findings);
- a Critical or Required finding the branch review caught that a task review should have;
- follow-ups dismissed as noise, when the same kind was raised more than once: the rule says what not to flag.

A rule is a check an agent can act on, written about the project, not about this plan's code: "A new CLI command is listed in the CLI reference in the same change", not "the pane was buggy". Skip a rule `REVIEW.md` already states. Hold the drafts for step 5; they are not part of the record.

**Done when:** you hold 0 to 3 drafted rules, each with a one-line why.

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

Then, when step 3b drafted rules, ask with AskUserQuestion as its own question (a plain choice, not an approval, and never inside the approval question), `multiSelect: true`, one option per rule, with the why as its description: "Add these rules to REVIEW.md? Later reviews will check them." Add only the ones the user ticks, under `## Rules learned` in `REVIEW.md` at the repo root, as `- **YYYY-MM-DD · <area>** — <rule>. *Why:* <what happened>.` With no `REVIEW.md` yet, create it from `${CLAUDE_PLUGIN_ROOT}/templates/review.md` first and tell the user once that its other sections are theirs to fill in. Commit the change on the plan branch, so it is in the PR. Nothing ticked: add nothing.

**Done when:** `cairn status --json` shows the ship approval, and any rules the user ticked are committed.

## 6. Open the PR
Run `cd <plan worktree> && cairn step opening-pr`. Then, from the plan worktree: push the plan branch, then `gh pr create --base <base> --head <state.branch> --title "<plan title>" --body-file <file>`, where the body file is built from `RECORD.md` (the title line dropped, the Links section pointing at the PRD and plan, and keeping its Revert line). Put the PR URL into the record's Links section and commit it on the plan branch.

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
