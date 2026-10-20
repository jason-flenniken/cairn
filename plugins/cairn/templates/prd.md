# PRD: <title>

> Plan: <slug>. Every requirement has a stable id. Acceptance criteria and unhappy paths cite those ids.

## Problem
The problem, from the user's point of view. Two to five sentences.

## Solution
The solution, from the user's point of view. What changes for them.

## User stories
1. As a <actor>, I want <capability>, so that <benefit>.
2. ...

Cover every actor and every path. This list is long on purpose.

## Functional requirements
Each requirement is one testable behavior.

- **FR-01** <the system does X when Y>
- **FR-02** ...

## Non-functional requirements
Performance, security, accessibility, privacy, compatibility. Give numbers.

- **NFR-01** <measurable constraint, for example "p95 cart load under 300 ms">

## Inherited constraints
Optional. Pulled from `docs/sdlc/product/PRD.md` when present: non-goals, NFRs, and must-not-trade-off items that bind this plan.

- <constraint, with its source>

## Non-goals
What this plan will not do, each with a one-line reason.

- <thing> because <reason>

## Acceptance criteria
Observable outcomes that prove each requirement. Cite the requirement.

- [FR-01] Given <state>, when <action>, then <observable result>.

## Unhappy paths
Every way a requirement can fail in use: bad input, missing data, denied access, dependency down, races, double submits. Cite the requirement and name the expected behavior.

- [FR-01] When <failure>, the system <exact response, message, or state>.

## Security considerations
Concrete threats for this feature and the control that answers each: authN/authZ, input handling, data exposure, abuse, secrets. Write "none, because ..." only with a reason.

- <threat>: <control>

## Testing decisions
Optional. The seams to test at, what a good test looks like here, prior art in the codebase.

## Further notes
Optional.

## Open questions
Every item is a checkbox. Approval requires all of them checked.

- [ ] <question that blocks the build>
- [x] <resolved question> (answer: ...)
