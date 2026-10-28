# Decisions: Richer pane cards

Append-only. Written by `cairn decide` as each decision is made.

### 1. Carry in follow-up: pane polish helpers
**Decision:** yes — inline worst case 8 rows, doc viewer closes after Approve, one token formatter and one word for running agents, shared helpers in a util module
**Why:** touches the same card and pane files; user picked it
_2026-10-28 01:42_

### 2. Why change the cards
**Decision:** Scannable at a glance, show concretely what agents are doing (real tool calls), and above all the visual polish (badges, titles in the border, colored status words); grouping agents under work is not the driver
**Why:** user: really 1, 2 and 4; especially likes the visual polish
_2026-10-28 01:43_

### 3. Why now
**Decision:** Saw a better reference: the screenshot sets a bar the current cards don't meet; nothing is broken, and pane work is fresh
**Why:** user picked it
_2026-10-28 01:44_

### 4. What does success look like
**Decision:** Next to the screenshot, a docked 48-column card clearly reads as the same design: numbered title in the top border, status word + timer right-aligned, the real tool call, a footer in the bottom border; every agent's state readable in one glance during a live build
**Why:** user picked the same-family-at-48-columns option with its mockup
_2026-10-28 01:45_

### 5. Binding constraint
**Decision:** Every card keeps a fixed height so the pane never jumps, within 48 docked columns, the inline 7-row fit, and glyphs that render in the user's font; polish comes from borders, color, alignment and denser lines
**Why:** user picked fixed height over screenshot-style growing cards
_2026-10-28 01:46_

### 6. Set aside: one card per unit of work with nested subagent rows
**Decision:** one card per agent stays; the footer carries that agent's own numbers (steps), as in the accepted mockup
**Why:** fresh-eyes challenge
_2026-10-28 01:47_

### 7. Set aside: probe the engine for border text / justify before hand-drawing
**Decision:** builder's call in the plan: spike engine support first, fall back to hand-drawn rows inside the full-width press
**Why:** fresh-eyes challenge
_2026-10-28 01:47_

### 8. Set aside: variable-height cards
**Decision:** already decided: fixed height
**Why:** fresh-eyes challenge
_2026-10-28 01:47_

### 9. Set aside: glyph width drift at the right border
**Decision:** the binding constraint already requires glyphs that render in the user's font; the plan picks a verified single-width set and tests the right edge
**Why:** fresh-eyes challenge
_2026-10-28 01:47_

### 10. Set aside: card numbers renumbering as cards vanish
**Decision:** numbers are assigned once when an agent starts
**Why:** fresh-eyes challenge
_2026-10-28 01:47_

### 11. Set aside: empty model after a session restart
**Decision:** the model slot collapses without shifting other columns
**Why:** fresh-eyes challenge
_2026-10-28 01:47_

### 12. Set aside: per-card stage trail
**Decision:** the plan's stage trail already sits in the bottom bar; repeating it on every agent card adds nothing
**Why:** fresh-eyes challenge
_2026-10-28 01:47_

### 13. Main session card gets the same design, with waiting-for-you and idle status words
**Decision:** yes
**Why:** the main card sits first and should match the agent cards
_2026-10-28 01:53_

### 14. Finished cards stay visible longer than 10 s
**Decision:** yes
**Why:** a completed card is part of reading the pane at a glance
_2026-10-28 01:53_

### 15. Non-goal: restyle the inline 7-row view
**Decision:** out of scope
**Why:** user left it out; the compact view stays as it is
_2026-10-28 01:53_

### 16. What a card's activity row shows
**Decision:** The tool and its argument (Read cli/src/cart.ts, Grep cache.get, Bash npm test) while the call runs; between calls the last one shows dimmed so the row never goes blank
**Why:** user: show concretely what agents are doing
_2026-10-28 01:54_

### 17. Card border color
**Decision:** By status, like the reference: running orange, done green, failed red, waiting yellow, idle grey; the stage stays in the header and bottom bar
**Why:** user picked status colors over the earlier one-color-per-stage rule for card borders
**Lasting:** paths: plugins/cairn/hooks/mod/**
_2026-10-28 01:55_

### 18. Non-goal: recent tool-call log and key-hint footer bar
**Decision:** out of scope
**Why:** success is about the cards; the log needs a new history store and the room on Now; revisit as its own plan
_2026-10-28 01:55_

### 19. Trust boundary: tool arguments shown on cards
**Decision:** Strip control and bidi characters from every shown argument; Bash shows only the program and subcommand (npm test, git commit, curl), never flags or values; paths and Grep patterns shown as-is, cut to fit
**Why:** agent tool arguments are outside text and Bash commands can carry secrets
**Lasting:** paths: plugins/cairn/hooks/mod/**
_2026-10-28 01:56_

### 20. Trust boundaries: auth, personal data, deletes, money, migrations, shell execution, public API
**Decision:** not applicable: the change is display-only in the mod; the card data type grows but stays internal to the plugin
**Why:** checked each against the change
_2026-10-28 01:56_

### 21. Read-back
**Decision:** Outcome: the pane agent and Main session cards redrawn in the reference design at 48 docked columns: number + title in the top border, status word + timer right-aligned (running, completed, failed, waiting for you, idle), border colored by status, model / tokens / cost line, the real tool call kept dimmed between calls, step count in the bottom border; finished cards linger longer; carries in the pane polish follow-up. User: the developer watching the docked pane during a live cairn build. Why now: saw a better reference; nothing is broken, pane work fresh. Success: next to the screenshot a docked card reads as the same design; every agent state reads in one glance. Constraint: fixed card height, 48 columns, inline 7-row view keeps working, font-safe glyphs, whole card clickable. Out of scope: tool-call log and key-hint bar; inline restyle; one card per unit of work; per-card stage trail; Bash shows program + subcommand only.
**Why:** confirmed by the user
_2026-10-28 01:56_

### 22. How long finished cards stay
**Decision:** completed 60 s (was 10 s), failed 120 s (was 60 s)
**Why:** user wanted finished cards to linger longer; failures stay longer so they are not missed
_2026-10-28 01:58_

### 23. Card layout
**Decision:** five lines: number + title in the top border; step left and status + m:ss timer right; model / tokens / cost; tool call; step count in the bottom border. The Main card has no number and shows agent counts (2 running · 6 done) in its bottom border
**Why:** the mockup the user picked for success, with the reference's timer format and footer counts
_2026-10-28 01:58_

### 24. One word for running agents
**Decision:** running, everywhere the pane counts or labels agents
**Why:** the carried-in follow-up asks for one word; the reference says running
_2026-10-28 01:58_

### 25. Card order
**Decision:** Main card, then running agents oldest first, then finished ones newest first; no cap, the pane scrolls as today
**Why:** user: a running card is never below a finished one
_2026-10-28 01:59_

### 26. Set aside: exact Bash subcommand rule, path shortening edge cases, token rounding, orange fallback, long-title cutting, plurals
**Decision:** builder's call, each covered by the requirement's check and tests; orange must stay distinct from waiting yellow
**Why:** PRD builder check
_2026-10-28 01:59_
