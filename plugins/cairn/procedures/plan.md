# Plan

Have the approved PRD turned into phases of vertical tasks and loaded, then stop for approval. The main thread routes; the plan-writer holds the document.

Talk to the user per `references/reporting.md`. `cairn` is on PATH; if not, run `node "${CLAUDE_PLUGIN_ROOT}/dist/cairn.mjs"`.

**Questions that block the plan.** Before an AskUserQuestion only the user can answer (not the approval question: the step `approving` already says that one waits), run `cd <plan worktree> && cairn step asking`, so the pane of a session in another plan shows that this plan waits for the user in its session. Once it is answered, put the step back: `cd <plan worktree> && cairn step <drafting or checking, whichever you were on>`.

## At this level
Read `level` from `cairn status --json`; `references/levels.md` has the full table. 
- MVP: few, large vertical tasks, usually one phase, no Test cases lists; risky tasks still get `risky: true`, and the writer files the areas it leaves untested with `cairn suggest add --kind hardening --area tests --from plan --where <glob> --text "<what to cover and why>"`. Tell the writer the level in the brief; it holds the rules.
- Standard: as written below.
- Polished: every task lists Test cases, each naming the failure mode it pins, and step 4 runs the `plan-reviewer` fresh read.
- A level raised after the plan was approved clears the approval: run the plan again at the new level and ask for approval again.

## 1. Check
Run `cairn status --json`. The stage must be `plan`. Any other stage: say which and run `cairn next --json`. Stop this procedure.

**Done when:** the stage is `plan`. If `plan.md` exists, step 3 is a revision: brief a writer to revise it.

## 2. Explore
Dispatch `researcher` agents (`model: sonnet`, `description` "Check · <area> research") in parallel, split by area the PRD touches. Each gets the path to `prd.md`, its area, and `research/<area>.md` in the work folder (`<plan worktree>/.cairn/work/<slug>/`) to write to. Each writes: existing modules and their interfaces, patterns to follow, test layout and runner, files likely to change, and refactors that would make the change easier (prefactoring), with `path:line` evidence. You do not read those files; the plan-writer does. Read only the short returns.

**Done when:** every researcher returned and you hold the paths of their files.

## 3. Brief the writer
Run `cd <plan worktree> && cairn step drafting`, so the pane does not offer the plan for approval while it is written. Then dispatch the `plan-writer` agent (`model: opus`, `description` "Build · plan") with a brief of paths, no pasted content: the plan folder, `prd.md`, `decisions.md`, the research files, `issues/` when `state.linear` is set, the level, `foundational` when the status shows it, and the template `${CLAUDE_PLUGIN_ROOT}/templates/plan.md`. The writer follows the slicing rules (its own prompt holds them), writes `plan.md`, runs `cairn plan load` and fixes its refusals, and returns at most 10 lines: the phases and task count, the longest-chain line `plan load` printed, any warning about other plans, questions for the user, and the path.

You never edit `plan.md` yourself. When the longest chain is over half the tasks, send the writer one line asking for a contract-first split, and let it reload. Ask the user about its questions (AskUserQuestion, recommended first), run `cairn decide`, and send the answers to the writer with SendMessage (or a fresh `plan-writer` with the same paths, when it has ended).

**Done when:** the writer returned, its `cairn plan load` exited 0, and every question it raised is decided.

## 4. Fresh read (Polished)
Standard and MVP skip this step. At Polished: run `cd <plan worktree> && cairn step checking`, then dispatch `plan-reviewer` (`model: sonnet`, `description` "Review · plan") with the paths to `prd.md` and `plan.md` and the report path `<work folder>/reports/plan-review.md`. It ends with the counts, the questions for the user and the report path. Send that report path to the writer with SendMessage: it applies the answered and minor items, reloads, and returns only what is for the user. Ask the user about those, send the answers to the writer, and confirm its reload exited 0.

**Done when:** the writer's reload succeeded after the review, or the level skips the step.

## 5. Stop for approval
Run `cd <plan worktree> && cairn step approving`; the pane offers the plan for approval from here on. Then show a tree preview and about three lines of summary, built from `cairn status --json` and the writer's summary (the pane shows the document; do not read `plan.md` into your context):

```
Phase 1: Foundations
  - Cart API (standard)          blocked by: none
  - Product list (simple)        blocked by: none
Phase 2: Checkout
  - Checkout form (standard)     blocked by: Cart API
```

On a foundational plan, the question names the chosen approach (the summary starts with "Approach: …").

Run `cairn status --json`. If `state.approvals.plan` is already recorded (approved from the pane), skip the question: say it is approved and go on to the next step. If `warnings` says prd.md changed after it was approved, approving the plan also accepts those PRD edits: say so in the question and name what changed in the PRD in plain words. There is no separate PRD re-approval. Otherwise read `modActive`.
- True: ask with AskUserQuestion, with the tree as the preview on the first option. The question text includes `[cairn:approve plan <slug>]`, with the plan slug from the status output:
  - Approve (Recommended)
  - Revise: run `cd <plan worktree> && cairn step drafting`, ask what to change, send it to the writer with SendMessage (or a fresh `plan-writer` when it has ended; it reloads), and return to step 5
  - Pause: go to the pause procedure
- False: the mod can't record a menu answer. Tell the user to run, in their own terminal, the full command `cd <planWorktree> && <plugin root>/bin/cairn approve plan --human` (fill in `planWorktree` from `cairn status --json` and the plugin root, real paths, so it runs as printed; it also accepts any PRD edits), then wait for them to say it's done.

Do not approve on the user's behalf.

**Done when:** the user chose Approve, or said the terminal approval ran.

## 5a. Offer to put the plan in Linear
Only when `.cairn/config.json` has a `linear` block and `cairn status --json` shows no `state.linear`. Once the plan is approved, ask once with AskUserQuestion: "Put this plan in Linear?" Name the tickets it would file (each task's `ticket:`, else its phase's name).
- Not now (Recommended): go on. The plan stays out of Linear.
- Yes: ask for the Linear project (and milestone, optional), then run `cd <plan worktree> && cairn linear publish --project "<project>" [--milestone "<milestone>"]`. Then dispatch the `linear-sender` agent (`model: haiku`, `description` "Record · Linear tickets") with the plan worktree path and the plugin root; it files the epic, then the tickets under it, then the blocked-by links between them, following `procedures/linear-sync.md`. Wait for it here: the plan's tickets need their keys. From then on the plan moves its tickets like one pulled in from Linear.

**Done when:** the user answered, and on Yes the epic and tickets are filed.

## 6. Confirm and advance
Run `cairn status --json` and check that the plan approval is recorded. If it is not, say what the menu outcome or the terminal output reported. If `plan.md` changed since loading, have the writer reload it (SendMessage) and return to step 5.

Once the approval is recorded, run `cairn advance`.

**Done when:** the stage is `execute`. Then run `cairn next --json`. When its output holds a fresh-start line ("Context is at N%… start fresh with /clear, then /cairn:next."), tell the user that line and stop. Otherwise follow the procedure it names.
