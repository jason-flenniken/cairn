# Decisions: cairn v0.2

Append-only. Written by `cairn decide` as each decision is made.

### 1. How are approvals proven to come from the user?
**Decision:** The mod watches the answer to the approval menu (question tagged cairn:approve KIND) and runs cairn approve itself with CAIRN_APPROVER=mod, recorded as via human. A pane button and a /cairn:approve command also approve. The mod denies Bash calls by the model to cairn approve and model edits to state.json. The CLI refuses approve without CAIRN_APPROVER=mod unless overridden.
**Why:** Keeps the familiar menu flow while stopping the model from approving by mistake or drift. Not meant to be tamper-proof against a determined attacker.
_2026-10-20 21:05_

### 2. When does the pane open and what does it show?
**Decision:** Auto-opens at session start in a plan worktree when the terminal is 144+ columns; otherwise /cairn:pane opens it. Shows the current plan stage, phase and slice tree with substeps and fix rounds, drift, and the stop waiting on the user, plus other active plans in a compact list. Refreshes when state.json changes (polled every 2s). Buttons: Approve (only at a stop), Pause, Stop now, Resume, Status. The status line always shows the one-line summary.
**Why:** Visible by default where it matters without crowding repos that have no plans.
_2026-10-20 21:05_

### 3. What do Pause, Stop now, and Resume do, and how are long pauses kept cheap?
**Decision:** Pause is instant: the mod writes handoff.md from state (in flight, substeps, next action) and runs cairn pause, even mid-turn; running slices finish only their current step and nothing new starts; the agent appends open questions when it notices. Stop now also stops running subagents at once so nothing bills while paused. Resume continues in place when the pause is shorter than the cache window (config, default 60 min); after that the Resume button and /cairn:resume tell the user to /clear (or open a new session) and then /cairn:resume, which loads only state, handoff, and session-start status. At pause time the mod shows a tip that /clear is safe because the handoff has everything.
**Why:** A paused idle session costs nothing, but resuming after the prompt cache expires re-reads the whole conversation; a complete handoff makes the conversation disposable.
_2026-10-20 21:07_

### 4. How thorough is the end-of-phase drift check and can it block?
**Decision:** Full adaptation of the Vercel direction command: each requirement the phase covers is aligned, partial, missing, or contradicted with path:line evidence; unplanned code is classed as pulled forward, unplanned, non-goal breach, or supporting; NFR and doc drift are checked; a scorecard and an overall green, yellow, or red verdict is recorded in state. Red (contradicted or missing core requirement, non-goal breach, broken security NFR) refuses phase approval unless overridden; yellow needs the explicit choice of the user. Also runnable anytime as /cairn:direction.
**Why:** Drift is caught at each phase with evidence, and the worst cases cannot slip through silently.
_2026-10-20 21:08_

### 5. How does the fast lane work?
**Decision:** A fix plan (cairn new --track fix) follows a short sequence: repro, fix, review, ship, closed. cairn repro CMD must exit non-zero to be recorded. The single fix slice can only be marked done when that same command passes and the full suite is green. Review is the slice review plus a security pass on the diff. One stop at the end (ship?), with a short RECORD.md (bug, cause, fix, evidence). If the fix touches more than 8 files (config fixMaxFiles) or new requirements appear, the CLI refuses and offers cairn escalate, which converts it to a feature plan at the PRD stage keeping the repro and the work.
**Why:** Bugs get the same discipline (repro first, review, tracked in the pane) without four approval stops for a one-line change.
_2026-10-20 21:08_

### 6. Do dogfood findings go into this plan?
**Decision:** Yes, as a final dogfood-fixes phase. Known items: decision and note text can be passed through a file or stdin so quoting never trips the worktree guard; each phase end offers a clean start (clear, then cairn next) since handoff and state carry everything. New findings are added by re-plan, which keeps progress.
**Why:** Running cairn on itself is the test; what it finds should be fixed in the same plan.
_2026-10-20 21:08_

### 7. How are stops approved when the mod is not running?
**Decision:** cairn approve KIND --human works only in an interactive terminal (a real TTY) and asks the user to type the plan name to confirm; recorded as via human (terminal). The model Bash tool has no TTY, so it cannot do this. When the mod is not loaded, the stop menu tells the user the exact command.
**Why:** Keeps approvals provably human in claude -p, mods-disabled, or older Claude Code sessions.
_2026-10-20 21:09_

### 8. What is out of scope for v0.2?
**Decision:** Breaker, first-timer, and acceptance-runner agents and the fixed review roster (v0.3); Linear mirror, structured learnings, and roadmap generation (v0.4); the pane on mobile or in claude -p (status line and /cairn:status cover those). Users: a single developer. Data: state.json gains phase direction verdicts, the fix-track repro record, and approval source; no migrations beyond defaults. Performance: pane polls state.json every 2s and must not slow the session.
**Why:** Confirmed v0.2 scope from docs/design.md; recorded so the PRD non-goals and NFRs are explicit.
_2026-10-20 21:09_
