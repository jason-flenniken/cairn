# PRD: <title>

> Plan: <slug>. Keep it short. Every requirement has a stable id and a one-line acceptance check.

## Problem
The problem, from the user's point of view. Two to five sentences.

## Solution
The solution, from the user's point of view. What changes for them.

## Requirements
One testable behavior each, with how you will know it works. On a plan that pulled in Linear issues, a requirement that comes from a ticket ends with its key in square brackets, for example `[SAV-102]`.

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
Optional, but required when discover recorded a trust boundary. A short threat model (see the Threat model section of `references/security-checklist.md`).

- Trust boundaries: <where data enters or leaves, and what is untrusted>
- Assets: <what an attacker wants>
- STRIDE: <per boundary, the letters that apply (Spoofing, Tampering, Repudiation, Information disclosure, Denial of service, Elevation of privilege) and the control for each>
- Misuse cases: <how someone would abuse this, and the control>. Each becomes a Security test on the task that covers it.

## Hard parts
Optional. Only when research or the interview named some: concurrency, security-critical logic, data migrations that cannot be undone, novel algorithms, cross-cutting changes with no existing pattern. The plan decides which tasks get an Opus builder.

- <where> because <reason>

## Non-functional requirements
Optional. Only when a number matters (speed, size, compatibility).

- **NFR-01** <measurable constraint>

## User stories
Optional. Only when several actors have different needs.

## Issues not taken
Optional. Only on a plan that pulled in Linear issues. Every imported issue is tagged on a requirement (end the requirement with its key, `[SAV-102]`) or listed here with a reason. A parent issue with sub-issues in the plan needs neither.

- SAV-104: <reason, for example "later plan">

## Outside blockers
Optional. Only on a plan that pulled in Linear issues. One line for each issue outside the plan, not done in Linear, that blocks an in-plan issue: what was decided (pulled in, blocked issue left out, or going ahead and why).

- SAV-90: <decision and reason>
