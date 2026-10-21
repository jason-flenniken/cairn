# PRD

Draft the PRD from the decisions, then stop for the user to approve it. There are no automated reviewers: the user is the reviewer.

Templates live in `templates/`, next to this `procedures/` folder (`${CLAUDE_PLUGIN_ROOT}/templates/prd.md`). Talk to the user per `references/reporting.md`. `cairn` is on PATH; if not, run `node "${CLAUDE_PLUGIN_ROOT}/dist/cairn.mjs"`.

## 1. Check
Run `cairn status --json`. The stage must be `prd`. Any other stage: say which and run `cairn next --json`. Stop this procedure.

**Done when:** the stage is `prd`. If `prd.md` already exists, read it and treat step 2 as a revision.

## 2. Draft prd.md
Write `docs/sdlc/plans/<date>-<slug>/prd.md` in the plan worktree from `${CLAUDE_PLUGIN_ROOT}/templates/prd.md`. Keep the five required `## ` headings exactly as the template has them: Problem, Solution, Requirements, Non-goals, Open questions. Sources: `decisions.md` and, when present, `docs/sdlc/product/PRD.md`.

- Requirements: one testable behavior each, ids `FR-01`, `FR-02`, ... in order, each with a one-line `Check:` that says how you will know it works.
- Keep the optional sections (Unhappy paths, Security, Non-functional requirements, User stories) only where they are real for this plan; delete the rest. Add Security whenever the plan touches auth, money, personal data or untrusted input.
- Open questions: every unresolved item is `- [ ]`. Resolved items are `- [x]` with the answer.
- Every claim traces to a recorded decision. When the draft needs a decision that is missing, ask the user (AskUserQuestion, recommended first), run `cairn decide`, then continue.

**Done when:** the five headings are present and every requirement has a check.

## 3. Stop for approval
Present about four lines: the problem, the solution, the number of requirements, and the sharpest non-goal.

Run `cairn status --json`. If `state.approvals.prd` is already recorded (approved from the pane), skip the question: say it is approved and go on to the next step. Otherwise read `modActive`.
- True: ask with AskUserQuestion. The question text includes `[cairn:approve prd <slug>]`, with the plan slug from the status output. Options:
  - Approve (Recommended)
  - Revise: ask what to change and apply it
  - Pause: go to the pause procedure
- False: the mod can't record a menu answer. Tell the user to run, in their own terminal, the full command `cd <planWorktree> && <plugin root>/bin/cairn approve prd --human` (fill in `planWorktree` from `cairn status --json` and the plugin root, real paths, so it runs as printed), then wait for them to say it's done.

Do not approve on the user's behalf.

**Done when:** the user chose Approve, or said the terminal approval ran.

## 4. Confirm and advance
Run `cairn status --json` and check that the PRD approval is recorded. If it is not, say what the menu outcome or the terminal output reported, fix what it names (a missing section, or an open `- [ ]` question), show the user the change, and return to step 5.

Once the approval is recorded, run `cairn advance`.

**Done when:** the stage is `plan`. Then run `cairn next --json` and follow the procedure it names.
