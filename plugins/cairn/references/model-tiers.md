# Model tiers

Every `Agent` dispatch passes an explicit `model`. An omitted model inherits the session's most expensive one.

## Task complexity to model

| Complexity (plan) | Model |
|---|---|
| simple | haiku |
| standard | sonnet |
| complex | opus |

## Role defaults

| Role | Model |
|---|---|
| implementer | the task's complexity tier |
| task-reviewer (every task) | sonnet |
| security-reviewer (risky tasks, and the whole branch) | sonnet |
| Explore (research) | sonnet |
| acceptance-checker, recorder, researcher | sonnet |
| prd-writer, plan-writer | opus |
| linear-sender | haiku |
| branch-reviewer | opus |
| plan-reviewer (Polished plans only) | sonnet |
| challenger, prd-checker (Standard and Polished) | sonnet |

The main session stays on Opus. The writers (prd-writer, plan-writer) are opus because they hold a whole document; the linear-sender is haiku because it only carries calls.

## Start low, escalate on evidence
- Start one tier lower than instinct says when a task sits between two tiers.
- Escalate one tier when an agent returns BLOCKED, returns NEEDS_CONTEXT twice for the same task, or produces work the reviewer rejects twice for the same reason.
- A task's second (last) fix attempt uses a fresh implementer one tier above the task's complexity (opus stays opus).
- State the escalation to the user in one line: what moved up a tier and why.

## MVP plans

Plans at MVP (`level` in `cairn status --json`; see `references/levels.md`) use these instead of the rows above where they differ. Everything else stays as above.

| Role | Model |
|---|---|
| implementer | one tier below the task's complexity (simple: haiku, standard: haiku, complex: sonnet) |
| branch-reviewer | sonnet, set at dispatch |
| task-reviewer | not dispatched |
| challenger, prd-checker | not dispatched |
