# cairn mod notes

## API check (headless `claude -p --plugin-dir` probe, Claude Code 2.1.30x)

1. **`tool.call` fires for a subagent's Bash call.** The event carries `agentId`, and a `{ deny }` returned there holds: the subagent's Bash call is refused. So the FR-03 Bash guard covers subagents as well as the main loop.
2. **`$.command.run({ command: 'cairn:status' })` runs the plugin's skill command.** Resume can use it. It doesn't need the `$.prompt.submit` fallback.

## Heartbeat format (FR-06)

`<git common dir>/cairn/mod-heartbeat` holds one value: epoch milliseconds as plain decimal text, with no newline (for example `1792532987012`). The mod writes it at `session.start` and every 2 s after that. It finds the common dir with `git rev-parse --path-format=absolute --git-common-dir`. Outside a git repo a beat writes nothing and looks again next time, so a session started before `git init` picks the repo up within one beat. The pane's poll does the same. An unwritable folder skips that beat. The CLI treats the mod as active while the value is under 10 s old.

A hot reload drops the old timer. `session.start` fires again for a changed module, so the beat restarts.

## Guards (FR-03, FR-04, NFR-02)

- Both guards are `tool.call` hooks with a fail-closed `.catch`.
  - The Bash guard is matched on `{ tool: 'Bash' }`.
  - The path guard sees every call but only judges a non-Bash call with `file_path`, `path`, or `notebook_path`. Its `.catch` denies only such a call. Every other call goes on, so a mod failure never blocks unrelated tools (NFR-07).
- Before `fs.stat` sees a path, the engine has already made it absolute against the session folder and folded `..` lexically.
- A missing path rejects with `ENOENT`. For a missing path, the guard resolves the deepest existing ancestor and appends the rest, because a Write creates folders. Any other stat error propagates, and the `.catch` denies.
- A path starting with `~` is denied, because the guard can't tell where the tool would land it.
- Heredoc and here-string bodies fed to `python`, `node`, `ruby`, `perl` and similar are code, not shell, so they are not scanned. Bodies fed to `cat` or `tee` that pipe nowhere are data (they only print or save it; where they save it is still guarded). Bodies fed to `sh`/`bash`/`zsh`, or anything else, are scanned as shell. Text piped into a bare shell (`echo … | bash`, `cat <<EOF | sh`) is scanned. The line-wide scan for `$(…)` and backticks skips quoted heredoc bodies (`<<'EOF'`, `<<"EOF"`, `<<\EOF`), which the shell never expands; unquoted bodies are scanned.
- Arguments to `cairn decide` and `--note`/`--why` values are prose: an approve word there is not an approval. Only single-quoted prose skips substitution scanning. In double-quoted or bare prose, backticks and `$(…)` are scanned the way a shell would run them. Markdown-heavy text goes in single quotes or a file (`--file`/`--note-file`).
- Read, Grep, and Glob may read plan state. No tool may read or write under `.git/cairn/`, which holds the secret's hash (`mod-secret.sha256`) and the heartbeat.
  - Grep and Glob may not search a `.git` folder at all.
  - Native builds don't register Grep or Glob, so those searches go through Bash.
- The Bash guard tokenizes the command the way a shell would: quotes, `;` `&&` `||` `|` `&`, subshells, `$(…)`, backticks, `sh -c`, and `eval`. It denies only these:
  - an `approve` argument to `cairn`, `…/bin/cairn`, or `node …/cairn.mjs`
  - setting `CAIRN_APPROVER`, by assignment or with `export`, `declare`, `read`, and the like
  - writes to a `state.json`: redirects, `sed -i`/`perl -pi`, `tee`, `cp`/`mv`/`rm`/`truncate`/`dd`/`ln`, `git checkout`/`restore`, or interpreter code (`-c`/`-e`, or a heredoc or here-string body) that names it and could write it (`open(…,'w'/'a'/'r+')`, `write_text`, `json.dump`, `writeFileSync`, `fs.write`, a shell-out). Interpreter code that only reads one runs.
  - anything under `.git/cairn/`, except a read of `.git/cairn/mod-heartbeat` named exactly
  - a glob in or after a path component that could be `.git`, a recursive read of a `.git` folder, and `$(git rev-parse --git-common-dir)`-style paths
  - a pseudo-terminal wrapper around `cairn` (`script`, `expect`, `unbuffer`, `tmux`, `screen`, python/perl `pty`)

  Reading a plan's state, grepping for names like `CAIRN_APPROVER`, and git commands other than checkout/restore/rm/mv all run. The guard is a best-effort deny-list on spellings. The CLI's proof is the real control. `grep -r . .` from the repo root can still reach `.git`.

## Menu approval and overrides (FR-02, FR-34)

- The secret lives only in `mod/approve.ts`'s memory. `<git common dir>/cairn/mod-secret.sha256` holds its SHA-256 as lowercase hex, written with `$.fs.write` and then `chmod 600`, because `$.fs.write` takes no mode.
- The hash file doesn't exist until the first approval or override. The mod writes the secret and its hash just before first use, and writes a fresh pair after every use, whatever the CLI answered. Uses run one at a time, so two approvals that land together each get their own secret.
- The engine allows one matcherless hook per event per module. `register.tsx` owns the single `session.start` hook and calls each module's start work in turn (heartbeat, pause, pane). A failing module never stops the others or the session, so approve.ts, pause.ts, and pane.tsx have no `session.start` hook of their own.
- Level changes (`/cairn-level` and a `[cairn:level <slug>]` tag on the agent's menu) run `cairn level <mvp|standard|polished>` through the same secret path as approvals (`levelAs` beside `approveAs`). The menu answer must be exactly `MVP`, `Standard` or `Polished` (a trailing " (Recommended)" is allowed); it gets the approval checks: model-prefilled answers, `afkTimeoutMs`, multi-select and subagent dialogs change nothing. The header line shows the CLI's `levelLabel` and `timing[stage]` as given, with no extra row.
- Approval kinds are `prd`, `plan` and `ship`; a phase needs no human. An answer approves when it is a label starting "Approve", or free text opening with approve, approved, lgtm or yes.
- The engine shows one AskUserQuestion dialog at a time, and `$.ui.ask` is one, so a pane confirm asked while the agent's question is open waits behind it and shows only after that question closes. The pane's Approve therefore skips its confirm when the open dialog asks for that same stop (the press approves, and that dialog closes as approved). With any other dialog open, the press only toasts "answer the open question first". The AskUserQuestion hook counts open dialogs; counting the mod's own confirm as well would do no harm.
- Read-back: discover's card question carries `[cairn:readback <slug>]` and the card as the first option's preview. While a main-session dialog with that one tagged question is open, the `readBack` atom holds it and the pane shows the card with one button per option of the question. A press answers the dialog with that label, the same race as an approval from the pane, and toasts "Answered in the pane". It records nothing: the model records the card with `cairn decide` after a yes, as before. It is not an approval stop.
- The approval hook reads only `result.answers` from the dialog. It ignores answers the model put in its own call's input, which it copies before the dialog runs, a result with `afkTimeoutMs`, a dismissed or failed dialog, and subagents' dialogs. It has no `.catch`: if it throws, the hook is skipped and the user's answer goes on unchanged.
- Every `process.run` the mod makes has a timeout: 60 s for `status` and `chmod`, 10 minutes for `approve` and an override. A hung CLI then can't hold up later uses of the secret, and its failure is reported.
- An "Override" answer is held in memory for 10 minutes. The Bash hook runs the model's plain `cairn … --override "…"` itself and returns the CLI's output as the tool's result. It runs the command for the plan whose worktree the session is in, or for the one plan holding an override. Commands run as written, with a context line saying why the override wasn't used, when they contain any of these:
  - `; | & $ \` > <`, a newline, or a backslash, outside quotes
  - an unquoted `# * ? ~ ( ) { } [ ]`

  Inside single or double quotes any character is allowed, because the mod runs the words as argv through `$.process.run`, never a shell.

  That includes `cd <wt> && cairn …`. A command that names `approve` or `level` outside prose (`--note`/`--why`/`--override` values, text after `decide`) is never run this way: approvals and level changes never ride an Override. The Bash guard denies the model running `cairn level` as it does `cairn approve`; the CLI's proof stays the real control.
- A hook can't mark a Bash result as an error. Core ignores `isError` on a hook's Bash result, and a string result fails Bash's output schema (checked in a `-p` probe). So a failed override's stdout starts with `Exit code N`, the way the Bash tool's own does, and its context line names the exit code. The probe also showed that a hook's `{ stdout, stderr, interrupted }` result and its `context` reach the model.

## Mod commands, pause, and Stop now

- Mod command names have no ":" because the engine forbids it: `cairn-pane`, `cairn-approve`, `cairn-pause-now`, `cairn-pause-mod`, `cairn-resume-mod`.
- A plugin's own `$.command.run` skips its own hooks. The mod can't run its own commands through it.
- Stop now cuts the running turn, and the engine refuses a `prompt.submit` made from the command's own hook (it would wait on the turn the hook holds). The mod remembers the id of the cut turn and sends the message to the model when that turn completes. The message tells it to stop its subagents, record each task's substep, commit work in progress, and finish with `cairn pause --now`.
- Pause (`cairn-pause-mod`) waits for in-flight work to reach a safe point instead of cutting the turn.

## Agent cards (pane)

- `agent.spawn`'s `next(e)` resolves with the new `agentId`; that same id is on the agent's `tool.call`, `turn.start` and `turn.complete` events (each run of an agent's loop is one turn, so a woken agent fires `turn.start` again) and in `$.agent.list()`. `activity.ts` keys its cards on it. The probe was the type docs only; a live background-agent run is still to check.
- Activity rides the existing unmatched hooks (one per event per module): `tool.call` in `guards.ts` after the guards allow, `turn.start`/`turn.complete` in `pause.ts`. `register.tsx` adds the `session.start` rebuild from `$.agent.list()`.
- The engine follows `$` into another file only through a `function` declaration, not a `const` arrow, so every helper there that takes `$` is one, and `import * as ns` calls are refused.
- Where an agent is: `agentRole` (`cards.tsx`) reads the "<Role> · <what>" description the procedures give every Agent call (`references/reporting.md`). The card's title drops the role, and its status line reads the plan's stage and the role's step instead of "working": `● Build · task review`, `● Build · security review` (a "(security)" suffix), `● Build · building`, `● Build · fixing`, `● Review · review`. "task review" is only for a `<what>` that names one of the shown plan's tasks. A description with no known role keeps its title and "working". The stage is the plan's stage now, not at spawn. The status word and timer sit at the right of that row (`● running 9:52`).
- Tokens and cost: a `turn.step` stream hook in `activity.ts` adds each step's `usage` (input + output tokens) to the card's `tokensLive` and its estimated cost to `usd`, so a running card's numbers rise with every step. `turn.complete` then sets `tokens` from the turn's total and clears `tokensLive`. `prices.ts` holds the per-million-token table by model family (dated source comment); an id outside it has no `usd`, so the card shows tokens only.
- The card frame is drawn by hand. An engine `Box` border can't hold text, and the card needs its number and title in the top border and its step count in the bottom one. So `cardRows` (`cards.tsx`) draws five rows, each one `Button` whose children are several `Text` pieces (a Button takes only strings and `Text`): top border `╭ 2 · Cart API ──╮`, step and status (`● running 9:52`), model · tokens · ~cost, the action, bottom border `╰── 14 steps ───╯`. Every row measures the card width, `bodyColumns - 2` (46 docked), and the pieces are built to add up to it. Rows are keyed `<key>`, `:status`, `:model`, `:activity`, `:end`.
- Colors are by status, not stage: running `#ff8700`, completed green, failed red, waiting for you yellow, idle gray (`STATUS_COLOR`). The border text and the status glyph take it; the rest is default or dim. The stage color stays in the header and bar. The status row cuts its left (the step) first; on the model row the cost, then the tokens, drop first, and an empty model leaves no gap.
- Numbers: `activity.ts` holds an `agentSeq` counter atom. `agent.spawn` takes the next number once and stores it on the card (`AgentCard.number`); a card leaving renumbers nothing. The `session.start` rebuild from `$.agent.list()` numbers in list order and continues the counter. Main has no number.
- Clicking a card ("nothing happens"): the cause is the hit area. A `plain` Button presses only where its own label is drawn ("one press wherever on them it lands" in the Button docs). A row sized to its text leaves the blank part of a line as no Button: no press, so neither a switch nor a toast. Every row is now one Button whose pieces fill the card's width, border rows included. Ruled out from the types: the card's `agentId` is the id `$.agent.list()` lists (`AgentSpawnResult.agentId`), and `viewPress` runs inside the press (`act` calls `work()` at once, before any await), so the person-initiated rule holds. A deny (an ended agent, a teammate in its own pane) is a toast saying the transcript isn't available, with the engine's reason. Whether it is the whole story in a live terminal is for the user to check.
- Tool calls (row 3): `before()` stores `toolCall(e)` (`activity.ts`) as `Tool arg` on the card (`call`) and the main activity; `after()` moves it to `lastCall`, and `turn.complete` does the same, so a done or failed card keeps its last call. Row 3 draws `call` at full strength, else `lastCall` dimmed, else blank. `action` (the `phrase()` words) stays for the inline lines.
- Main card: `● working m:ss` counts from the turn's start (`MainActivity.turnAt`, set by `turn.start`, carried through tool calls), `◷ waiting for you m:ss` from when its question opened (wins over running agents), `○ idle m:ss` from the `mainIdleSince` atom, which `turn.complete` sets where it clears `mainActivity` (read it with `readMainIdleSince($)`; 0 before any turn ends, then no clock shows). Row 3 is its tool call, or `answer in the chat` while waiting. The bottom border counts the shown cards: `2 running · 6 done` (and `N failed`), empty with none.
- Order (`orderCards` in `cards.tsx`): Main, then running agents oldest first, then finished ones newest first; no cap. A done card lingers 60 s and a failed one 120 s (`LINGER_MS`); `KEEP_ENDED_MS` is 180 s so pruning never cuts a linger. Agents are "running" everywhere (cards, Main footer, header status line, inline lines).
  - Argument by tool: Read/Edit/Write/MultiEdit/NotebookEdit the path's last two parts, Grep/Glob the pattern, Agent/Task the description, an unknown tool or a call with no argument the name alone.
  - Bash shows only the program (basename, after `VAR=x` prefixes and `sudo`) from the first command (before `|`, `||`, `&&`, `;`, `&` or a newline). A subcommand follows only for programs in `SUBCOMMANDS` (git, npm, cargo, ...), only as the very next word, and only if it is a bare word (letters, digits, `-`, `_`, `.`, `:`, not starting with `-`); `npm run <script>` adds the script. So `cd x` and `echo secret` show the program alone, and `curl -H '...' url` shows `curl`. A quoted or escaped `VAR="..."` prefix may hold spaces, so such a command shows `Bash` alone.
  - `clean(text)` (`util.ts`) removes C0/C1 controls, ESC sequences (CSI, OSC) and bidi overrides/isolates (U+202A-202E, U+2066-2069, U+200E/F). It runs on titles, model ids and every argument (and on the path before it is cut to two parts) before anything is measured. Regexes use ASCII escapes, never literal invisible characters.
  - Tests that send a Read/Edit through `$.tool.call` need an `fs.stat` with a `realPath`; the world's has none, so the path guard refuses the call (see `worldWithFiles` in `toolcall.test.tsx`).
- The pane opens with `columns: 48, rows: 7`; `session.start` has no fullscreen flag, so the open is unasked and the engine seats it only on a wide fullscreen terminal.

## Pinned bar (pane)

- The pane's code is split by concern: `pane.tsx` (registration, tabs, routing, Records, `frame`), `header.tsx` (plan header, status line), `cards.tsx` (agent and main-session cards), `approval.tsx` (approval and read-back cards), `bar.tsx` (bottom bar).
- The engine owns the docked body's window (`e.props.scroll = { offset, bodyRows }`). The bar is a `position: 'absolute'` Box at `top = offset + bodyRows - barRows`, as the last child of the tab's root.
  - The root gets `paddingBottom` of the bar's rows plus one blank row, so the last content row clears the bar at the end of the scroll.
  - The root also gets `minHeight = bodyRows`, so on a short tab the bar still sits at the bottom.
  - Each bar line is padded with spaces to the bar's width, so it covers the content scrolled beneath it.
- Why absolute and not our own window:
  - Own rows would fix the root at `bodyRows` and shift the content by an offset of the mod's. Then the tree always fits, so `ui.scroll`'s `contentRows` equals `bodyRows` and the mod can't clamp its offset without measuring its content. It would also lose the engine keeping a Tab-focused button in view.
  - Absolute keeps the engine's scrolling. Its cost: on the terminal the engine's own moves (following the end, a clamp, a held element kept in view) don't re-ask the render, so the bar can sit off the bottom until the next redraw. The 1 s tick and the 2 s poll redraw while anything runs.
- A `ui.scroll` hook on the pane calls `next(e)` and then `$.ui.invalidate('ui.render')`, so the bar follows every move.
- The test kit runs the `ui.scroll` chain but never changes the mounted `props.scroll`; a test redraws with the new offset itself.
- Inline (the 7-row pane) has no pinning: the bar is one line at the end, the active step. The "run /tui fullscreen" tip shows only while it still fits the 7 rows (it goes for a fallback plan with an approval waiting).
- Bar lines wrap between steps to fit `bodyColumns - 2` cells (46 docked), counting an emoji as 2 cells (NFR-01).

## Usage lines (pane)

- `usage.ts` owns the `usage` and `planBaseline` atoms. A `session.measure` hook (registered from `pane.tsx`'s `install`) stores the model, context, rate limits and cost; the bar only reads them, so there is no timer beyond the 2 s poll (NFR-02). Before the first measure `readUsage` asks `$.session.usage()`.
- The plan cost is the session cost less the baseline. The baseline is set when the shown plan is first seen active, when it changes, or when it is resumed after a pause (the pane's refresh and poll call `syncBaseline`). A paused plan seen first has no baseline, so the line shows the session total labelled "session", as it does with no plan.
- Docked, the bar runs top to bottom: the git line, the usage lines (model, then limits), then the stage steps, with a dim `─` rule between each group shown. The git line (docked only): `⎇`, `🌳` in a linked worktree (its git dir differs from the common dir), the branch or worktree name, then `✓ clean` or `●` staged+changed, `+` untracked, `!` conflicts, then `↑`/`↓` against the upstream. The plan's active time sits at its right. To fit, the name shrinks in the middle down to 12 cells, then `clean` becomes `✓`, then ahead/behind go; the timer stays.
- `git.ts` reads `git --no-optional-locks status --porcelain=v2 --branch` and `git rev-parse --absolute-git-dir --show-toplevel` in the session folder from the poll: every 5 s while the main turn or an agent works, every 30 s otherwise, and on the first poll after a main turn completes. `--no-optional-locks` keeps git from rewriting the index, so reading never changes a file. A failed read keeps the last state.
- Active time (`active.ts`): each poll adds the time since the last one, at most 5 s, to the shown plan while it is active and not paused, the main turn runs or an agent card works, and no AskUserQuestion dialog is open. Time at a tool permission prompt still counts: the mod doesn't track permission prompts yet. The total is in `$.store` under `active:<git common dir>:<slug>`, per machine. Saves add the unsaved part to what the store holds (about every 15 s, on the first poll that stops counting, on a plan change, and at session start), so two sessions on one plan both count.
- The usage lines are the model, cost, context bar with percent and tokens, then the 5h and 7d bars (warning from 80% with the reset time, error from 95%), left out with no rate limits. Each shrinks (shorter bar, then fewer parts) to fit the bar's columns. Inline, one line: the active step, the plan cost, the active time and the limit percents.

## Doc viewer (pane)

- `doc.tsx` owns the `docOpen` atom (read through `readDoc`, since the engine only follows an atom read in the file that declares it). Read all on an approval card and a Records entry with a record file open it; docked only.
- The viewer replaces the tab's content, drawn through `frame` so the bar stays pinned: title, Back, Approve (only while that very file is the one waiting on approval), then the whole text in one Markdown. Opening scrolls the pane to the start. The kit raises no `ui.scroll` for it, so that part is a live check.
- Document text only reaches `Markdown`; Approve is the one path to `approvePress`, which asks the confirm first.
- An Approve that goes through (the confirm answered Approve, or the stop already approved) closes the viewer with `closeDoc`, so the tab it was opened from shows again. A cancelled confirm or a refused approval leaves the viewer open. `approvePress` resolves true for the first two; it reads the success line `cairn: <slug>: …` that `approveAs` returns.
- A Records entry with no record file never opens the viewer: it shows its short note ("No record for this plan." or "Still in progress: no record yet.") with Back, and no Read all.
- Changelog tab: the fourth tab, fed by the same `cairn records --json` fetch and poll as Records (its `entry` field), drawn through `frame`. Closed plans only, newest first; date and title bold, the paragraph wrapped; a click opens RECORD.md with `openDoc`, and Back returns to the tab. The pane strips control characters from entry text itself (it never trusts the CLI to have done it).

## Testing

`claude plugin test <dir>` runs every `*.test.ts` under `<dir>`, skipping only `node_modules` and dot-folders. That includes `cli/test`, whose node:test files can't load in the mod environment.

To avoid that, `npm run test:mod` copies `.claude-plugin/`, `hooks/`, and `types/` to a temp folder and runs `claude plugin test` there. Keep mod tests under `hooks/test/` and mod code under `hooks/` or `types/`.

Pane tests share one world beneath the mod, `hooks/test/world.tsx`: the CLI, git, the files, the dialogs, the row builders and the mount helpers. Each pane feature gets its own test file.

## Live check

In a throwaway git repo, `claude -p --plugin-dir plugins/cairn --permission-mode bypassPermissions` produced these results:

| Call | Result |
| --- | --- |
| The model's `bin/cairn approve prd` | Denied with the FR-03 reason |
| `cat docs/sdlc/plans/x/state.json` | Ran |
| A Write to a new file in a new folder | Ran |
| A Write to `docs/sdlc/plans/x/state.json` | Denied |

The same guard regex now also covers `docs/cairn/plans`, verified by `guards.test.ts`, not by a live run.

The heartbeat file held the current epoch ms.
