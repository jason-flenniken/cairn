# PRD

Draft the PRD from the decisions, have a fresh agent read it cold, then stop for the user to approve it. The user is the one who approves; the fresh read checks that the PRD stands on its own.

Templates live in `templates/`, next to this `procedures/` folder (`${CLAUDE_PLUGIN_ROOT}/templates/prd.md`). Talk to the user per `references/reporting.md`. `cairn` is on PATH; if not, run `node "${CLAUDE_PLUGIN_ROOT}/dist/cairn.mjs"`.

## At this level
Read `level` from `cairn status --json`; `references/levels.md` has the full table. 
- MVP: a thin PRD. Problem, Solution, Requirements with one-line checks, Non-goals. Add Security only when discover recorded a trust boundary. Skip step 2b (builder check).
- Standard: as written below.
- Polished: also add acceptance examples (Given / When / Then) for every requirement that is conditional.

## 1. Check
Run `cairn status --json`. The stage must be `prd`. Any other stage: say which and run `cairn next --json`. Stop this procedure.

**Done when:** the stage is `prd`. If `prd.md` already exists, read it and treat step 2 as a revision.

## 2. Draft prd.md
Write `docs/sdlc/plans/<date>-<slug>/prd.md` in the plan worktree from `${CLAUDE_PLUGIN_ROOT}/templates/prd.md`. Keep the five required `## ` headings exactly as the template has them: Problem, Solution, Requirements, Non-goals, Open questions. Sources: `decisions.md` and, when present, `docs/sdlc/product/PRD.md`.

- Requirements: one testable behavior each, ids `FR-01`, `FR-02`, ... in order, each with a one-line `Check:` that says how you will know it works.
- Keep the optional sections (Unhappy paths, Security, Non-functional requirements, User stories) only where they are real for this plan; delete the rest. Security is required whenever discover recorded a trust boundary in `decisions.md`. Write it as a short threat model: trust boundaries, assets, a STRIDE pass (one line per boundary) and misuse cases. Read the Threat model section of `references/security-checklist.md` first. Leave it out only when every boundary was recorded as not applicable.
- Open questions: every unresolved item is `- [ ]`. Resolved items are `- [x]` with the answer.
- Every claim traces to a recorded decision. When the draft needs a decision that is missing, ask the user (AskUserQuestion, recommended first), run `cairn decide`, then continue.

**Done when:** the five headings are present and every requirement has a check.

## 2b. Builder check
Dispatch one `prd-checker` agent (`model: sonnet`, `description` "Review · PRD") with only the path to `prd.md` in the plan worktree and the repo path. Never give it `decisions.md`, the read-back card, or a summary: the PRD has to stand on its own, and a reader who knows the backstory cannot tell you whether it does.

It returns its own restatement of the PRD and the guesses a builder would have to make. Act on each:
- **Answered by the PRD:** put the answer where a builder looks (the requirement itself), and edit `prd.md`.
- **Minor:** pick one, or leave it to the builder.
- **For the user:** ask with AskUserQuestion (recommended first), run `cairn decide`, and edit `prd.md`.

Compare its restatement with the read-back card (the `Read-back` decision in `decisions.md`). Where they differ on the problem, the user, the outcome, or success, the PRD says something other than what was agreed: fix the PRD and name the change at the stop.

When in doubt, a guess is for the user. Every guess you do not fix in `prd.md` or ask about gets a one-line reason: `cairn decide "Set aside: <guess>" "<reason>" --why "PRD builder check"`.

**Done when:** every guess is fixed in `prd.md`, decided by the user, or set aside with a reason, and the restatement matches the card.

## 3. Stop for approval
Present about four lines: the problem, the solution, the number of requirements, and the sharpest non-goal. When step 2b set guesses aside, add `Set aside from the builder check (N):` with each guess and its reason on its own line, those touching the success answer or a non-goal first, so the user can raise one under Revise.

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
