# Record: Trustworthy project memory

> Hard budget: 600 words. User-visible outcomes first. Terse.

## Links
- PRD: docs/cairn/plans/2026-10-27-trustworthy-project-memory/prd.md
- Plan: docs/cairn/plans/2026-10-27-trustworthy-project-memory/plan.md
- PR: <pending>
- Tracker: none

## Why
cairn 0.6.0 organized project memory by code area: area docs plus lasting-decision files. Both went stale and nothing checked them. Memory is now plan history plus a developer-friendly changelog, since the code is the source of truth for how things work now. Level: Standard. Version 0.7.0.

## What was built
- Changelog in the CLI: every closed plan gets a short changelog entry (what, why, big rocks). `docs/cairn/OVERVIEW.md` is now that changelog, newest first, linking to each record. Plans without an entry fall back to the first sentence of their Why. New sessions start with the five newest entries.
- Remove the old memory: `cairn recall`, `cairn area skip`, `cairn decide --lasting/--promote/--replaces`, `/cairn:map`, the close-time area check and decision publishing are gone. Removed commands refuse with a plain message. Existing area and decision files are left untouched. Procedures and agents write the entry at ship (feature and fix lanes) and no longer take memory input.
- Pane: a Changelog tab lists entries with date and title emphasized. Selecting one opens its record.
- This repo: changelog entries backfilled for six earlier plans, README and CLI reference updated, old area and decision folders dropped, version bumped.

## How it works
The recorder writes `changelog.md` in the plan folder at ship, committed before the approval; after that the user owns it. `cairn render` and close read those files and build `OVERVIEW.md` (engine in `plugins/cairn/cli/src/memory.ts` and `commands/memory.ts`). The session-start hook and `cairn index` print the five newest entries. The pane tab is in `plugins/cairn/hooks/mod/pane.tsx`.

## Findings
- Discovery began as "make area docs trustworthy". The user then judged code-area memory too much and confusing, and the goal was reframed to history plus changelog (decision 17). Title and slug kept the original framing.
- The PRD was approved before the builder-check edits landed; plan approval accepted them.
- Check found one requirement unmet: the earlier plan "Roomier pane visuals" had closed on its own branch, but its last two commits never reached main. With the user's go, that branch was merged in (clean, under docs/cairn/).
- Whole-branch review found 2 Required issues, fixed and rechecked: the changelog was read from the plan folder or main instead of the checkout being rendered (close would have committed fallback sentences), and the Changelog tab lacked the Why fallback.
- Two edits outside scope: `plugins/cairn/cli/src/main.ts` (empty messages print nothing, so `cairn index` can be silent) and one assertion in `plugins/cairn/cli/test/migrate.test.ts`.
- This plan must close with the branch's own CLI (`node plugins/cairn/dist/cairn.mjs close`), not the installed 0.6.0, so no decision files are published.
- Final checks: 349 CLI and 574 mod tests pass, typecheck clean, plugin validates, bundle matches a fresh build, secret scan clean, audit shows 0 vulnerabilities.
- Time: discover 1h 3m, PRD 3m, plan 6m, build 23m, check 24m, review 10m.

## Follow-ups
- Accepted as is: none.
- 3 open recommended follow-ups (1 security, 1 ux, 1 quality): run /cairn:suggestions.
- Dropped while tidying, merged into two: "harden changelog text handling" (five security notes: symlinked changelog or record files, per-entry character cap and newline collapse, control characters in follow-up text and the openDoc title, labelling the session-start changelog as reference only) and "changelog pane polish" (one keyboard stop per entry, show the entry on the ship approval card).
- Known failing test commands: none.
