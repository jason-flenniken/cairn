# Decisions: Roomier pane visuals

Append-only. Written by `cairn decide` as each decision is made.

## Carried-in follow-up (cleaner-pane-and-records:s22)
Requirement for the PRD: pane and approval polish — one note per stop, try a transparent pane background (root Box backgroundColor, checked by eye), and close an open chat approval when approved in the pane if Claude Code allows it.

### 1. How much side padding should the pane get?
**Decision:** 1 column on each side, on every tab and in the inline fit
**Why:** Text sat flush against the pane edge; 1 column fixes it without costing much of the 48-column dock
_2026-10-21 20:37_

### 2. Where should the extra line spacing go?
**Decision:** A blank line after the tab row, between sections, and between multi-line entries (Records rows, cards) on every docked tab; one-line lists such as the History timeline stay tight; the 7-row inline fit stays compact; cards keep their fixed 3 lines
**Why:** Screens read as one crammed block; spacing between groups makes them scannable without halving how much a one-line list shows
_2026-10-21 20:38_

### 3. What is out of scope?
**Decision:** No new content, no colour or theme changes, no change to card height or tab behaviour; if Claude Code ignores a background setting the pane keeps its current background and the plan reports that
**Why:** This plan is visual polish on the existing pane; the earlier plan fixed card height to stop the pane jumping
_2026-10-21 20:38_

### 4. Users and risk
**Decision:** Users: a developer running cairn with the pane docked beside the chat. Risky areas (auth, money, data deletion, migrations, public API): not applicable, the change is display-only
**Why:** The mod only draws; no stored data or commands change
_2026-10-21 20:38_
