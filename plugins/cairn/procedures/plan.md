# Plan

Turn the approved PRD into phases of vertical tasks, load it, then stop for approval.

Templates live in `templates/`, next to this `procedures/` folder (`${CLAUDE_PLUGIN_ROOT}/templates/plan.md`). Talk to the user per `references/reporting.md`. `cairn` is on PATH; if not, run `node "${CLAUDE_PLUGIN_ROOT}/dist/cairn.mjs"`.

## 1. Check
Run `cairn status --json`. The stage must be `plan`. Any other stage: say which and run `cairn next --json`. Stop this procedure.

**Done when:** the stage is `plan`. If `plan.md` exists, read it and treat step 3 as a revision.

## 2. Explore
Dispatch Explore agents (`model: sonnet`) in parallel, split by area the PRD touches. Each returns: existing modules and their interfaces, patterns to follow, test layout and runner, files likely to change, and refactors that would make the change easier (prefactoring). Use `path:line` evidence.

**Done when:** you can name, for each FR, the files and seams it lands in.

## 3. Write plan.md
Write `docs/sdlc/plans/<slug>/plan.md` from `${CLAUDE_PLUGIN_ROOT}/templates/plan.md`, keeping every `## ` heading. Apply these slicing rules:

- **Vertical:** each task is a narrow, complete path through every layer (schema, API, UI, tests). A horizontal layer alone is never a task.
- **Demoable:** each task can be shown or verified by itself.
- **Right-sized:** each task fits one fresh context window. Split further when it would not.
- **Prefactor first:** refactors that ease the work come as the earliest tasks.
- **Wide-refactor exception:** one mechanical change with a codebase-wide blast radius (a rename, a retyped shared symbol) runs as expand, migrate in batches by directory or package, then contract. Each batch is its own task, blocked by the expand; the contract task is blocked by every batch.
- **Phases** are demoable milestones; the first phase proves the thinnest end-to-end path.
- **Parallel by default:** disjoint `scope` globs, minimal `blocked_by`. A task depends only on tasks that genuinely gate it. Two tasks touching the same files get an edge between them.
- **Complexity:** `simple` (mechanical, 1-2 files), `standard` (default), `complex` (architecture judgment, unclear root cause, broad integration).
- **Coverage:** every FR is in some task's `covers`, or listed under `## Deferred requirements` with a reason.

Under `## Phases` put exactly one `yaml cairn-tasks` block, then one `### Task: <id>` section per task with **Interfaces** (consumes / produces exact signatures), **Test cases** (Happy / Unhappy / Security bullets, each a concrete test with input and expected result), and **Done when**. Unhappy and security cases come from the PRD's unhappy paths and security considerations.

Fill **Global constraints** with PRD values verbatim and **Review focus** with the five likeliest failure modes the tasks do not test directly; add a test for each to the owning task.

**Done when:** every task has all three subsections with concrete tests, every FR is covered or deferred, and the task list passes your own check for scope overlap between tasks that could run together.

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

Run `cairn status --json` and read `modActive`.
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
