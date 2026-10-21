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

### 9. How is the drift verdict kept honest?
**Decision:** The direction report contains a fixed yaml cairn-direction scorecard: one row per covered requirement with verdict and path:line evidence, plus unplanned and NFR rows. cairn evidence phase takes no color; it parses the scorecard, refuses if a covered requirement is missing or lacks evidence, and computes green, yellow, or red by the rules.
**Why:** The model cannot mislabel the verdict; individual rows are specific claims the user sees at the stop.
_2026-10-20 21:20_

### 10. Builder-check resolutions folded into the PRD
**Decision:** Yellow is approvable because the approval itself is the explicit human choice; red blocks. Approval ordering: the mod runs cairn approve inside the AskUserQuestion tool hook before the result returns, so the model sees the approval already recorded. Approval tags carry the plan slug. Stop now aborts the main turn at once and has the agent stop background subagents on its next turn (no API exists to stop them directly). Pause keeps existing open questions in handoff.md. The direction verdict records the plan branch commit; approve phase refuses if code outside docs/sdlc changed since. Fix-track file count is the committed diff from the slice base; escalate rewrites the fix slice scope to its changed files. Repro is excluded from the pre-approved cairn commands so the user sees each repro command in the normal permission prompt. Fix-track stages are repro, execute, review, ship, closed.
**Why:** Answers from existing decisions and API facts; no new product calls needed.
_2026-10-20 21:20_

### 11. How does the mod guard against misleading approval menu wording?
**Decision:** The mod approves only when the selected label is exactly Approve or Approve (Recommended), the tag plan and kind match the stop actually waiting in state, the answer read is the one for the tagged question, and the dialog was not auto-answered while the user was away. No extra confirm dialog.
**Why:** One click per stop; the residual risk is a model labeling an option exactly Approve at the right stop.
_2026-10-20 21:23_

### 12. Review-lens resolutions folded into the PRD
**Decision:** Every override needs the same human proof as an approval, granted by a tagged Override menu answer or a terminal run. The mod authenticates to the CLI with a per-session secret instead of a fixed value. Guards deny by default any Bash command that mentions plan state, the secret, or a cairn approval, allowing only a short read list, and cover every tool by canonical path; guard errors deny. Child commands run with the secret removed from their environment. A change to the repo config commands after plan approval blocks running them. A re-plan or a later code commit invalidates a drift verdict; decision 10 supersedes decision 4 on yellow. The drift check includes the product PRD when present. Stdin input is dropped because the worktree guard parses heredoc text like arguments. The fix-track record cap stays at 300 words.
**Why:** Applies the security, feasibility, coherence, testability, and scope review findings that follow from earlier decisions.
_2026-10-20 21:23_

### 13. How does the orchestrator relate to plan and slice worktrees?
**Decision:** The orchestrator session runs from the repo root without a worktree lock and runs cairn from the plan worktree with cd. A worktree-locked session blocks its subagents from editing and committing in slice worktrees. Dogfood finding: new.md must stop entering the plan worktree with EnterWorktree; added to the dogfood phase at the next re-plan.
**Why:** Implementers were blocked in the first parallel phase; the scope guard and drift logging still police what each slice touches.
_2026-10-20 21:32_

### 14. How are the mod secret and overrides kept out of the model's reach?
**Decision:** Only a SHA-256 hash of the mod secret is stored on disk; the mod keeps the secret in memory and generates a new one (and a new hash) after each use. Override grant files are removed: when the user picks Override, the mod records a pending override for that plan (10 minutes); when the model next runs a cairn command with --override for that plan, the mod runs it itself with the secret and returns the CLI output as the tool result. FR-02a is renamed FR-34 so the coverage check tracks it.
**Why:** A broad search could pull a plaintext secret into the model context, and a script could forge a grant file; with a hash on disk and mod-run overrides there is nothing usable to read or forge.
_2026-10-20 21:59_

### 15. Engine limit: one unmatched session.start hook per module
**Decision:** The approval secret hash is written lazily before first use, not at session start. Pause and pane need session start too, so register.tsx gets a single session.start fan-out that calls each module; added to those slices at the phase-end re-plan. Re-plan bug: carrying slice progress across a re-plan dropped each slice start commit; fix added to the CLI polish slice at the same re-plan.
**Why:** Found while building menu approval and closing the mod-guards slice.
_2026-10-20 23:05_

### 16. Phase 1 end: re-plan with the findings
**Decision:** Added FR-41 (slice done checks the git diff against scope and logs drift, catching Bash edits) and FR-42 (re-plans keep slice progress including the start commit) to cli-polish. Pause-resume builds the single session.start fan-out in register.tsx. Pane reuses the approve.ts secret path. Dogfood-docs rewrites cli.md for the hash design and tells review.md to run overrides alone with plain-text reasons.
**Why:** Findings from the phase 1 alignment check, the drift probe, and slice reports.
_2026-10-21 09:29_

### 17. When is the live menu-approval test run?
**Decision:** At the Verify stage, after v0.2 is merged and installed: a real menu approval, an Override, and the 0600 check in one sitting. Until then approvals use the v0.1 relayed path.
**Why:** Avoids a second terminal mid-plan; the installed plugin only becomes v0.2 after merge.
_2026-10-21 09:30_

### 18. Open items carried to later slices
**Decision:** A one-time flaky test failure (slice reported not merged in a test setup helper) is investigated at Verify. The CLI usage text in main.ts gets evidence phase in the file-input slice. references/cli.md gets evidence phase in the dogfood-docs slice.
**Why:** Reported by the drift-verdict slice; kept so nothing is lost.
_2026-10-21 09:40_

### 19. Pane follow-ups
**Decision:** Logged for Verify: the first pane refresh waits on a CLI run during session start (up to the 60 s timeout); away-answered pane confirms cannot be detected, so Cancel is listed first; live checks at 160 columns and on desktop and VS Code are still due.
**Why:** Minor items from the pane review, kept for the Verify stage.
_2026-10-21 10:08_

### 20. Phase 2 end: re-plan with the findings
**Decision:** Added slices stop-now-fix (Stop now runs pause --now itself after the abort; pause shows the clear tip) and test-flake (root-cause the 1-in-3 git invalid-object failure) to phase 3. The PRD now names the mod commands cairn-pane, cairn-approve, cairn-pause-now, cairn-pause-mod, and cairn-resume-mod because the engine forbids colons. hooks/NOTES.md joins the dogfood-docs slice.
**Why:** Phase 2 alignment check and test runs.
_2026-10-21 10:11_

### 21. Move the flaky-test hunt to phase 4
**Decision:** The user stopped the 24-minute test-flake run; it moves to phase 4 with its lead: forcing a repack shows packfile index unavailable errors, pointing at background git gc or repack racing the next command in the same test repo.
**Why:** Not on the critical path; the user asked to keep moving.
_2026-10-21 11:05_

### 22. Dogfood: install cairn from the plan worktree
**Decision:** The ai-workflow marketplace now points at the plan worktree, so this session loads cairn v0.2 including the mod after reload-plugins, and every merge shows up live. At ship it must be pointed back at the main checkout before the worktree is removed.
**Why:** The user wants to see the mod in this session without a second terminal.
_2026-10-21 11:18_

### 23. Phase 3 end: re-plan with the findings
**Decision:** Phase 3 approved yellow through the mod, the first mod-recorded approval. dogfood-docs now updates fix.md to offer reopen-in-place and renames the phase-end follow-up to Start clean. cli-polish enforces keeping the fix slice id after escalate and drops the EnterWorktree hint. New mod-polish slice covers the pause placeholder, the pane repro label, and three guard false positives found live: heredoc bodies to python, inline interpreter reads of plan state, and decide prose.
**Why:** Phase 3 direction report and the first live mod approval.
_2026-10-21 11:20_

### 24. Open item for Verify: skill permission list format
**Decision:** Skills now list each cairn subcommand as a quoted YAML list under allowed-tools. claude plugin validate accepts it; Verify must confirm Claude Code honors it (a skill runs cairn status without a permission prompt, and repro still prompts).
_2026-10-21 11:49_

### 25. Follow-ups from the cli-polish review
**Decision:** Logged for Verify or a later fix plan: the recorded test summary is the last count line (node prints fail 0 last), so prefer the pass line; drift re-flags a path already reviewed from the edit hook; cairn resume still suggests EnterWorktree; a sandboxed repro timeout cannot kill descendants when setpgid is refused.
**Why:** Minor review items, kept so they are not lost.
_2026-10-21 11:54_
