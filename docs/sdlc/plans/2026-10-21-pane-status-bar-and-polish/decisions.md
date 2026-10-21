# Decisions: Pane status bar and polish

Append-only. Written by `cairn decide` as each decision is made.

### 1. Bring in follow-up: tighter pane and approval tests
**Decision:** yes
**Why:** touches the same pane files; user picked it (roomier-pane-visuals:s15)
_2026-10-21 22:13_

### 2. Bring in follow-up: tighter close and pane tests
**Decision:** yes
**Why:** touches the same pane files; user picked it (sharper-interview-and-review:s27)
_2026-10-21 22:13_

### 3. Why this round
**Decision:** Trust the pane and stop leaving it: accurate and complete enough to be the one place to watch a plan
**Why:** the header said all phases done mid-review, and spend, limits and full docs need other windows
_2026-10-21 22:16_

### 4. Why now
**Decision:** The last plan's header said all phases done while the whole-branch review and fixes were still running
**Why:** stated in the user's request with a screenshot
_2026-10-21 22:16_

### 5. What success looks like
**Decision:** Through a full plan run, never look outside the pane: stage, running work, plan spend and 5h/weekly usage are there and correct, and the full PRD/plan is readable before approving
**Why:** user's pick
_2026-10-21 22:16_

### 6. Binding constraint
**Decision:** Fit the narrow pane: everything reads cleanly at 48 columns docked, inline 7-row mode keeps working, and icons use glyphs that render in the user's terminal font
**Why:** user's pick; the docked pane is 48 columns
_2026-10-21 22:16_

### 7. CLI tracks late-stage steps (check, review, ship: running reviewers, fixing N findings, re-checking)
**Decision:** yes
**Why:** the header must be right even after a restart, not only while the pane sees live agents
_2026-10-21 22:21_

### 8. One doc viewer everywhere: full-height scrolling view with Back for PRD, plan, ship record and Records entries
**Decision:** yes
**Why:** full docs must be readable in the pane before approving
_2026-10-21 22:21_

### 9. Claude Code status line text matches the accurate pane header wording
**Decision:** yes
**Why:** one accurate story wherever cairn status shows
_2026-10-21 22:21_

### 10. Per-agent tokens and cost on cards, while running and when finished
**Decision:** yes
**Why:** spend visible where the work is
_2026-10-21 22:21_

### 11. Limit warnings: bar turns warning-colored past about 80% of 5-hour or weekly usage and shows the reset time
**Decision:** yes
**Why:** know how close you are to limits without leaving the pane
_2026-10-21 22:21_

### 12. Non-goal: plan spend saved with the plan across sessions
**Decision:** out of scope
**Why:** user declined
_2026-10-21 22:21_

### 13. Non-goal: a dollar budget cap per plan
**Decision:** out of scope
**Why:** user declined
_2026-10-21 22:21_

### 14. Non-goal: total spend and tokens in RECORD.md
**Decision:** out of scope
**Why:** user declined
_2026-10-21 22:21_

### 15. What the bar's spend counts
**Decision:** This plan, this session: cost and tokens since the plan started or was resumed in this session, main session plus its agents; resets on restart
**Why:** closest to 'this effort' without saving spend across sessions
_2026-10-21 22:21_

### 16. Card click
**Decision:** Clicking anywhere on an agent card switches the terminal to that agent; today clicking does nothing, so find and fix the cause
**Why:** user reports nothing happens on click, though the code calls the switch
_2026-10-21 22:22_

### 17. Bottom bar look
**Decision:** Labelled steps: every stage of the plan's track named with check (done), dot (active, bold, stage color) or circle (upcoming), Build shows phase n/m; then a spend line (model, plan cost, context bar, tokens) and a limits line (5h and 7d bars)
**Why:** user's pick from three previews
_2026-10-21 22:22_

### 18. Trust boundaries
**Decision:** Model output: PRD/plan/record text is rendered read-only as Markdown in the doc viewer. Auth: the approve proof and Approve button stay as they are; the doc viewer only reads. Shell: any new CLI step command takes a fixed list of values. Untrusted input, personal data, money, deletes, migrations, public API: not applicable (checked: the bar only reads session usage)
**Why:** checked each boundary against the four changes
_2026-10-21 22:22_

### 19. Read-back
**Decision:** Outcome: accurate cairn pane: bottom-pinned bar (stage steps, this plan's spend, 5h/weekly usage with warnings), header and terminal status that say what is really running in check/review/ship, cards that switch to their agent when clicked anywhere, one scrolling doc viewer for PRD, plan, ship record and Records. User: Jason watching his own plans in the docked pane. Why now: last plan said all phases done while review and fixes ran. Success: a full plan run without looking outside the pane, header never wrong. Constraint: 48 columns, inline 7-row mode works, icons render in the user's font. Out of scope: spend across sessions, budget cap, spend in RECORD.md, the declined thin-tests follow-up.
**Why:** confirmed by the user
_2026-10-21 22:22_
