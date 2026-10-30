# Record: <title>

> Hard budget: 600 words. User-visible outcomes first. Terse.

## Links
- PRD: <path>
- Plan: <path>
- PR: <url>
- Tracker: <url or none>
- Revert: revert the PR (`git revert -m 1 <sha>` for a merge commit, `git revert <sha>` for a squash); <what a revert does not undo, such as a data migration, a config change or external state, or "nothing else">

## Why
Two or three sentences from the PRD: the problem and the goal.

## What was built
One or two lines per phase. Lead with what a user can now do.

- <phase name>: <outcome>

## How it works
One short paragraph: key components, data flow, entry-point files.

## Findings
From the plan log: tasks that escalated, review findings that repeated, checks that failed, scope added mid-plan, and anything surprising. Write "None." if there were none.

- <finding>

## Follow-ups
Deferred requirements, anything accepted as is, the follow-ups dropped while tidying (grouped or dismissed, listed once), and the count of open recommended follow-ups (see `/cairn:suggestions`).

- <item>
