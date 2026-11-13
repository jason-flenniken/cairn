# PRD

Have the PRD written from the decisions, have a fresh agent read it cold, then stop for the user to approve it. The user is the one who approves; the fresh read checks that the PRD stands on its own. The main thread interviews and routes; the writer holds the document.

Talk to the user per `references/reporting.md`. `cairn` is on PATH; if not, run `node "${CLAUDE_PLUGIN_ROOT}/dist/cairn.mjs"`.

**Questions that block the plan.** Before an AskUserQuestion only the user can answer (not the approval question: the step `approving` already says that one waits), run `cd <plan worktree> && cairn step asking`, so the pane of a session in another plan shows that this plan waits for the user in its session. Once it is answered, put the step back: `cd <plan worktree> && cairn step <drafting or checking, whichever you were on>`.

## At this level
Read `level` from `cairn status --json`; `references/levels.md` has the full table. 
- MVP: a thin PRD (the writer knows the shape). Skip step 2b (builder check).
- Standard: as written below.
- Polished: the writer also adds acceptance examples (Given / When / Then) for every conditional requirement.
- Tell the writer the level in the brief.

## 1. Check
Run `cairn status --json`. The stage must be `prd`. Any other stage: say which and run `cairn next --json`. Stop this procedure.

**Done when:** the stage is `prd`. If `prd.md` already exists, step 2 is a revision: brief a writer to revise it from the new decisions.

## 2. Brief the writer
Run `cd <plan worktree> && cairn step drafting`, so the pane does not offer the PRD for approval while it is written. Then dispatch the `prd-writer` agent (`model: opus`, `description` "Build · PRD") with a brief of paths, no pasted content: the plan folder (`docs/cairn/plans/<date>-<slug>/` in the plan worktree), `decisions.md`, the research files in the work folder (`research/*.md`), `issues/` when `state.linear` is set, `docs/cairn/product/PRD.md` when it exists, the level, and the template `${CLAUDE_PLUGIN_ROOT}/templates/prd.md`. The writer reads them, writes `prd.md`, and returns at most 10 lines: a summary, any questions for the user, and the path.

You never edit `prd.md` yourself. When the writer's questions need a decision, ask the user (AskUserQuestion, recommended first), run `cairn decide`, and send the answer to the writer with SendMessage (or a fresh `prd-writer` with the same paths, when it has ended).

**Done when:** the writer returned and every question it raised is decided.

## 2b. Builder check
Run `cd <plan worktree> && cairn step checking`. Then dispatch one `prd-checker` agent (`model: sonnet`, `description` "Review · PRD") with only the path to `prd.md`, the repo path, and the report path `<work folder>/reports/prd-check.md` (`<plan worktree>/.cairn/work/<slug>/`). Never give it `decisions.md`, the read-back card, or a summary: the PRD has to stand on its own, and a reader who knows the backstory cannot tell you whether it does.

It ends with the counts, the questions for the user, and the report path. Send that report path to the writer with SendMessage, together with the path of the read-back card (the `Read-back` decision in `decisions.md`): the writer applies the answered and minor items, compares the checker's restatement with the card, and returns only what is for the user. Ask the user about each of those with AskUserQuestion (recommended first), run `cairn decide`, and send the answers to the writer.

When in doubt, a guess is for the user. Every guess the writer set aside gets a one-line reason: `cairn decide "Set aside: <guess>" "<reason>" --why "PRD builder check"`.

**Done when:** every guess is fixed in `prd.md`, decided by the user, or set aside with a reason, and the writer reports the restatement matches the card.

## 3. Stop for approval
Run `cd <plan worktree> && cairn step approving`; the pane offers the PRD for approval from here on. Then present about four lines from the writer's summary: the problem, the solution, the number of requirements, and the sharpest non-goal. The pane shows the document; do not read it into your context. When step 2b set guesses aside, add `Set aside from the builder check (N):` with each guess and its reason on its own line, those touching the success answer or a non-goal first, so the user can raise one under Revise.

Run `cairn status --json`. If `state.approvals.prd` is already recorded (approved from the pane), skip the question: say it is approved and go on to the next step. Otherwise read `modActive`.
- True: ask with AskUserQuestion. The question text includes `[cairn:approve prd <slug>]`, with the plan slug from the status output. Options:
  - Approve (Recommended)
  - Revise: run `cd <plan worktree> && cairn step drafting`, ask what to change, send it to the writer with SendMessage (or a fresh `prd-writer` when it has ended), and return to step 3
  - Pause: go to the pause procedure
- False: the mod can't record a menu answer. Tell the user to run, in their own terminal, the full command `cd <planWorktree> && <plugin root>/bin/cairn approve prd --human` (fill in `planWorktree` from `cairn status --json` and the plugin root, real paths, so it runs as printed), then wait for them to say it's done.

Do not approve on the user's behalf.

**Done when:** the user chose Approve, or said the terminal approval ran.

## 4. Confirm and advance
Run `cairn status --json` and check that the PRD approval is recorded. If it is not, say what the menu outcome or the terminal output reported, send what it names (a missing section, or an open `- [ ]` question) to the writer, tell the user what changed, and return to step 3.

Once the approval is recorded, run `cairn advance`.

**Done when:** the stage is `plan`. Then run `cairn next --json`. When its output holds a fresh-start line ("Context is at N%… start fresh with /clear, then /cairn:next."), tell the user that line and stop. Otherwise follow the procedure it names.
