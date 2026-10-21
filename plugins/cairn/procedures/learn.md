# Learn

Finish the record, then close the plan. Learn asks the user nothing.

v0.1 scope. A later version adds structured learnings written to `docs/sdlc/learnings/`.

Templates live in `templates/`, next to this `procedures/` folder. Talk to the user per `references/reporting.md`. `cairn` is on PATH; if not, run `node "${CLAUDE_PLUGIN_ROOT}/dist/cairn.mjs"`.

## 1. Check
Run `cairn status --json`. The stage must be `learn`. Any other stage: say which and run `cairn next --json`. Stop this procedure.

**Done when:** the stage is `learn`.

## 2. Follow-ups
Ship's tidy step already grouped and dismissed this plan's follow-ups. Run `cairn suggest list --open --json` and count the open ones whose key starts with this plan's slug. At most 5 may stay open. If there are more, group or dismiss them now (`cairn suggest merge` or `cairn suggest resolve <key> --dismiss --note "<reason>"`) and list what was dropped in the record.

**Done when:** at most 5 open follow-ups remain from this plan.

## 3. Findings
Check the `## Findings` section of `docs/sdlc/plans/<date>-<slug>/RECORD.md`. If it is filled in, go on. If it is missing or still the template placeholder, dispatch the `recorder` agent (`model: sonnet`, `description` "Record · findings") with the plan log (the `log` array in `state.json`), the evidence notes, and the record path. Tell it to write Findings from that log only: tasks that escalated, review findings that repeated, checks that failed, scope added mid-plan, and anything surprising. It edits only that section and keeps the record within 600 words (`wc -w`). Commit the change on the plan branch.

**Done when:** the Findings section has lines (or says "None.") and the change is committed.

## 4. Close
Run `cairn close`. It needs a valid `RECORD.md` (every section, Findings included, within 600 words) and passing tests; on refusal, fix what it names and rerun.

**Done when:** the stage is `closed`. Tell the user in one line that the plan is closed and the PR is the remaining step.
