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
| task-reviewer (risky tasks only) | sonnet |
| Explore (research) | sonnet |
| acceptance-checker, recorder | sonnet |
| branch-reviewer | opus |

## Start low, escalate on evidence
- Start one tier lower than instinct says when a task sits between two tiers.
- Escalate one tier when an agent returns BLOCKED, returns NEEDS_CONTEXT twice for the same task, or produces work the reviewer rejects twice for the same reason.
- A task's second (last) fix attempt uses a fresh implementer one tier above the task's complexity (opus stays opus).
- State the escalation to the user in one line: what moved up a tier and why.
