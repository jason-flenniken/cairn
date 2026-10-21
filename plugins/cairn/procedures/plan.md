# Plan

Turn the approved PRD into phases of vertical tasks, load it, then stop for approval.

Templates live in `templates/`, next to this `procedures/` folder (`${CLAUDE_PLUGIN_ROOT}/templates/plan.md`). Talk to the user per `references/reporting.md`. `cairn` is on PATH; if not, run `node "${CLAUDE_PLUGIN_ROOT}/dist/cairn.mjs"`.

## 1. Check
Run `cairn status --json`. The stage must be `plan`. Any other stage: say which and run `cairn next --json`. Stop this procedure.

**Done when:** the stage is `plan`. If `plan.md` exists, read it and treat step 3 as a revision.

## 2. Explore
Dispatch Explore agents (`model: sonnet`, `description` per `references/reporting.md`) in parallel, split by area the PRD touches. Each returns: existing modules and their interfaces, patterns to follow, test layout and runner, files likely to change, and refactors that would make the change easier (prefactoring). Use `path:line` evidence.

**Done when:** you can name, for each FR, the files and seams it lands in.

## 3. Write plan.md
Write `docs/sdlc/plans/<date>-<slug>/plan.md` from `${CLAUDE_PLUGIN_ROOT}/templates/plan.md`. Required headings: Goal, Architecture, Phases. Keep the plan short. Slicing rules:

- **Vertical:** each task is a narrow, complete path through every layer. A horizontal layer alone is never a task.
- **Right-sized:** each task fits one fresh context window. Split further when it would not.
- **Prefactor first:** refactors that ease the work come as the earliest tasks.
- **Phases** are demoable milestones; the first phase proves the thinnest end-to-end path.
- **Parallel by default:** disjoint `scope` globs, minimal `blocked_by`. Two tasks touching the same files get an edge between them.
- **Complexity:** `simple` (mechanical, 1-2 files), `standard` (default), `complex` (architecture judgment, broad integration).
- **Coverage:** every FR is in some task's `covers`, or listed under `## Deferred requirements` with a reason.
- **Risk:** set `risky: true` (with a one-line `riskReason`) on any task that touches auth, money, deletes, migrations, a public API, untrusted input, personal data, a new dependency, model output, or shell commands and paths built from data. Everything else is `risky: false`.

Under `## Phases` put exactly one `yaml cairn-tasks` block, then one `### Task: <id>` section per task with a one-line **Check:** and **Interfaces**. Only risky tasks list **Test cases** (Happy / Unhappy / Security bullets, each concrete). Each misuse case in the PRD's Security section becomes a Security test case on the task that covers it.

When you consciously skip tests on a non-risky task (an area worth covering later), log up to 5 of them as suggestions: `cairn suggest add --area tests --from plan --where <glob> --text "<what to cover and why>"`.

**Done when:** every task has a Check, risky tasks have concrete tests, and every FR is covered or deferred.

## 4. Load
Run `cairn plan load`. On refusal, read what it names (a cycle, an unknown FR id, a missing scope, an uncovered requirement), fix `plan.md`, and rerun.

**Done when:** `cairn plan load` exits 0.

## 5. Stop for approval
Show a tree preview and about three lines of summary:

```
Phase 1: Foundations
  - Cart API (standard)          blocked by: none
  - Product list (simple)        blocked by: none
Phase 2: Checkout
  - Checkout form (standard)     blocked by: Cart API
```

Run `cairn status --json`. If `state.approvals.plan` is already recorded (approved from the pane), skip the question: say it is approved and go on to the next step. Otherwise read `modActive`.
- True: ask with AskUserQuestion, with the tree as the preview on the first option. The question text includes `[cairn:approve plan <slug>]`, with the plan slug from the status output:
  - Approve (Recommended)
  - Revise: ask what to change; edit `plan.md`; rerun step 4
  - Pause: go to the pause procedure
- False: the mod can't record a menu answer. Tell the user to run, in their own terminal, the full command `cd <planWorktree> && <plugin root>/bin/cairn approve plan --human` (fill in `planWorktree` from `cairn status --json` and the plugin root, real paths, so it runs as printed), then wait for them to say it's done.

Do not approve on the user's behalf.

**Done when:** the user chose Approve, or said the terminal approval ran.

## 6. Confirm and advance
Run `cairn status --json` and check that the plan approval is recorded. If it is not, say what the menu outcome or the terminal output reported. If `plan.md` changed since loading, rerun `cairn plan load` and return to step 5.

Once the approval is recorded, run `cairn advance`.

**Done when:** the stage is `execute`. Then run `cairn next --json` and follow the procedure it names.
