# Model tiers

Every `Agent` dispatch passes an explicit `model`. An omitted model inherits the session's most expensive one.

## Task complexity to model

The CLI works this out: `cairn task start` and `cairn task brief --role build|fix` print a `Builder:` line (model, effort when it has one, the reason when there is one). Dispatch from that line; this table is the reference behind it.

| Complexity (plan) | Model | Effort |
|---|---|---|
| simple | haiku | default |
| standard | sonnet | default |
| complex | sonnet | high |

Opus builds a task only when the plan marks it (`model: opus` with a `model_reason`, decided in discover, the PRD and the plan, or carried on a Linear ticket as `Builder: opus — <reason>`), or through the escalation rules below. A mark overrides the table and keeps the default effort.

## Role defaults

| Role | Model | Effort |
|---|---|---|
| implementer | the `Builder:` line | the `Builder:` line |
| task-reviewer (every task) | sonnet | high |
| security-reviewer (risky tasks, and the whole branch) | sonnet | high |
| Explore (research) | sonnet | default |
| acceptance-checker, researcher | sonnet | default |
| recorder | sonnet | low |
| prd-writer, plan-writer | opus | default |
| linear-sender | haiku | low |
| branch-reviewer | opus | high |
| plan-reviewer (Polished plans only) | sonnet | default |
| challenger, prd-checker (Standard and Polished) | sonnet | default |

Reviewers, recorder and linear-sender carry their effort in the agent's frontmatter (`effort:`). Pass `effort` on an `Agent` call only when the `Builder:` line names one.

The main session stays on Opus. The writers (prd-writer, plan-writer) are opus because they hold a whole document; the linear-sender is haiku because it only carries calls.

## Start low, escalate on evidence
- Start one tier lower than instinct says when a task sits between two tiers.
- Escalate one tier when an agent returns BLOCKED, returns NEEDS_CONTEXT twice for the same task, or produces work the reviewer rejects twice for the same reason.
- A task's second (last) fix attempt uses a fresh implementer one tier above the builder (opus stays opus); the fix brief's `Builder:` line says so.
- State the escalation to the user in one line: what moved up a tier and why.

## MVP plans

Plans at MVP (`level` in `cairn status --json`; see `references/levels.md`) use these instead of the rows above where they differ. Everything else stays as above.

| Role | Model |
|---|---|
| implementer | one tier below the task's complexity (simple: haiku, standard: haiku, complex: sonnet), a plan mark still wins; the `Builder:` line gives it |
| branch-reviewer | sonnet, set at dispatch |
| task-reviewer | not dispatched |
| challenger, prd-checker | not dispatched |
