# Learn

Capture what is worth remembering, then close the plan.

v0.1 scope. A later version adds structured learnings written to `docs/sdlc/learnings/`.

Templates live in `templates/`, next to this `procedures/` folder. Talk to the user per `references/reporting.md`. `cairn` is on PATH; if not, run `node "${CLAUDE_PLUGIN_ROOT}/dist/cairn.mjs"`.

## 1. Check
Run `cairn status --json`. The stage must be `learn`. Any other stage: say which and run `cairn next --json`. Stop this procedure.

**Done when:** the stage is `learn`.

## 2. Ask
Ask with AskUserQuestion: "Anything worth remembering for next time?" Offer: Nothing to add (Recommended) / Add a note. Suggest candidates from the run when you saw them: a task that needed escalation, a repeated review finding, a surprising constraint.

**Done when:** the user answered.

## 3. Write the note
For a note, append it under `## Follow-ups` in `docs/sdlc/plans/<slug>/RECORD.md` (or as a bullet under a `## Learnings` heading added at the end of the file). Keep the record within 900 words (`wc -w`). Commit the change on the plan branch.

**Done when:** the note is saved and committed, or the user chose to add nothing.

## 4. Close
Run `cairn close`. It needs a valid `RECORD.md` and passing tests; on refusal, fix what it names and rerun.

**Done when:** the stage is `closed`. Tell the user in one line that the plan is closed and the PR is the remaining step.
