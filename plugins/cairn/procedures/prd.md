# PRD

Draft the PRD from the decisions, test it with a fresh reader and five review lenses, then stop for approval.

Templates live in `templates/`, next to this `procedures/` folder (`${CLAUDE_PLUGIN_ROOT}/templates/prd.md`). Talk to the user per `references/reporting.md`. `cairn` is on PATH; if not, run `node "${CLAUDE_PLUGIN_ROOT}/dist/cairn.mjs"`.

## 1. Check
Run `cairn status --json`. The stage must be `prd`. Any other stage: say which and run `cairn next --json`. Stop this procedure.

**Done when:** the stage is `prd`. If `prd.md` already exists, read it and treat step 2 as a revision.

## 2. Draft prd.md
Write `docs/sdlc/plans/<slug>/prd.md` in the plan worktree from `${CLAUDE_PLUGIN_ROOT}/templates/prd.md`. Keep every `## ` heading exactly as the template has it. Sources: `decisions.md` and, when present, `docs/sdlc/product/PRD.md`.

- Functional requirements: one testable behavior each, ids `FR-01`, `FR-02`, ... in order. Non-functional: `NFR-01`, ... with numbers.
- Inherited constraints: copy the binding non-goals, NFRs, and must-not-trade-off items from the product PRD with their source. Omit the section when no product PRD exists.
- Acceptance criteria: at least one per FR, each citing its FR id, each observable.
- Unhappy paths: concrete failures per FR (bad input, missing data, denied access, dependency down, races, double submit) with the exact expected behavior.
- Security considerations: concrete threats and controls. Write "none, because ..." only with a reason.
- Open questions: every unresolved item is `- [ ]`. Resolved items are `- [x]` with the answer.
- Every claim traces to a recorded decision. When the draft needs a decision that is missing, ask the user (AskUserQuestion, recommended first), run `cairn decide`, then continue.

**Done when:** every template heading is present, every FR has an acceptance criterion, every FR with a failure mode has an unhappy path, and security is concrete.

## 3. Builder check
Dispatch the `builder-check` agent (`model: sonnet`) with the path to `prd.md`. It returns the questions a builder would still need answered, ranked.

For each question, in rank order: ask the user one at a time through AskUserQuestion (recommended answer first), record with `cairn decide`, and fold the answer into `prd.md`. Skip questions that `prd.md` or `decisions.md` already answers.

**Done when:** the agent reported "nothing important left", or every question it raised is answered and folded in.

## 4. Review lenses
Dispatch five `doc-reviewer` agents in parallel, one per lens, each `model: sonnet`, each given the path to `prd.md`, the path to `decisions.md`, and its lens: `coherence`, `feasibility`, `scope-guardian`, `security`, `testability`.

Merge the findings. Apply each fix that follows from a recorded decision straight to `prd.md`. Ask the user (one AskUserQuestion per item, recommended first) about each finding that needs a product call, then record and apply it.

**Done when:** every finding is applied, answered, or dismissed with a one-line reason, and `prd.md` has no `- [ ]` item that the user has already answered.

## 5. Stop for approval
Present about five lines: the problem, the solution, the number of requirements, the sharpest non-goal, and the main security point.

Run `cairn status --json` and read `modActive`.
- True: ask with AskUserQuestion. The question text includes `[cairn:approve prd <slug>]`, with the plan slug from the status output. Options:
  - Approve (Recommended)
  - Revise: ask what to change, apply, rerun steps 3-4 for the changed parts
  - Pause: go to the pause procedure
- False: the mod can't record a menu answer. Tell the user to run `cairn approve prd --human` in their own terminal, then wait for them to say it's done.

Do not approve on the user's behalf.

**Done when:** the user chose Approve, or said the terminal approval ran.

## 6. Confirm and advance
Run `cairn status --json` and check that the PRD approval is recorded. If it is not, say what the menu outcome or the terminal output reported, fix what it names (a missing section, or an open `- [ ]` question), show the user the change, and return to step 5.

Once the approval is recorded, run `cairn advance`.

**Done when:** the stage is `plan`. Then run `cairn next --json` and follow the procedure it names.
