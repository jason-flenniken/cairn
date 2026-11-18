# Ship

Write the completion record, open the pull request, say so, and end the turn. The user's merge is the sign-off: there is no approval step here, and nothing in this procedure asks the user anything (`references/autonomy.md`).

Templates live in `templates/`, next to this `procedures/` folder (`${CLAUDE_PLUGIN_ROOT}/templates/record.md`). Talk to the user per `references/reporting.md`. `cairn` is on PATH; if not, run `node "${CLAUDE_PLUGIN_ROOT}/dist/cairn.mjs"`.

## At this level
Read `level` from `cairn status --json`; `references/levels.md` has the full table. 
- MVP: before dispatching the recorder in step 3, run `cd <plan worktree> && cairn test`. The record names each open failing test command (`knownFailures` in `cairn status --json`) with the hardening list. The record stays short.
- Standard: as written below.
- Polished: as written below. The captured learning is added when cairn has it.

## 1. Check
Run `cairn status --json`. The stage must be `ship`. Any other stage: say which and run `cairn next --json`. Stop this procedure.

When the plan has proofs (`cairn prove list`), review fixes may have changed the code since they ran. If the list shows any proof that is not `green`, run `cd <plan worktree> && cairn prove`, and judge any screenshots again as in `procedures/verify.md` step 3a. A red proof here goes to one fix implementer, as in the review procedure, with two attempts. One that is still red stays red: `cairn pr open` lists it under Not done and opens the pull request as a draft. Never edit or retire a proof.

**Done when:** the stage is `ship` and the verify and review evidence are recorded.

## 2. Tidy the follow-ups
A plan closes with at most 5 open recommended follow-ups from itself. Run `cairn suggest list --open --json` and look at the ones whose key starts with `<slug>:`.
- Group related ones into a high-level item (for example many missing-test notes become "add more detailed tests for the pane"): `cairn suggest merge <key> <key>... --area <a> --text "<high-level item>"`. The merged ones show as merged; the new item is the one left open.
- Duplicates: merge them too. Trivia: `cairn suggest resolve <key> --dismiss --note "<reason>"`.
- Hardening items (marked `[hardening]`) are not counted toward the 5 and are merged only with each other.
- Keep a list of what was dropped (merged away or dismissed) for the record.
Follow-ups declined twice, or older than 60 days, expire on their own and need nothing.

**Done when:** at most 5 open follow-ups remain from this plan (`cairn close` refuses otherwise and names them).

## 2a. Propose review rules
When a review keeps flagging the same thing, the fix belongs at the source: a one-line rule in the repo's `REVIEW.md` that every later review reads. Draft at most 3, and none when nothing qualifies. Sources:
- the plan log (the `log` array in `state.json`): a class in the `fixing classes:` notes of two or more tasks, or in a task's notes and again in the branch review's evidence note (`fixed classes:`), which is a finding the branch review caught that a task review should have;
- this plan's follow-ups (`cairn suggest list --json`, keys starting with `<slug>:`, whose text starts with its class): a class logged two or more times;
- follow-ups dismissed by someone other than you (not the ones you dismissed while tidying in step 2), when the same kind was raised more than once: the rule says what not to flag.

A rule is a check an agent can act on, written about the project, not about this plan's code: "A new CLI command is listed in the CLI reference in the same change", not "the pane was buggy". Skip a rule `REVIEW.md` already states.

Do not ask about them and do not edit `REVIEW.md`. Give them to the recorder in step 3, which lists each in the record's Follow-ups as `Proposed review rule: <the rule> (why: <what happened>)`, so they are in the pull request. The user adds the ones they want to `REVIEW.md` after the merge, under `## Rules learned`.

**Done when:** the drafted rules (or none) are in hand for step 3.

## 3. Draft the record
Run `cd <plan worktree> && cairn step recording && cairn suggest list --open` in one call: the step keeps the pane from offering the record while it is written, and the list gives the count by area. Dispatch one `recorder` agent (`model: sonnet`, `description` "Record · completion and changelog"). It writes files itself, so keep the brief to paths and short lists: the plan worktree (it runs `cairn status --json` itself), the open follow-up counts, the list of dropped follow-ups, the proposed review rules from step 2a, and the paths to `prd.md`, `plan.md`, `decisions.md`, the evidence notes, the plan log (the `log` array in `state.json`), and `git log <base>..<plan-branch>`. Tell it that what was not done is printed by `cairn pr body` (its Not done list), and to put it in Follow-ups. It writes `docs/cairn/plans/<date>-<slug>/RECORD.md` from the record template in at most 600 words, Findings included, and then, in the same dispatch, the changelog entry (one dispatch, not two). The entry is `docs/cairn/plans/<date>-<slug>/changelog.md`: one paragraph of at most 120 words covering what was built, why, and the big rocks (API, data model, security or dependency changes a developer must know). Check both with `wc -w`, then commit `RECORD.md` and `changelog.md` on the plan branch, so both are in the pull request. After the merge the entry belongs to the user: cairn reads it and never rewrites it.

**Done when:** `RECORD.md` exists with every template heading and is within 600 words (`wc -w`), and `changelog.md` exists, is at most 120 words, and is committed.

## 4. Open the pull request
Run `cd <plan worktree> && cairn step opening-pr && cairn pr open` in one call. The CLI pushes the plan branch and opens the pull request, or updates the one that is open. Its body (what was built, what is done, the calls made for the user, what is not done) and whether it is a draft come from what the CLI recorded. Never write the body by hand and never pass draft or ready yourself. When it refuses, do what it names and run it again.

When `cairn status --json` shows `state.linear`, append the output of `cd <plan worktree> && cairn linear closes` (one `Closes SAV-n` line per issue the plan built: not the ones released or left under Issues not taken) to the pull request body with `gh pr edit`. Linear closes those issues itself when the pull request merges, once its GitHub integration is installed; cairn's own Done at merge stays as the fallback.

Put the PR URL into the record's Links section and commit it on the plan branch. The next push carries it.

**Done when:** `cairn pr open` printed the PR URL, and `RECORD.md` links to it.

## 5. Advance and wait
Run `cd <plan worktree> && cairn advance`. On a plan with Linear issues, use `cairn advance --pr <PR URL>`, so the pull request link goes in the comment on each issue. When the output says Linear updates are queued, dispatch the `linear-sender` agent in the background and carry on, unless a `linear-sender` is already running.

Then go straight on: `cairn next --json` names `procedures/learn.md`, which closes the plan and sends the one short message. Do not end the turn here.

**Done when:** the stage is `learn` (a fix plan is `closed`).

## Merge (after the PR is open)
The plan is closed and the run is waiting on the user; what they say next decides what happens. Run `cairn status --json` first: it shows whether the pull request is still open or was merged elsewhere (in GitHub, say).

**"merge"** (or "merge it"): the reply is the sign-off.
1. Run `cd <plan worktree> && cairn merge-check`. It fetches the base, merges the base in when it moved, and runs the tests on the merged tree. It asks for no approval. On success it prints the HEAD it checked: keep that sha for step 3. On a refusal:
   - **The base conflicts with the branch:** the merge was aborted and nothing changed. (A conflict only in `docs/cairn/OVERVIEW.md` never gets here: `merge-check` regenerates that file and finishes the merge itself.) Dispatch one `implementer` (`model: sonnet`, `description` "Fix · merge conflict") on the plan worktree to merge the base in, resolve the conflicts, run the tests and commit; its prompt names the plugin root, the plan worktree and a report path in the work folder. Tell it plainly that this is not a task: it works on the plan branch in the plan worktree, and may resolve conflicts under `docs/cairn/` by keeping both sides' entries. Then run `cairn merge-check` again.
   - **Tests fail with the base merged in:** the clean merge stays. Dispatch one `implementer` (`model: sonnet`, `description` "Fix · after merging the base") on the plan worktree, giving it the repo's test command (from `.cairn/config.json`) and a report path in the work folder; it fixes, adds a test, and commits. Then run `cairn merge-check` again. After two fix attempts, say in one line why the merge is not safe, and stop. That is a report, not a question.
   - **The fetch failed:** retry once. When it fails again, say why in one line and stop.
2. Push the plan branch (`git push origin <state.branch>` from the plan worktree), so the pull request holds exactly what was checked.
3. When the pull request is a draft, mark it ready first (`gh pr ready <PR URL>`): the user's "merge" is the sign-off for what the draft lists. Then run `gh pr merge <PR URL> --merge --match-head-commit <sha>`, with the sha `cairn merge-check` printed, so GitHub merges exactly what was checked. If the repo disallows merge commits, use the method it allows (`--squash` or `--rebase`) with the same flag. If it fails (checks pending, the head moved, no access), say why in one line; when the branch moved, run step 1 again.
4. The plan is already closed, so nothing else closes. Tell the user in one line that it is merged.
5. When `cairn status --json` shows `state.linear` and the PR is merged, run `cd <plan worktree> && cairn linear pending`. It queues the Done statuses once the plan branch has landed in its base, and lists everything unsent. Dispatch the `linear-sender` agent in the background (`model: haiku`, `description` "Record · Linear updates") with the plan worktree path and the plugin root (only when no `linear-sender` is already running); it sends what is listed as `procedures/linear-sync.md` describes. Linear updates go out only through that queue: never call Linear's status tools directly, and never mark an entry sent by guessing its id or by a range; mark each one with the id `cairn linear pending` lists for it, after its send worked. When the user merges it themselves later, `cairn next` (run in the plan worktree, or `/cairn:next` on main, which points at the merged plan's worktree) queues the Done statuses and routes to the sync.

**Notes** ("send back: …", or any request to change something): this is new input, and the run goes hands-off again.
1. Dispatch one `implementer` (`model: sonnet`, `description` "Fix · send-back notes") on the plan worktree itself, committing on the plan branch. Its prompt names the plugin root, the plan worktree, the user's notes word for word, and a report path in the work folder; tell it to add a test for each change. Then run `cd <plan worktree> && cairn test`. Allow two attempts (`references/autonomy.md`); what is still red stays on the pull request as Not done.
2. When the notes change a requirement or need more than a fix, a re-plan is not possible after ship. Say so in one line and start a follow-on plan (`/cairn:new`, with `--after <slug>` when it builds on this branch). Do not edit the PRD of a closed plan.
3. Update the record's Findings, commit, run `cairn pr open` again to update the same pull request, send the same short message as `procedures/learn.md` step 5, and end the turn.

**Anything else** (a question about the pull request, "not yet", "I'll merge it myself"): answer in a line, and stop. The plan stays "PR open" until the branch lands. When the user merges it in GitHub, the next `cairn next` sees it and routes to `procedures/learn.md`.

**Done when:** the PR is merged (`gh pr view <PR URL> --json state` says `MERGED`), or the user said they will merge it, or the notes were handled and the pull request updated; and on a plan with Linear issues the merged plan's Linear updates were sent.
