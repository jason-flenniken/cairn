# Decisions: Clearer Linear pane

Append-only. Written by `cairn decide` as each decision is made.

### 1. Why
**Decision:** The Linear tab is unreadable on a large project: in-progress work is buried, blocked issues fill it with red, every blocker repeats its milestone tag, and wrapped lines lose their indent
**Why:** the user's first Linear project (Savvyling, 43 issues in M0) made the tab a mess
_2026-11-12 21:10_

### 2. Why now
**Decision:** First real use of the Linear integration, on an ambitious project with many tickets
**Why:** the user is driving Savvyling from Linear now
_2026-11-12 21:10_

### 3. Success
**Decision:** At the docked width you can tell at a glance what is in progress, what can start next and what it unblocks, and what is waiting on what; agent cards and the plan header name the Linear ticket being built
**Why:** the user's asks: highlight active work, separate groups, show the ticket on cards
_2026-11-12 21:10_

### 4. Constraint
**Decision:** The CLI works out every fact; the pane only draws it, at 46 columns, with no new dependencies
**Why:** existing split between CLI and mod
_2026-11-12 21:10_

### 5. Linear tab layout
**Decision:** By status: milestone progress bars, then In progress (each running plan and its issues), Ready to start (with unblocks N), Waiting (one line per epic naming what it waits on), Done as a count. Blocked shows dim, not red; red only for a blocked-by loop; no milestone tag when the blocker is in the same milestone; wrapped lines keep their indent
**Why:** user picked this over a tidied milestone tree
_2026-11-12 21:10_

### 6. Ticket on agent cards
**Decision:** In the card's top-border title before the task name (8 · SAV-66 Move the app…), +1 when a task covers more; the plan header shows the epic key and UP NEXT shows keys
**Why:** user picked this over the bottom border
_2026-11-12 21:10_

### 7. Unblocks count
**Decision:** Ready and in-progress issues and epics show how many open issues wait on them, through chains
**Why:** in the chosen layout; helps pick work that frees the most
_2026-11-12 21:10_

### 8. Wide epic links
**Decision:** The board flags epic-level blocked-by links that hold 3 or more open sub-issues and suggests linking only the sub-issues that need it
**Why:** an epic's link applies to every sub-issue, which made most of M0 look blocked; user did not answer, taken as default with the plan approval
_2026-11-12 21:10_

### 9. Non-goal: parallel plans
**Decision:** out of scope
**Why:** can-start-alongside status, running several plans at once, stacked branches and maxParallel go to a separate parallelism plan
_2026-11-12 21:10_

### 10. Non-goal: collapsible epics in the pane
**Decision:** out of scope
**Why:** waiting epics are collapsed only; cairn linear board --epic gives the detail
_2026-11-12 21:10_

### 11. Follow-up: card polish
**Decision:** In scope: overlapping tool calls on one agent, the Main card's blank second row (session model), status glyph color when cut at narrow widths, one position for the merged inline count line
**Why:** user brought richer-pane-cards:s29 into this plan
_2026-11-12 21:11_

### 12. Grouping lives in board()
**Decision:** board() returns the sections, unblocks counts, epic waits-on and wide links; the CLI text board and the pane draw the same sections in the same order
**Why:** fresh-eyes check: the pane only draws, and two renderers must not disagree
_2026-11-12 21:12_

### 13. Many milestones
**Decision:** Only the first unfinished milestone gets the full sections; each later milestone is one line with its count and what it waits on; finished milestones are one ✓ line
**Why:** real Savvyling board has 11 milestones and 87 issues; checked: every blocked M0 epic is held by one shared epic-level link (SAV-20→19, 19→18, 18→17, 17→16, 21→16)
_2026-11-12 21:12_

### 14. Set aside: in progress means Linear's In Progress state
**Decision:** In progress means a cairn plan owns the issue, as the board already defines it
**Why:** fresh-eyes challenge; the snapshot's stateType is used only for done
_2026-11-12 21:12_

### 15. Set aside: task covers several tickets
**Decision:** The CLI gives each task its ticket keys; the card shows the first and +N; a plan with no Linear link shows no key
**Why:** fresh-eyes challenge; already decided with the card layout
_2026-11-12 21:12_

### 16. Set aside: snapshot staleness
**Decision:** The read age stays in the tab header; no new refresh nudge
**Why:** fresh-eyes challenge; the board already suggests a full re-read after 3 days
_2026-11-12 21:12_

### 17. Trust boundaries
**Decision:** Ticket titles and keys are outside text from Linear: every string drawn passes the pane's existing stripControl. No auth, personal data, shell commands, deletes, money, migrations or public API changes. The board JSON shape gains fields (additive)
**Why:** checked each boundary
_2026-11-12 21:12_

### 18. Users and flow
**Decision:** The developer running cairn plans from a Linear project: opens the pane's Linear tab to choose the next plan, and watches agent cards during a build
**Why:** the user's own use on Savvyling
_2026-11-12 21:12_

### 19. Read-back
**Decision:** Outcome: Linear tab by status (in progress, ready with unblocks N, waiting collapsed per epic, done as a count; later milestones one line each; flags wide epic links), sections computed by the CLI and shared with cairn linear board; ticket keys on agent cards, the plan header and UP NEXT; plus the card polish follow-up. User: the developer running cairn plans from a Linear project. Why now: first real Linear project (Savvyling) made the tab unreadable. Success: at 46 columns you can see what is running, what to start next and what it frees, and what waits on what; cards name the ticket. Constraint: the CLI works out every fact, the pane only draws; no new deps. Out of scope: parallel plans, stacked branches, maxParallel (separate plan); collapsible epics in the pane. Set aside: in progress = a plan owns the issue; several tickets show first +N, none shows no key; read age stays in header.
**Why:** confirmed by the user
_2026-11-12 21:14_
