# Decisions: Cleaner pane and records

Append-only. Written by `cairn decide` as each decision is made.

### 1. How should the pane be organized?
**Decision:** Tabs inside the pane: Now, History, Records
**Why:** One place to look; we control the tabs regardless of other panes like Diff
_2026-10-21 14:29_

### 2. Which card style for the Now tab?
**Decision:** Bordered cards, fixed 3 lines (title + model, status, activity line always present and blank when idle). Main session card always first. Whole card clickable to switch the main view. One color per stage used by the header, progress bar and working-card borders.
**Why:** Stops the pane jumping; colors make the current stage obvious at a glance
_2026-10-21 14:31_

### 3. How should we keep the number of follow-ups down?
**Decision:** At most 5 per plan, trimmed automatically when the plan closes. Trimming groups related items into high-level action items (e.g. many missing-test notes become one 'add more detailed tests for X'), merges duplicates and drops trivia. Dropped detail is listed once in the plan's record.
**Why:** 17 from one plan would bury anything useful; high-level grouped items can be pulled into a plan and detailed there
_2026-10-21 14:37_

### 4. When should a new plan be asked about related follow-ups?
**Decision:** During discovery: follow-ups whose files overlap the files research finds are offered as one multi-pick question; picked ones become PRD requirements
**Why:** Early enough to shape the PRD; one question, only when relevant
_2026-10-21 14:37_

### 5. Should follow-ups expire?
**Decision:** Yes: a follow-up declined twice, or 60 days old, closes on its own and is noted in the record
**Why:** Keeps the list from growing forever; important items get re-logged when a review hits them again
_2026-10-21 14:37_

### 6. What should the pane show for follow-ups?
**Decision:** Nothing on the Now tab; each plan in the Records tab lists the follow-ups it left
**Why:** Follow-ups surface in discovery; the pane stays focused on live work
_2026-10-21 14:38_

### 7. Which related follow-ups come into this plan?
**Decision:** Harden the approval hook (Revise-then-Approve drop, fail-open guard, waiting vs ready). Declined: pane tests on real data, closing the open chat question.
**Why:** Small, in files this plan already changes
_2026-10-21 14:39_

### 8. Where should the automatic findings go?
**Decision:** A Findings section in RECORD.md, written automatically from the plan's log (escalations, repeated review findings, failed checks, scope added mid-plan, surprises). The learn question is removed; learn runs without a stop.
**Why:** Findings should be recorded by the system, organized by plan and date, not asked of the user
_2026-10-21 14:39_

### 9. How should plan folders be named?
**Decision:** YYYY-MM-DD-<slug> from the plan's start date; existing plan folders are renamed to match. Branch names keep the plain slug.
**Why:** Folders sort by date in Finder and ls
_2026-10-21 14:39_

### 10. How should the Records tab work?
**Decision:** Newest-first list: date, plan name, one-line why; in-progress plans at the top marked in progress. Clicking a row shows the full record (with its follow-ups) in the pane; Back returns to the list.
**Why:** Easy way to browse what was done and when
_2026-10-21 14:40_

### 11. What does the History tab show?
**Decision:** The current plan's full timeline (plan log plus agent activity), newest first, in stage colors; it moves off the Now tab
**Why:** The timeline was useful but took too much space on the main view
_2026-10-21 14:40_

### 12. Can the pane background be transparent?
**Decision:** Try once during the build; the mod sets no background today and the pane API has no transparency setting, so if Claude Code ignores it, it becomes a non-goal
**Why:** The black comes from Claude Code, not the mod
_2026-10-21 14:40_

### 13. What about the 17 follow-ups already open?
**Decision:** Apply the new grouping once: trim the open follow-ups from earlier plans to at most 5 grouped items
**Why:** Start the new rules from a clean list
_2026-10-21 14:40_

### 14. Anything risky?
**Decision:** Renaming plan folders on main moves tracked files; old folder names and old branches must still resolve. No auth, money or public API involved.
**Why:** Closed and open plans must keep working after the rename
_2026-10-21 14:40_
