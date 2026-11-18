# Learn

Right after the pull request opens, finish the record, close the plan, and push the closing commits to the same pull request, so the record rides it. The user's merge is the sign-off. Learn asks the user nothing.

Templates live in `templates/`, next to this `procedures/` folder. Talk to the user per `references/reporting.md`. `cairn` is on PATH; if not, run `node "${CLAUDE_PLUGIN_ROOT}/dist/cairn.mjs"`.

## At this level
Read `level` from `cairn status --json`; `references/levels.md` has the full table. 
- MVP: no extra learn work. The record is already short: do steps 4 and 5, and steps 2 and 3 only if `cairn close` refuses.
- Standard and Polished: as written below.
- Hardening items do not count toward the follow-up limit: only ordinary follow-ups do. On a plan with Linear issues, hardening items stay in cairn by default; only ordinary follow-ups go to Linear (`linear.fileFollowUps`, default `ordinary`).

## 1. Check
Run `cairn status --json`. The stage must be `learn`. Any other stage: say which and run `cairn next --json`. Stop this procedure.

**Done when:** the stage is `learn`.

## 2. Follow-ups
Ship's tidy step already grouped and dismissed this plan's follow-ups. Run `cairn suggest list --open --json` and count the open ones whose key starts with `<slug>:`. At most 5 may stay open. If there are more, group or dismiss them now (`cairn suggest merge` or `cairn suggest resolve <key> --dismiss --note "<reason>"`) and list what was dropped in the record.

**Done when:** at most 5 open follow-ups remain from this plan.

## 3. Findings
Check the `## Findings` section of `docs/cairn/plans/<date>-<slug>/RECORD.md`. If it is filled in, go on. If it is missing or still the template placeholder, dispatch the `recorder` agent (`model: sonnet`, `description` "Record · findings") with the plan log (the `log` array in `state.json`), the evidence notes, and the record path. Tell it to write Findings from that log only: tasks that escalated, review findings that repeated, checks that failed, scope added mid-plan, and anything surprising. It edits only that section and keeps the record within 600 words (`wc -w`). Commit the change on the plan branch.

**Done when:** the Findings section has lines (or says "None.") and the change is committed.

## 4. Close
Run `cairn close`. It needs a valid `RECORD.md` (every section, Findings included, within 600 words) and passing tests; on refusal, fix what it names and rerun.

**Done when:** the stage is `closed`. Commit anything the close wrote on the plan branch.

## 5. Update the pull request and wait
Run `cd <plan worktree> && cairn pr open` again: it pushes the closing commits and refreshes the body. It works at learn and closed. Then send one short message and end the turn: the PR link, ready or draft, and the counts (calls made for the user, parts not done). For example: "PR is open and ready: <url>. 4 calls made for you, nothing left undone. Reply merge to merge it, or send notes." `cairn status` shows "PR open" until the branch lands. The user's reply is handled by the "Merge (after the PR is open)" section of `procedures/ship.md`.

**Done when:** the pull request is updated and the message is sent.
