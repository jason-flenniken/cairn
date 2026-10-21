# Plan: Standard branch names

> Source: prd.md. Each task is a thin, complete path through every layer, demoable on its own, and fits one context window.

## Goal
New plans run on `feature/<slug>` or `fix/<slug>` with task branches on `task/<slug>/<task>`, while old `sdlc/` plans keep working.

## Architecture
All branch names are built and parsed in `plugins/cairn/cli/src/locate.ts`: `planBranch`, `taskBranch`, and `parseBranch`. Plans are listed in `commands/status.ts` `listPlans`. Both currently assume one `sdlc/` prefix.

The change has three parts:
- **Recognise every prefix, build new names from the track.** `locate.ts` gets the plan prefixes `feature/` and `fix/` plus legacy `sdlc/`, and the task prefixes `task/` plus legacy `sdlc-task/`. `planBranch(slug, track)` builds new names only.
- **Existing plans use their stored name.** Every lookup for an existing plan reads the branch recorded in `state.branch` (and `task.branch` for tasks) instead of rebuilding it, so old plans keep their names.
- **A plan is recognised by its files, not its branch name.** `context()` only treats the current branch as a plan when that plan's `state.json` exists. `listPlans` scans the three plan prefixes and keeps branches that hold a `state.json`.

Worktree folders are named after the branch with `/` as `-`. A task folder is the plan's folder name plus `--<task>`.

## Global constraints
- Slugs stay `^[a-z0-9]+(-[a-z0-9]+)*$` (`util.ts` `SLUG`), so `--` stays an unambiguous separator in folder names.
- `PLANS_DIR` (`docs/sdlc/plans`) and the plan file layout don't change.

## Phases
One phase. The three tasks touch disjoint files and run in parallel.

```yaml cairn-tasks
phases:
  - id: rename-branches
    name: Standard branch names
    tasks:
      - id: cli-branches
        name: CLI branch names and plan discovery
        covers: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06, FR-07]
        blocked_by: []
        scope: ["plugins/cairn/cli/**", "plugins/cairn/dist/**"]
        complexity: standard
        risky: false
      - id: pane-watch
        name: Pane notices plans on the new prefixes
        covers: [FR-08]
        blocked_by: []
        scope: ["plugins/cairn/hooks/**"]
        complexity: simple
        risky: false
      - id: docs-names
        name: Docs and procedures use the new names
        covers: [FR-09]
        blocked_by: []
        scope: ["README.md", "plugins/cairn/procedures/**", "plugins/cairn/references/**", "plugins/cairn/skills/**"]
        complexity: simple
        risky: false
```

### Task: cli-branches

**Check:** In a scratch repo, `cairn new billing` checks out `feature/billing` in `.claude/worktrees/feature-billing`, and `cairn new crash --track fix` checks out `fix/crash`. `cairn task start` creates `task/billing/<id>`. A hand-made `feature/other` with no plan files is left out of `cairn status --all`, and `cairn status` on it shows the index. `cairn new billing --track fix` is refused because `billing` exists. Existing `sdlc/` fixtures still pass. `npm run build && npm run typecheck && npm test` pass.

**Interfaces**
- Consumes: none
- Produces:
  - `planBranch(slug: string, track: Track): string`, used only by `cairn new`.
  - `taskBranch(slug, task)` returns `task/<slug>/<task>`.
  - `parseBranch` accepts `feature/`, `fix/`, `sdlc/`, `task/`, and `sdlc-task/`.
  - `planRef(slug, wts)` matches a worktree by parsed slug.
  - `listPlans` scans `refs/heads/{feature,fix,sdlc}/`.
  - `worktreeName(branch)` turns `/` into `-`.
  - Call sites that rebuilt the branch (`commands/tasks.ts`, `commands/pause.ts`, `locate.ts` `requirePlan` message) read `state.branch` instead. `status.ts` drops its hardcoded `'sdlc/'.length`.
  - Tests: update fixtures that expect new-plan names to `feature/…` and `task/…`. Keep the fixtures that build legacy `sdlc/` states as they are (they cover FR-06). Add assertions to existing lifecycle tests for the hand-made-branch case and the duplicate-slug refusal.

### Task: pane-watch

**Check:** The pane's poll signature includes `refs/heads/feature`, `refs/heads/fix`, and `refs/heads/sdlc` under the git common dir, a missing folder doesn't break the poll, and `npm run test:mod` passes with the fixtures' branch and worktree names updated where they model new plans.

**Interfaces**
- Consumes: `cairn status --all --json` (unchanged shape)
- Produces: `watched()` in `hooks/mod/pane.tsx` returns the three ref folders. Fix the stale `sdlc-task-cart` worktree names in `hooks/test/pause.test.ts`.

### Task: docs-names

**Check:** `grep -rn "sdlc/<slug>\|sdlc-task/" README.md plugins/cairn/procedures plugins/cairn/references plugins/cairn/skills` finds only notes about legacy plans.

**Interfaces**
- Consumes: the names above
- Produces:
  - README "Where things live" and Quick start updates.
  - `references/cli.md` "Where things live" and current-plan detection.
  - `procedures/new.md` step 1, `procedures/execute.md` (plan branch, task merge `git merge --no-ff <task branch>` from `cairn task start`'s output), and `procedures/ship.md` (`gh pr create --head <state.branch>`).
