# PRD: Roomier pane visuals

> Plan: roomier-pane-visuals. Keep it short. Every requirement has a stable id and a one-line acceptance check.

## Problem
The cairn pane is hard to scan. Text sits flush against the pane's left edge. Every tab stacks its lines with no gaps, so sections and list entries run together (the Records list reads as one block of dates, titles and summaries). The pane body is drawn black instead of the terminal's own background. Two small approval rough edges remain from earlier plans: a stop asked twice and revised twice leaves two "not approved" notes, and approving in the pane leaves an already-open chat approval question on screen.

## Solution
Each tab gets a 1-column margin on both sides. A blank line now separates the tab row, each section, and each multi-line entry such as Records rows and cards. One-line lists like the History timeline stay compact, and so does the 7-row inline fit. The build tries once to let the terminal background show through the pane. If Claude Code paints the pane itself, the background stays as it is and you're told so. A stop revised twice now gets one "not approved" note. Approving in the pane also closes the open chat question, if Claude Code gives the mod a way to do that.

## Requirements

- **FR-01** Every docked tab draws its content 1 column in from the pane's left and right edges: Now, History, Records list and Records detail. Check: pane tests find the 1-column side padding on each tab's outer box, and a docked pane shows a gap at both edges.
- **FR-02** The inline fit above the prompt has the same 1-column side padding. Check: an inline-placement test finds the padding.
- **FR-03** Lines sized to the pane width fit inside the padded width without wrapping. This covers the progress bar and truncated lines. Check: a test at 48 body columns draws the progress bar line in at most 46 columns.
- **FR-04** On every docked tab, a blank line separates the tab row from the content below it. Check: pane tests find an empty row between the tabs and the first content line on Now, History and Records.
- **FR-05** On Now, a blank line separates each section from the next: the plan header with its progress bar, the approval card, the session cards, Up next, the button row, and Other active plans. Consecutive cards are also separated by a blank line. Check: a test of a Now tab with an active plan and two agent cards finds an empty row between each pair of these groups.
- **FR-06** On Records, a blank line separates one list row (date and title, then the summary) from the next. In the detail view, a blank line separates the Back button, the record text, and the follow-ups. Check: a test with three records finds an empty row between rows and none inside a row.
- **FR-07** The History timeline stays one line per entry with no blank lines between entries. Check: the existing History test still counts the same number of lines, with no empty rows between them.
- **FR-08** Session cards keep exactly 3 content lines inside their border. Check: the existing card-height test passes unchanged.
- **FR-09** The inline fit adds no blank lines. Check: an inline test draws no empty rows between its lines.
- **FR-10** The pane's outer box tries a background setting that lets the terminal's own background show. Check: in a docked pane, the body matches the chat's background. If Claude Code ignores the setting, the setting is removed and the plan record says Claude Code paints the pane.
- **FR-11** A stop tagged twice and answered Revise both times shows one "not approved" note. Check: an approval test that revises the same stop twice finds one note.
- **FR-12** If Claude Code lets the mod close or answer an open dialog, approving in the pane closes the chat approval question that is already open. Check: an approval test opens the chat question, approves in the pane, and finds the question closed. If Claude Code has no way to do this, the plan record says so and nothing changes.

## Non-goals

- New content in the pane, because this plan is visual polish only.
- Colour or theme changes, because the stage colours were settled in the previous plan.
- Changing card height or tab behaviour, because fixed 3-line cards keep the pane from jumping.
- A chosen background colour standing in for transparency, because the mod can't know your terminal's colour. If Claude Code ignores the setting, the pane keeps its current background.

## Open questions

- [x] How much side padding? (answer: 1 column on each side, on every tab and in the inline fit)
- [x] Where does the extra spacing go? (answer: between the tab row and content, between sections, and between multi-line entries; one-line lists and the inline fit stay tight)
- [x] What if Claude Code ignores a background setting? (answer: leave the background as it is and report it)
