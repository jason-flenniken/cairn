# PRD: Richer pane cards

> Plan: richer-pane-cards. Keep it short. Every requirement has a stable id and a one-line acceptance check.

## Problem
The docked pane's cards (one per running agent, plus a Main session card) are three lines of prose inside an engine-drawn border: "● Build · task review · 6m 12s · 41k tokens", then "14 steps · reading cli/src". To know what an agent is doing you have to read each line, and the activity line paraphrases the tool call ("reading dir/file", "searching") and goes blank between calls. A reference terminal dashboard (wfwatch) shows the same information as a polished card: the title set into the top border, a colored status word and timer at the right, the real tool call ("Grep token", "Read docs/api.md"), and counts in the bottom border. Ours don't read at a glance and don't look as good.

## Solution
Each card in the docked pane is redrawn in the reference's design, at the pane's 48 columns and at a fixed height:

```
╭ 2 · Cart API ──────────────────────────────╮
│ Build · task review         ● running 9:52 │
│ sonnet 4.5 · 41k tokens ~$0.42             │
│ Read src/cart.ts                       │
╰─────────────────────────────── 14 steps ───╯
```

The number and title sit in the top border; the agent's step sits at the left of the first row and its status word and timer at the right; the second row holds the model, tokens and cost; the third row holds the tool call as tool + argument; the step count sits in the bottom border. The border takes the status's color. The Main session card gets the same design, with "waiting for you" and "idle" states and the agents' counts in its bottom border. Finished cards stay on screen longer. Pressing anywhere on a card still opens that agent's conversation.

This plan also carries in the pane-polish follow-up from the status-bar plan: the inline view's worst case, the doc viewer after Approve and for records without a file, one token formatter, one word for running agents, and shared helpers.

## Requirements

- **FR-01** Every agent card in the docked pane draws its number and title in its top border (`╭ 2 · Cart API ──…╮`) and its step count right-aligned in its bottom border (`╰──… 14 steps ───╯`). Check: a mounted pane with one working agent draws a first card line starting `╭ 1 · ` with the agent's title, and a last line ending `steps ───╯`.
- **FR-02** An agent's number is assigned once, when it starts, counting up from 1 for the session; it never changes while the card is shown, and a card leaving does not renumber the others. After a session restart, the cards rebuilt from the engine's agent list get numbers in that list's order and the counter continues from there. Check: with agents 1, 2 and 3 shown, after card 2 is pruned the remaining cards still read 1 and 3.
- **FR-03** The first row of an agent card shows the agent's step at the left (as today: "Build · task review", "Build · security review", "working" for a description with no known role) and its status word and timer right-aligned: `● running m:ss` while working, `✓ completed m:ss` when done, `✗ failed m:ss` when it failed. The timer is elapsed time while running and the total duration once ended, as `m:ss`, or `h:mm:ss` from one hour. Check: a working card started 9 min 52 s ago has a first row ending `● running 9:52`; a done card that ran 6 min 12 s ends `✓ completed 6:12`.
- **FR-04** The second row shows the model (the id as today's card shows it), then tokens, then the estimated cost from the mod's existing price table (`prices.ts`), marked `~` as today (`41k tokens ~$0.42`); a model with no price shows tokens only. The cost, then the tokens, drop off before the row would be cut. With no model known (after a session restart), the row starts with the tokens and leaves no gap. Check: a card with an empty model draws a second row starting with the token count.
- **FR-05** The third row shows the agent's current tool call as the tool name and its argument: `Read src/cart.ts`, `Edit mod/cards.tsx`, `Grep cache.get`, `Glob **/*.test.ts`, `Agent Build · Checkout`, `Bash npm test`. Between calls it keeps the last call, dimmed, so the row is blank only before the agent's first call. A completed or failed card keeps its last call, dimmed. Paths show their last two parts; the argument is cut with "…" to fit. Check: after a Grep for `cache.get` completes, the card's third row reads `Grep cache.get`, dimmed.
- **FR-06** A Bash call shows only the program and, when it has one, its subcommand: `npm test`, `npm run build`, `git commit`, `curl`, `node`. Flags, values, paths, quoted text and anything after a pipe or `&&` are never shown. Check: `curl -H 'Authorization: Bearer abc' https://x` shows as `Bash curl`, and the drawn pane does not contain `abc`.
- **FR-07** Every piece of outside text a card draws (agent titles, model ids, tool arguments) has control and bidirectional-override characters removed before it is measured and drawn. Check: a Read of a path containing `\x1b[31m` and `‮` draws without either character.
- **FR-08** Card borders take the status's color: running orange, completed green, failed red, waiting for you yellow, idle grey. This replaces the stage color on working cards; the stage stays visible in the header and the bottom bar. Check: a working card's border is drawn orange (or the engine's closest supported color), a done card's green.
- **FR-09** The Main session card has the same design, titled `Main session` with no number. Its first row shows the right status: `● working m:ss` while its turn runs, `◷ waiting for you m:ss` while a question of its is open, `○ idle m:ss` otherwise, each timer counting from when that state began (a tool call does not reset it). While a question of its is open, it shows waiting even if agents are running. Its third row shows the main session's tool call as in FR-05 and FR-06 (or `answer in the chat` while waiting). Its bottom border shows the agents' counts: `2 running · 6 done`, or nothing when no agent has run. Check: with the main turn ended 9 min 37 s ago and two agents working, the Main card's first row ends `○ idle 9:37` and its last line contains `2 running`.
- **FR-10** A completed card stays on screen 60 seconds after it ends (today 10 s); a failed card stays 120 seconds. Check: a card done 30 s ago is still drawn; one done 61 s ago is not.
- **FR-11** Every card is the same fixed height (five lines including both borders) in every state, so the pane never shifts as agents start, call tools or finish. Check: working, done, failed, waiting, idle, and empty-model cards each draw exactly five lines.
- **FR-12** Cards are ordered: the Main card first, then running agents oldest first, then finished ones newest first. There is no cap; the pane scrolls as today. Check: with a done agent started first and a running one started later, the running card is drawn above the done one.
- **FR-13** Pressing anywhere on a card, any row including the border rows, opens that agent's conversation (the Main card opens the main one), as today. Check: every line of a card, border lines included, is one press target whose label spans the card's full width, and pressing it views that agent.
- **FR-14** Every card line is exactly the card's width in terminal cells at the docked 48 columns (46-cell cards), with every glyph the card uses (`╭ ╮ ╰ ╯ │ ─ ● ✓ ✗ ◷ ○ · …`) counted as one cell. Check: for each card state, every drawn line measures 46 cells.
- **FR-15** The inline 7-row view never draws more than 7 rows, in its worst case too (today the repo-root fallback, paused, an approval waiting and another plan together draw 8). To fit, the "Showing" line goes first; whenever agent lines are hidden a `● +N more` line stays, and N counts only agents. Which agents are folded into `+N more` is unchanged (the first ones in order stay); the one-line-per-agent form is otherwise unchanged. Check: inline with the repo-root fallback, a paused plan, an approval waiting, another plan, and the main session plus five agents working draws at most 7 rows, including a `+N more` line.
- **FR-16** Running agents are called "running" everywhere the pane counts or labels them (cards, the Main card's footer, the header's status line), where some places say "working" today. Check: the header status line with three agents working reads `3 running`.
- **FR-17** Token counts are formatted by one shared function everywhere the mod shows them (cards and the finished-agent line in History, today two copies in `cards.tsx` and `activity.ts`), and the helpers the pane modules share (cell measuring, fitting, durations, the press helpers) live in one util module. Check: the mod defines one token formatter, both places call it, and the pane tests for History and the usage lines pass.
- **FR-18** After Approve in the doc viewer, the viewer closes and the tab it was opened from is shown again. A Records entry with no record file draws without an error and offers no Read all. Approve still asks the same confirm first and reports as today. Check: pressing Approve in the viewer and confirming leaves the doc viewer closed; a Records entry with no file draws and has no Read all button.

## Non-goals

- A recent tool-call log and a key-hint footer bar like the reference's, because the goal is the cards; the log needs a new per-call history and room the Now tab doesn't have. A later plan can take it.
- Restyling the inline 7-row view, because it is a compact fallback and stays one line per agent (FR-15 only fixes its row count).
- One card per unit of work with agents nested inside, because one card per agent stays; grouping was not the reason for this change.
- A stage trail on each card, because the plan's stages already show in the bottom bar.
- Cards that grow with content, because a fixed height keeps the pane from jumping.
- Showing full Bash commands, because they can carry secrets (FR-06).

## Open questions

- [x] Do cards keep a fixed height? (answer: yes, five lines in every state)
- [x] Border color by stage or by status? (answer: by status; the stage stays in the header and bottom bar)
- [x] Show the real tool call, and what between calls? (answer: tool + argument, the last one dimmed between calls)
- [x] How much of a Bash command to show? (answer: program and subcommand only)
- [x] Include the reference's tool-call log? (answer: no, cards only)
- [x] The follow-up's "fix.md's re-review keeps the re-checking step"? (answer: already done: `procedures/fix.md:64` runs `cairn step rechecking`, asserted in `cli/test/steps-doc.test.ts:17`)

## Unhappy paths

- [FR-04] With no model known after a session restart, the second row starts with the tokens; with no tokens yet, it is blank and the card keeps its height.
- [FR-05] A tool the card doesn't know shows its name alone (`WebFetch`); an argument that doesn't fit is cut with "…"; a call with no argument shows the tool name.
- [FR-13] Pressing a card whose agent's conversation isn't available shows the same toast as today ("that agent's transcript isn't available").
- [FR-14] When the pane is narrower than 48 columns, the card's lines shrink to the pane's width and every line still measures the same; the status word and timer keep their place and the left side is cut first.

## Security

- Trust boundaries: agent descriptions, model ids and tool-call arguments come from model output and the files the agents touch, and reach the screen through the pane.
- Assets: secrets typed into Bash commands (tokens, passwords in flags or URLs); the integrity of what the terminal displays.
- STRIDE:
  - Tool arguments → screen: Information disclosure (a token in a Bash command shown on the pane, visible to anyone watching or in a screen share): Bash shows program and subcommand only (FR-06). Tampering/Spoofing (escape sequences or bidi overrides that recolor, move the cursor, or reorder what the pane shows): control and bidi characters stripped from all outside text (FR-07).
  - Agent descriptions and model ids → screen: Tampering/Spoofing through the same characters: FR-07.
  - Not applicable: Repudiation, Denial of service, Elevation of privilege (the change only draws text the mod already receives; it runs nothing and stores nothing new outside its in-memory cards).
- Misuse cases:
  - An agent runs `curl -H 'Authorization: Bearer <token>' …`; the pane must show `Bash curl` and never the token. Security test on FR-06.
  - A file name or Grep pattern contains `\x1b]` or `‮` to fake a status or hide text; the pane strips it. Security test on FR-07.

## Non-functional requirements

- **NFR-01** Cards redraw on the existing 1-second tick and the existing hooks; no new timer or poll.
- **NFR-02** Every card glyph renders one cell wide in a common terminal font (the box-drawing set plus `● ✓ ✗ ◷ ○`); no emoji on cards.
