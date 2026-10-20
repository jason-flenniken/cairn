# Phase end

Check the finished phase against the PRD, then stop for the user's decision.

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

## 3. Alignment check
Dispatch one Explore agent (`model: sonnet`). Give it: the phase's covered requirements quoted from `prd.md` with their acceptance criteria and unhappy paths, the product PRD's non-goals and must-not-trade-off items when present, the diff stat, and this instruction: read the code for each requirement and return a verdict per requirement with `path:line` evidence.

- aligned: behavior matches, including limits, messages, and rules
- partial: implemented, but a detail differs
- missing: required but absent
- Also list code that no covered requirement explains (unplanned work) and any breach of a non-goal.

Reading the code is the only evidence; a matching function name does not count.

**Done when:** every covered requirement has a verdict with evidence, and unplanned work is listed or stated as none.

## 4. Report and ask
Present, in about 8 lines: slices done, test result, diff size, the verdict counts, and each partial/missing item and each drift entry in one line. Then ask with AskUserQuestion:
- Continue: approve the phase (Recommended when nothing is missing or partial)
- Fix first: user describes the problem
- Re-plan: changes to later phases
- Pause

**Done when:** the user chose an option.

## 5. Act on the choice
- **Fix first:** ask what to fix, add a fix slice to the current phase in `plan.md` (own scope, `covers` the affected requirements, concrete tests), run `cairn plan load --replan`, ask the user to approve the changed plan, and `cairn approve plan`. Then run `cairn next --json` to return to execute.
- **Re-plan:** edit the later phases in `plan.md` with the user, then the same replan sequence.
- **Pause:** follow the pause procedure.
- **Continue:** go to step 6.

**Done when:** Continue was chosen, or the plan was changed and execute resumed, or the plan is paused.

## 6. Drift
For each drift entry, ask with AskUserQuestion (grouped by file when several): Accept (record why) / Revert the edit / Cover it with a slice. For each accepted entry run `cairn drift ack <path> --note "<reason>"`. For all accepted: `cairn drift ack --all`.

**Done when:** every drift entry is acknowledged or resolved.

## 7. Approve the phase
Run `cairn approve phase`. When refused, read what it names (an unfinished slice, unacknowledged drift) and resolve it. The last approved phase moves the plan to verify automatically.

**Done when:** the phase is approved. Then run `cairn next --json` and follow the procedure it names.
