# Decisions: Sharper interview and review

Append-only. Written by `cairn decide` as each decision is made.

### 1. Which open follow-ups join this plan?
**Decision:** All three: by-eye pane check after reinstall (drop transparent if ignored; notice under an open approval question), truncate-end on the pane fallback and tip lines, and fix-track docs alignment
**Why:** They touch the same pane and procedure files this plan changes
_2026-10-21 21:10_

### 2. What is the goal of this round?
**Decision:** Interview, code review and security all matter equally; adopt the references nearly whole even if each plan takes noticeably longer
**Why:** User chose depth over speed for this round
_2026-10-21 21:10_

### 3. Where does the extra time go?
**Decision:** Both: deeper thinking (longer interview, threat model, review that proposes fixes) and fix-before-merge for Required findings, not just Critical ones; no new approval stops
**Why:** User picked thinking and loops; 'clean it up later' is no longer the default for real findings
_2026-10-21 21:11_

### 4. How are review findings labelled and which block merge?
**Decision:** Critical / Required / Optional / Nit / FYI. Critical and Required (bugs, unmet spec, structural regressions: moved complexity, near-duplicate helper, silent fallback, file past ~1000 lines) are fixed before merge; Optional and Nit are logged follow-ups; FYI shown once
**Why:** Matches the reference; Required findings are real problems, not taste
_2026-10-21 21:12_

### 5. Which tasks get a per-task review?
**Decision:** Every task gets a five-axis review (correctness, readability, architecture, security, performance) before it merges; risky tasks also get the deeper security pass
**Why:** Required findings must be fixed before merge, and they are cheapest to fix while the task is fresh
_2026-10-21 21:12_

### 6. How is security built into the flow?
**Decision:** Design-to-ship chain: discover asks about trust boundaries; PRD Security holds a threat model (boundaries, assets, STRIDE lens, misuse cases that become Security tests); risky widens to untrusted input, personal data, new dependency, model output, shell/derived paths; implementer stops and asks before new auth flows, new sensitive data, new integrations, CORS, uploads, permissions; a dedicated security reviewer on risky tasks and the whole branch; check stage runs a secret scan of the diff, the native dependency audit, and a lockfile diff review
**Why:** Security starts at design; most holes begin there
_2026-10-21 21:12_

### 7. How does the discover interview run?
**Decision:** Five steps: guess + confidence; goal questions one at a time with a guess attached (why, why now, success, binding constraint) plus a probe for answers that only sound right; goal implications (cairn proposes decisions the goal implies, user picks or rejects); decisions (users, core flow, non-goals, trust boundaries); read-back card (Outcome / User / Why now / Success / Constraint / Out of scope) needing an explicit yes. Multiple choice with the guess first; 'whatever you think' gets re-asked as a two-option choice; stop when cairn can predict the next three answers
**Why:** User wants a very interactive session that makes them think through the goal, which shapes decisions they had not considered
_2026-10-21 21:13_

### 8. Which goal implications join this plan?
**Decision:** Only 'Closed means merged': a plan cannot reach Closed while its pull request is open and shows PR open until merged. Not in this plan: by-eye checks for UI tasks, a mutation check in review, a Goal section in the PRD judged at review
**Why:** The open-PR gap is what hid the background work; the others were declined
_2026-10-21 21:14_

### 9. How does PR #1 (roomier pane visuals) land?
**Decision:** Merged to main now, separately; main merged into this plan branch (364 tests pass). User reinstalls and checks the pane by eye; the result decides whether the transparent setting stays
**Why:** Lets the user see the stranded pane work today
_2026-10-21 21:15_

### 10. Where does the review and security material live?
**Decision:** Two reference files agents read: references/review-checklist.md and references/security-checklist.md, sections tagged by context (web, api, data, llm, deps, fs) so agents read only what the diff touches; agent prompts stay short. Credit addyosmani/agent-skills (MIT, 2025 Addy Osmani) in NOTICE and UPSTREAM.md
**Why:** One place to update; CLI-only projects skip web-only checks
_2026-10-21 21:15_

### 11. Read-back: is this the intent?
**Decision:** Yes. Outcome: interview, review and security match the reference skills (goal-first interview, five-axis labelled review on every task, design-to-ship security chain). User: Jason on his own projects. Why now: he keeps catching what cairn missed; pane work sat unmerged behind a Closed plan. Success: Critical/Required fixed before merge; PRDs carry a threat model; interviews surface unraised decisions; Closed means merged. Constraint: depth over speed, no new approval stops. Out of scope: mutation check, by-eye check for every UI task, Goal section judged at review, pane changes beyond the three picked follow-ups
**Why:** Explicit yes to the read-back card
_2026-10-21 21:16_

### 12. Do the fix and product tracks follow the new rules?
**Decision:** Fix track adopts the review and security changes (every fix gets the five-axis review and the wider risky list) but keeps its repro-first start without the goal interview; the product interview stays as it is
**Why:** A fix lands on main like any change; its start is already well-shaped by the repro
_2026-10-21 21:17_

### 13. After reinstalling, is the docked pane still grey?
**Decision:** Still grey: remove the transparent backgroundColor and leave a comment that Claude Code paints the panel
**Why:** The by-eye check after the PR #1 reinstall showed no change
_2026-10-21 21:34_
