# Record: Standard branch names

## Links
- PRD: docs/sdlc/plans/standard-branch-names/prd.md
- Plan: docs/sdlc/plans/standard-branch-names/plan.md
- PR: none (local repo, no remote; merged locally into main)
- Tracker: none

## Why
cairn named its branches `sdlc/<slug>` and `sdlc-task/<slug>/<task>`, which read as tool plumbing in a branch list or PR. New plans now get standard names, and plans already running under the old names keep working. While the work was underway, the pane's approval card was also reworked, because it appeared before there was anything to approve.

## What was built
- **Standard branch names:** new plans use `feature/<slug>` or `fix/<slug>`, and tasks use `task/<slug>/<task>`. Worktree folders are named after the branch. Your own hand-made branches are never mistaken for plans. Old `sdlc/` plans still work; this plan itself ran on `sdlc/standard-branch-names`.
- **Approvals you can see** (added after PRD approval, at your request):
  - The pane's Approve card appears only when an approval would pass, and shows what is being approved, with a Read all button.
  - Approving in the pane answers a later chat question for the same stop automatically.
  - Clicking an agent card switches to that agent's conversation.
  - Each approval produces one note.

## How it works
Branch names are built and parsed in `plugins/cairn/cli/src/locate.ts` (`planBranch`, `taskBranch`, `parseBranch`, `recordedBranch`, `planBranchesFor`). `listPlans` in `plugins/cairn/cli/src/commands/status.ts` scans `refs/heads/{feature,fix,sdlc}/` and keeps a branch only when it matches the branch the plan recorded. Readiness comes from `readyFor` in `plugins/cairn/cli/src/commands/stages.ts` and is exposed as `ready` in the status JSON. The mod (`plugins/cairn/hooks/mod/pane.tsx`, `approve.ts`) draws the card from `ready` and approves through the existing secret path.


Evidence: the check passed (147 CLI tests, 331 mod tests, build clean). All 15 requirements are met, with 3 test gaps logged. One whole-branch review found 2 blocking issues. Plan lookup matched on the name alone, so a hand-made branch sharing a plan's name could be taken for the plan. That is fixed by keying lookups on the recorded branch, with tests. The riskiest task (pane approvals) got its own review and passed.

## Follow-ups
17 open recommended follow-ups (7 tests, 4 quality, 3 docs, 2 ux, 1 perf): run /cairn:suggestions. Notable ones:
- A chat approval question already open when you approve in the pane stays open. No engine API to close it was found.
- The test run inside `cairn task done` failed intermittently twice and passed on rerun.
- Old `sdlc/` plans get new `task/` task branches.
- A hand-made `task/<slug>/x` branch can still be taken for a task of a merged plan.
