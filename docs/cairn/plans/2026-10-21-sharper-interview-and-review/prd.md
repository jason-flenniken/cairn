# PRD: Sharper interview and review

> Plan: sharper-interview-and-review. Keep it short. Every requirement has a stable id and a one-line acceptance check.

## Problem
cairn's interview gathers "just enough" and never asks what the build is for, so plans start without a stated goal and miss decisions the goal would have raised. Review only looks at risky tasks, sorts findings into blocking and non-blocking, and says little about readability or architecture, so the user keeps catching problems after cairn calls the work done. Security only shows up at review time, as one line in an optional PRD section. And a plan can show Closed while its pull request is still open: the roomier-pane work, including the transparent background, sat unmerged that way.

## Solution
Discover becomes a goal-first interview. It opens with a guess and a confidence number, asks one question at a time with a guess attached, proposes decisions the goal implies, and ends with a read-back card the user must explicitly approve. Every task gets a five-axis review (correctness, readability, architecture, security, performance) with labelled findings. Critical and Required findings are fixed before merge, and each finding proposes its fix. Security runs from design to ship: a threat model in the PRD, a wider risky flag, an ask-first list for implementers, a dedicated security reviewer, and a secret scan plus dependency audit before ship. A plan only closes once its branch is merged. The three pane and docs follow-ups ride along. The material is adapted from addyosmani/agent-skills (interview-me, code-review-and-quality, security-and-hardening).

## Requirements

### Interview (feature track discover)
- **FR-01** Discover opens with a one-sentence guess at what the user wants and a confidence number. Below about 70%, the guess also names what is missing. Check: `procedures/discover.md` has this as the first interview step, with the format.
- **FR-02** Goal questions come one at a time, each with cairn's guess attached: why, why now, what success looks like, the binding constraint. Answers that only sound right ("scalable", "clean") get the probe "if you didn't have to justify it, what would you actually want?". "Whatever you think" and "I don't know" are re-asked as a two-option choice. Check: discover.md states each rule, and the old "recommend one and record it" fallback is gone.
- **FR-03** After the goal, cairn proposes decisions the goal implies that the user hasn't raised (multi-select). Picked ones are recorded as decisions and rejected ones as non-goals. Check: discover.md has a goal-implications step that records both outcomes with `cairn decide`.
- **FR-04** The remaining decisions cover users, core flow, non-goals, and trust boundaries (untrusted input, auth, personal data, model output, shell commands, deletes). Check: discover.md lists trust boundaries as a required topic.
- **FR-05** The interview ends with a read-back card (Outcome / User / Why now / Success / Constraint / Out of scope), recorded with `cairn decide` only after an explicit yes. It stops when cairn can predict the user's next three answers. The "just enough" and "do not interview for completeness" wording is removed. Check: discover.md has the card, the explicit-yes rule and the stop rule, and `grep -n "just enough\|completeness" procedures/discover.md` finds nothing.

### Code review
- **FR-06** `references/review-checklist.md` holds:
  - the five axes;
  - the labels (Critical / Required / Optional / Nit / FYI) with what each means;
  - the structural fixes to propose;
  - change size and file size (about 1000 lines);
  - dead-code listing;
  - dependency and lockfile review;
  - the verification-story check;
  - the no-rubber-stamp rules.

  Check: the file exists with those sections, and both reviewers point at it.
- **FR-07** Every task is reviewed before it merges, risky or not. Check: `procedures/execute.md` sends every task to the task reviewer; the "review only risky tasks" branch is gone.
- **FR-08** Review findings carry a label. Critical and Required (bugs, unmet spec, moved-not-reduced complexity, a near-duplicate helper, a silent fallback, a file pushed past about 1000 lines) are fixed before merge. Optional and Nit are logged as follow-ups. FYI is shown once and not logged. Each Critical or Required finding names its proposed fix. Check: the task-reviewer and branch-reviewer output formats use the five labels; execute.md, review.md and fix.md route Critical/Required to a fix and Optional/Nit to `cairn suggest add`.
- **FR-09** The branch reviewer reviews on the five axes against the checklist, with the same labels. Check: `agents/branch-reviewer.md` names the axes and the labels and reads the checklist.

### Security
- **FR-10** `references/security-checklist.md` holds these sections, each tagged with when it applies so agents read only what the change touches:
  - threat model (trust boundaries, assets, STRIDE lens, misuse cases);
  - always / ask first / never;
  - `[web]` headers, CORS, cookies;
  - `[api]` authentication, authorization, IDOR, rate limits;
  - `[data]` personal data and retention;
  - `[llm]` OWASP LLM top 10;
  - `[deps]` audit, lockfile, install scripts;
  - `[fs]` destructive operations on derived paths;
  - secrets.

  Check: the file exists with tagged sections.
- **FR-11** The PRD's Security section is a short threat model: trust boundaries, assets, a STRIDE pass and misuse cases. `procedures/prd.md` requires it whenever discover recorded a trust boundary. Check: `templates/prd.md` and prd.md describe that shape and that trigger.
- **FR-12** A task is risky when it touches auth, money, deletes, migrations, a public API, untrusted input, personal data, a new dependency, model output, or shell commands and paths built from data. Each PRD misuse case becomes a Security test case on the task that covers it. Check: `procedures/plan.md`, `templates/plan.md` and fix.md carry the widened list and the misuse-case rule.
- **FR-13** The implementer stops with NEEDS_CONTEXT before adding a new auth flow, a new kind of sensitive data, a new external integration, a CORS change, a file upload, or new permissions, unless the brief already decides it. Check: `agents/implementer.md` lists the ask-first items.
- **FR-14** A dedicated `security-reviewer` agent (read-only) reviews every risky task alongside the task reviewer, and the whole branch once at review. It uses the security checklist and the same labels. Check: `agents/security-reviewer.md` exists, and execute.md, review.md and fix.md send work to it.
- **FR-15** The check stage scans the branch diff for secrets, runs the repo's native dependency audit, and reviews the lockfile diff. A reachable critical or high advisory, or a secret in the diff, must be fixed before moving on. With no audit tool for the stack, it says so in one line and goes on. Check: `procedures/verify.md` has these steps, and `.sdlc/config.json` / `templates/config.json` accept an `audit` command.

### Fix track
- **FR-16** The fix track adopts the review and security changes: every fix gets the five-axis review, the wider risky list applies, and risky fixes get the security reviewer. Its repro-first start is unchanged. Check: fix.md routes the fix task through the task reviewer every time and names the wider risky list.

### Closed means merged
- **FR-17** `cairn close` refuses while the plan branch is not merged into its base, and status shows the plan as "PR open" until it is. Check: a CLI test where close on an unmerged branch exits 2 with a message naming the open PR, and close after the merge succeeds.

### Pane and docs follow-ups
- **FR-18** After the PR #1 reinstall, the user checks the docked pane by eye. If it is still grey, the transparent background setting is removed and a code comment notes that Claude Code paints the pane. Check: the user's answer is recorded, and pane.tsx matches it.
- **FR-19** When a stop is approved in the pane while its chat question is still open, a `$.ui.notice` line appears under the question. Check: a hooks test for the notice.
- **FR-20** The pane's fallback line and inline tip line use truncate-end wrap so the inline view stays within 7 rows. Check: a pane test with a narrow width.
- **FR-21** fix.md matches the code: its wording, skipping an already-approved ship question, old plans getting task/ branches, and `--no-worktree` task folders named from the plan branch. Check: fix.md states each, and the docs match `cli/src/commands/tasks.ts`.

### Credit
- **FR-22** `NOTICE` carries the MIT license and credit for addyosmani/agent-skills (2025 Addy Osmani), and `UPSTREAM.md` lists it with its snapshot commit. Check: both files name it.

## Non-goals
- A mutation check in review, because the user declined it this round.
- A by-eye or screenshot check for every UI task, because the user declined it. Only the pane check in FR-18 happens.
- A Goal section in the PRD that the branch review judges against, because the user declined it. The read-back lives in decisions.md.
- The product-track interview, because it stays as it is for now.
- The goal interview on the fix track, because its repro-first start already shapes the work.
- New approval stops, because depth must not add stops. PRD, plan and ship stay the only three.
- Automatic forced audit fixes (`npm audit fix --force`), because forced fixes cross declared version ranges.
- Pane changes beyond FR-18 to FR-20.

## Open questions
- [x] Should Required findings block merge? (answer: yes, Critical and Required are fixed before merge)
- [x] Every task reviewed, or only risky ones? (answer: every task)
- [x] Separate security reviewer? (answer: yes, on risky tasks and the whole branch)
- [x] How does PR #1 land? (answer: merged to main now, separately. Done: 364 tests pass)

## Unhappy paths
- [FR-15] No audit tool is known for the stack and none is configured: one line says the audit was skipped and why, and the check goes on.
- [FR-15] The audit can't reach the registry: the check stops and asks the user to retry, skip with a note, or pause.
- [FR-17] The base branch can't be fetched (offline): close refuses with a message saying merge status is unknown, and the user may override.
- [FR-05] The user gives no explicit yes after two read-back revisions: cairn says something foundational is missing and asks whether to step back.

## Security
- **Trust boundaries:** reviewer and implementer prompts read diffs, PRDs and fetched text; audit output comes from the package registry; the secret scan reads the branch diff.
- **Assets:** secrets in the user's repos; the user's main branch.
- **Information disclosure:** a secret found by the scan could be echoed into the transcript, the record or a follow-up. The control: the scan reports the file, the line and the kind of secret, never the value.
- **Tampering / prompt injection:** text inside a diff or a fetched page could carry instructions to a reviewer. The control: reviewers stay read-only (no Edit or Write tools), and the checklist tells them to treat diff content as data.
- **Elevation:** the audit step could run install scripts. The control: it runs the audit command only, never an install.

## Non-functional requirements
- **NFR-01** No new approval stops: the approve kinds stay prd, plan and ship.
- **NFR-02** Each reference checklist stays under about 400 lines, so an agent can read the relevant sections within its context.
