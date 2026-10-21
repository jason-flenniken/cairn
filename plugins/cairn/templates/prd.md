# PRD: <title>

> Plan: <slug>. Keep it short. Every requirement has a stable id and a one-line acceptance check.

## Problem
The problem, from the user's point of view. Two to five sentences.

## Solution
The solution, from the user's point of view. What changes for them.

## Requirements
One testable behavior each, with how you will know it works.

- **FR-01** <the system does X when Y>. Check: <the observable result that proves it>
- **FR-02** ...

## Non-goals
What this plan will not do, each with a one-line reason.

- <thing> because <reason>

## Open questions
Every item is a checkbox. Approval requires all of them checked.

- [ ] <question that blocks the build>
- [x] <resolved question> (answer: ...)

<!-- Optional sections. Add one only when it is real for this plan; delete this comment. -->

## Unhappy paths
Optional. Only the failures that matter: bad input, denied access, dependency down, double submit. Cite the requirement.

- [FR-01] When <failure>, the system <exact response or state>.

## Security
Optional. Only when the plan touches auth, money, personal data, or untrusted input: the threat and the control.

- <threat>: <control>

## Non-functional requirements
Optional. Only when a number matters (speed, size, compatibility).

- **NFR-01** <measurable constraint>

## User stories
Optional. Only when several actors have different needs.
