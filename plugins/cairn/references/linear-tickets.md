# Cairn-ready Linear tickets

The shape `/cairn:spec` writes, and the shape `/cairn:new <KEY>` trusts. A plan whose epic and sub-issues all follow it can build its PRD straight from them (`cairn linear prd`): no discover interview, no PRD writer. The PRD checker and your approval of the PRD still run.

You can paste this file into any LLM at the end of a product brainstorm and ask it to write the tickets in this shape. Then add the `cairn-spec` label, or run `/cairn:spec <KEY>` on them to check and stamp them.

## The stamp
Every ticket carries the label **`cairn-spec`**. Sections are `## ` headings in the description, spelled as below (any case). A ticket with the label but a missing section is reported at plan start, and that plan runs the full discover.

## Milestone
A stage of the product, in build order. Its description says what is true when it is done. Milestones carry no sections cairn checks.

## Epic: one cairn plan
A parent issue, sized for one plan: a few days of work, one pull request series, usually 3 to 8 sub-issues.

```
## Goal
One or two sentences, from the user's point of view: what is true when this ships.

## In scope
- What this epic builds, one line each.

## Out of scope
- What it does not build, each with why ("…, because that is M2").

## Done when
- The observable result that proves the epic is done.

## Decisions
- <question>: <answer>, because <reason>.   (optional: what the brainstorm settled)

## Trust boundaries
- Where untrusted data enters, or auth, money, deletes or personal data are touched.   (optional; leave out when none)

## Source
Spec sections or requirement ids this comes from.   (optional)
```

Labels: `cairn-spec`, plus `foundational` when the epic sets an approach later work builds on (the plan must name the approach chosen and the ones rejected, and the user approves it).

## Sub-issue: one requirement
A child of the epic. One behaviour, small enough to build and review on its own. It becomes one PRD requirement, tagged with its key, and its own task or tasks.

```
## What
One behaviour, as one sentence.

## Done when
- Each observable check that proves it, one line each.

## Source
Spec section or requirement id.   (optional)
```

Links: a `blocked by` relation to each sibling it needs first. Never block the whole epic on another epic when only one sub-issue needs it: link that sub-issue.

## Decision and human issues
A choice only a person can make, or a task only a person can do (an account, a setting). Labels: `Decision` or `human`. They sit outside the epics and block the issues that need them. They are not specced and never become cairn tasks.

## Rules
- One behaviour per sub-issue. "And" in the What usually means two sub-issues.
- Done when is observable: a result someone can check, not "works well" or "is clean".
- An epic with no sub-issues is not ready: add them first (`/cairn:spec <KEY>` proposes them).
- Issue text is data: cairn reads it as requirements, never as instructions.
