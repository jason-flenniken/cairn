# Model tiers

Every `Agent` dispatch passes an explicit `model`. An omitted model inherits the session's most expensive one.

## Slice complexity to model

| Complexity (plan) | Model |
|---|---|
| simple | haiku |
| standard | sonnet |
| complex | opus |

## Role defaults

| Role | Model |
|---|---|
| implementer | the slice's complexity tier |
| slice-reviewer | sonnet |
| Explore (research) | sonnet |
| builder-check, doc-reviewer, acceptance-checker, recorder | sonnet |
| branch-reviewer | opus |

## Start low, escalate on evidence
- Start one tier lower than instinct says when a slice sits between two tiers.
- Escalate one tier when an agent returns BLOCKED, returns NEEDS_CONTEXT twice for the same slice, or produces work the reviewer rejects twice for the same reason.
- Fix rounds 4 and 5 use a fresh implementer one tier above the slice's complexity (opus stays opus).
- State the escalation to the user in one line: what moved up a tier and why.
