# Phase end

Check the finished phase against the PRD, record the CLI's direction verdict, then stop for the user's decision.

Templates live in `templates/`, next to this `procedures/` folder. Talk to the user per `references/reporting.md`. `cairn` is on PATH; if not, run `node "${CLAUDE_PLUGIN_ROOT}/dist/cairn.mjs"`.

## 1. Check
Run `cairn status --json`. The stage must be `execute` and every slice in the current phase done. Otherwise say what remains and run `cairn next --json`. Stop this procedure.

**Done when:** the stage is `execute`, the phase's slices are all done, and you know the phase name, plan branch, and base branch.

## 2. Gather
Collect:
- The phase's slices and what each delivers.
- The test result: run the repo's test command in the plan worktree and record the pass count.
- `git diff --stat <phase-start>...HEAD` for the phase (phase start is the plan branch tip before the phase's first merge, found in `git log`).
- The drift entries from `cairn status --json` (edits outside a slice's scope).

**Done when:** you hold a slice list, a test result from a run in this step, a diff stat, and the drift list.

## 3. Direction check
Follow `procedures/direction.md` with this phase's id. It fans out `direction-checker` agents, writes `docs/sdlc/plans/<slug>/direction/<phase-id>.md` with its `cairn-direction` scorecard, and runs `cairn evidence phase`. The CLI computes the color; do not state or record one yourself. If `cairn evidence phase` refuses, fix the report as the direction procedure says and rerun. Never override it.

**Done when:** `cairn evidence phase` recorded a verdict for this phase.

## 4. Report and ask
Show the report: slices done, test result, diff size, the color the CLI recorded, the verdict counts, and each partial, missing, or contradicted item and each drift entry in one line, about 8 lines. Name the report path. Then ask with AskUserQuestion:
- Continue to phase approval (Recommended when nothing is missing, partial, or contradicted)
- Fix first: user describes the problem
- Re-plan: changes to later phases
- Pause

**Done when:** the user chose an option.

## 5. Act on the choice
- **Fix first:** ask what to fix, add a fix slice to the current phase in `plan.md` (own scope, `covers` the affected requirements, concrete tests), run `cairn plan load --replan`, then get the user's approval of the changed plan. Run `cairn status --json` and read `modActive`. When true, ask with AskUserQuestion, with the question text including `[cairn:approve plan <slug>]`: Approve (Recommended) / Revise. When false, tell the user to run `cairn approve plan --human` in their own terminal and wait for them to say it's done. Then run `cairn status --json` to confirm, and `cairn next --json` to return to execute.
- **Re-plan:** edit the later phases in `plan.md` with the user, then the same replan approval.
- **Pause:** follow the pause procedure.
- **Continue to phase approval:** go to step 6.

**Done when:** Continue to phase approval was chosen, or the plan was changed and execute resumed, or the plan is paused.

## 6. Drift
For each drift entry, ask with AskUserQuestion (grouped by file when several): Accept (record why) / Revert the edit / Cover it with a slice. For each accepted entry run `cairn drift ack <path> --note "<reason>"`. For all accepted: `cairn drift ack --all`.

**Done when:** every drift entry is acknowledged or resolved.

## 7. Approve the phase
Run `cairn status --json` and read `modActive`.
- True: ask with AskUserQuestion. The question text includes `[cairn:approve phase <slug>]`, with the plan slug from the status output:
  - Approve (Recommended)
  - Hold: stop here; the phase stays open

  The mod records an approval only for the labels "Approve" and "Approve (Recommended)", so the approval option keeps that exact label.
- False: the mod can't record a menu answer. Tell the user to run `cairn approve phase --human` in their own terminal, then wait for them to say it's done.

Then run `cairn status --json` to confirm the phase approval is recorded. If it is not, say what the menu outcome or the terminal output reported. When it names an unfinished slice or unacknowledged drift, resolve it and return to this step. When it names a red direction verdict or code changed since the check, return to step 3; never override. The last approved phase moves the plan to verify automatically.

**Done when:** `cairn status --json` shows the phase approved.

## 8. Clean start
Once the approval is confirmed, ask with AskUserQuestion (no approval tag; this question records nothing):
- Start clean: the phase is already approved; this ends here so the user can clear context
- Continue in this session

If the user picks Start clean, tell them: "/clear, then /cairn:next". Stop.
Otherwise run `cairn next --json` and follow the procedure it names.

**Done when:** the user was told "/clear, then /cairn:next", or the next procedure started.
